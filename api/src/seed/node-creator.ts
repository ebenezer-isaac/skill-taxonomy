import type { Driver } from 'neo4j-driver';
import type { RawTaxonomy } from './loader.js';

const BATCH_SIZE = 500;

/** Batch-create all Skill nodes from the taxonomy */
export async function createSkillNodes(driver: Driver, taxonomy: RawTaxonomy): Promise<number> {
  const entries = Object.entries(taxonomy);
  let created = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE).map(([canonical, entry]) => ({
      canonicalName: canonical,
      description: entry.description ?? '',
      aliases: entry.aliases ?? [],
      category: entry.category ?? '',
      parentCategory: entry.parentCategory ?? '',
      skillType: entry.skillType ?? '',
      ecosystem: entry.ecosystem ?? '',
      senioritySignal: entry.senioritySignal ?? '',
      trendDirection: entry.trendDirection ?? '',
      demandLevel: entry.demandLevel ?? '',
      confidence: entry.confidence ?? 'pending',
      isValidSkill: entry.isValidSkill ?? true,
      isOpenSource: entry.isOpenSource ?? null,
      isRegionSpecific: entry.isRegionSpecific ?? null,
      learningDifficulty: entry.learningDifficulty ?? '',
      typicalExperienceYears: entry.typicalExperienceYears ?? '',
      salaryImpact: entry.salaryImpact ?? '',
      automationRisk: entry.automationRisk ?? '',
      communitySize: entry.communitySize ?? '',
      emergingYear: entry.emergingYear ?? null,
      sources: entry.sources ?? [],
      keywords: entry.keywords ?? [],
      commonJobTitles: entry.commonJobTitles ?? [],
      certifications: entry.certifications ?? [],
    }));

    const session = driver.session();
    try {
      await session.run(
        `UNWIND $batch AS skill
         CREATE (s:Skill {
           canonicalName: skill.canonicalName,
           description: skill.description,
           aliases: skill.aliases,
           category: skill.category,
           parentCategory: skill.parentCategory,
           skillType: skill.skillType,
           ecosystem: skill.ecosystem,
           senioritySignal: skill.senioritySignal,
           trendDirection: skill.trendDirection,
           demandLevel: skill.demandLevel,
           confidence: skill.confidence,
           isValidSkill: skill.isValidSkill,
           isOpenSource: skill.isOpenSource,
           isRegionSpecific: skill.isRegionSpecific,
           learningDifficulty: skill.learningDifficulty,
           typicalExperienceYears: skill.typicalExperienceYears,
           salaryImpact: skill.salaryImpact,
           automationRisk: skill.automationRisk,
           communitySize: skill.communitySize,
           emergingYear: skill.emergingYear,
           sources: skill.sources,
           keywords: skill.keywords,
           commonJobTitles: skill.commonJobTitles,
           certifications: skill.certifications
         })`,
        { batch },
      );
      created += batch.length;
    } finally {
      await session.close();
    }
  }

  console.log(`   Created ${created} Skill nodes`);
  return created;
}

/** Extract unique industry names and create Industry nodes */
export async function createIndustryNodes(driver: Driver, taxonomy: RawTaxonomy): Promise<number> {
  const industries = new Set<string>();
  for (const entry of Object.values(taxonomy)) {
    for (const ind of entry.industries ?? []) {
      if (ind.trim()) industries.add(ind.trim());
    }
  }

  const batch = [...industries].map((name) => ({ name }));
  const session = driver.session();
  try {
    await session.run(
      `UNWIND $batch AS item
       MERGE (i:Industry {name: item.name})`,
      { batch },
    );
  } finally {
    await session.close();
  }

  console.log(`   Created ${industries.size} Industry nodes`);
  return industries.size;
}

/** Extract unique category/parentCategory names and create Category nodes */
export async function createCategoryNodes(driver: Driver, taxonomy: RawTaxonomy): Promise<number> {
  const categories = new Set<string>();
  for (const entry of Object.values(taxonomy)) {
    if (entry.category?.trim()) categories.add(entry.category.trim());
    if (entry.parentCategory?.trim()) categories.add(entry.parentCategory.trim());
  }

  const batch = [...categories].map((name) => ({ name }));
  const session = driver.session();
  try {
    await session.run(
      `UNWIND $batch AS item
       MERGE (c:Category {name: item.name})`,
      { batch },
    );
  } finally {
    await session.close();
  }

  console.log(`   Created ${categories.size} Category nodes`);
  return categories.size;
}
