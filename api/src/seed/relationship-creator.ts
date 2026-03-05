import type { Driver } from 'neo4j-driver';
import type { RawTaxonomy } from './loader.js';
import { buildCanonicalSet } from './loader.js';

const BATCH_SIZE = 1000;

interface RelBatch {
  from: string;
  to: string;
}

/** Create all relationships between nodes, storing unresolved refs as properties */
export async function createRelationships(driver: Driver, taxonomy: RawTaxonomy): Promise<void> {
  const canonicals = buildCanonicalSet(taxonomy);
  const entries = Object.entries(taxonomy);

  // Skill-to-Skill relationship fields and their Neo4j relationship types
  const relationshipFields = [
    { field: 'broaderTerms', relType: 'BROADER_THAN', unresolvedProp: 'unresolvedBroaderTerms' },
    { field: 'relatedSkills', relType: 'RELATED_TO', unresolvedProp: 'unresolvedRelatedSkills' },
    { field: 'prerequisites', relType: 'REQUIRES', unresolvedProp: 'unresolvedPrerequisites' },
    { field: 'complementarySkills', relType: 'COMPLEMENTARY_WITH', unresolvedProp: 'unresolvedComplementarySkills' },
    { field: 'alternativeSkills', relType: 'ALTERNATIVE_TO', unresolvedProp: 'unresolvedAlternativeSkills' },
  ] as const;

  for (const { field, relType, unresolvedProp } of relationshipFields) {
    const resolved: RelBatch[] = [];
    const unresolved: Array<{ canonical: string; terms: string[] }> = [];

    for (const [canonical, entry] of entries) {
      const targets = (entry as unknown as Record<string, string[]>)[field] ?? [];
      const resolvedTerms: string[] = [];
      const unresolvedTerms: string[] = [];

      for (const target of targets) {
        const normalized = target.toLowerCase().trim();
        if (normalized && normalized !== canonical.toLowerCase() && canonicals.has(normalized)) {
          resolvedTerms.push(normalized);
        } else if (normalized && normalized !== canonical.toLowerCase()) {
          unresolvedTerms.push(target);
        }
      }

      for (const to of resolvedTerms) {
        resolved.push({ from: canonical, to });
      }
      if (unresolvedTerms.length > 0) {
        unresolved.push({ canonical, terms: unresolvedTerms });
      }
    }

    // Batch-create resolved relationships
    for (let i = 0; i < resolved.length; i += BATCH_SIZE) {
      const batch = resolved.slice(i, i + BATCH_SIZE);
      const session = driver.session();
      try {
        await session.run(
          `UNWIND $batch AS rel
           MATCH (a:Skill {canonicalName: rel.from})
           MATCH (b:Skill {canonicalName: rel.to})
           MERGE (a)-[:${relType}]->(b)`,
          { batch },
        );
      } finally {
        await session.close();
      }
    }

    // Store unresolved references as list properties on the Skill node
    for (let i = 0; i < unresolved.length; i += BATCH_SIZE) {
      const batch = unresolved.slice(i, i + BATCH_SIZE);
      const session = driver.session();
      try {
        await session.run(
          `UNWIND $batch AS item
           MATCH (s:Skill {canonicalName: item.canonical})
           SET s.${unresolvedProp} = item.terms`,
          { batch },
        );
      } finally {
        await session.close();
      }
    }

    console.log(`   ${relType}: ${resolved.length} resolved, ${unresolved.reduce((n, u) => n + u.terms.length, 0)} unresolved`);
  }

  // Industry relationships
  await createIndustryRelationships(driver, taxonomy);

  // Category relationships
  await createCategoryRelationships(driver, taxonomy);
}

async function createIndustryRelationships(driver: Driver, taxonomy: RawTaxonomy): Promise<void> {
  const batch: Array<{ skill: string; industry: string }> = [];
  for (const [canonical, entry] of Object.entries(taxonomy)) {
    for (const industry of entry.industries ?? []) {
      if (industry.trim()) batch.push({ skill: canonical, industry: industry.trim() });
    }
  }

  for (let i = 0; i < batch.length; i += BATCH_SIZE) {
    const chunk = batch.slice(i, i + BATCH_SIZE);
    const session = driver.session();
    try {
      await session.run(
        `UNWIND $batch AS item
         MATCH (s:Skill {canonicalName: item.skill})
         MATCH (i:Industry {name: item.industry})
         MERGE (s)-[:IN_INDUSTRY]->(i)`,
        { batch: chunk },
      );
    } finally {
      await session.close();
    }
  }

  console.log(`   IN_INDUSTRY: ${batch.length} relationships`);
}

async function createCategoryRelationships(driver: Driver, taxonomy: RawTaxonomy): Promise<void> {
  const catBatch: Array<{ skill: string; category: string }> = [];
  const parentBatch: Array<{ skill: string; category: string }> = [];

  for (const [canonical, entry] of Object.entries(taxonomy)) {
    if (entry.category?.trim()) {
      catBatch.push({ skill: canonical, category: entry.category.trim() });
    }
    if (entry.parentCategory?.trim()) {
      parentBatch.push({ skill: canonical, category: entry.parentCategory.trim() });
    }
  }

  for (const { batch, relType } of [
    { batch: catBatch, relType: 'IN_CATEGORY' },
    { batch: parentBatch, relType: 'IN_PARENT_CATEGORY' },
  ] as const) {
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      const chunk = batch.slice(i, i + BATCH_SIZE);
      const session = driver.session();
      try {
        await session.run(
          `UNWIND $batch AS item
           MATCH (s:Skill {canonicalName: item.skill})
           MATCH (c:Category {name: item.category})
           MERGE (s)-[:${relType}]->(c)`,
          { batch: chunk },
        );
      } finally {
        await session.close();
      }
    }
    console.log(`   ${relType}: ${batch.length} relationships`);
  }
}
