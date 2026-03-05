import * as fs from 'node:fs';

/** Raw skill entry shape from the taxonomy JSON */
export interface RawSkillEntry {
  aliases: string[];
  category: string;
  description: string;
  industries: string[];
  senioritySignal: string;
  broaderTerms: string[];
  relatedSkills: string[];
  isValidSkill: boolean;
  confidence: string;
  sources: string[];
  skillType: string;
  trendDirection: string;
  demandLevel: string;
  commonJobTitles: string[];
  prerequisites: string[];
  complementarySkills: string[];
  certifications: string[];
  parentCategory: string;
  isRegionSpecific: string | null;
  ecosystem: string;
  alternativeSkills: string[];
  learningDifficulty: string;
  typicalExperienceYears: string;
  salaryImpact: string;
  automationRisk: string;
  communitySize: string;
  isOpenSource: boolean | null;
  keywords: string[];
  emergingYear: number | null;
}

export type RawTaxonomy = Record<string, RawSkillEntry>;

/** Backfill defaults for fields that may be missing (mirrors scripts/common.ts) */
function backfillEntry(entry: Record<string, unknown>): void {
  entry.ecosystem ??= '';
  entry.alternativeSkills ??= [];
  entry.learningDifficulty ??= 'intermediate';
  entry.typicalExperienceYears ??= '';
  entry.salaryImpact ??= 'average';
  entry.automationRisk ??= 'low';
  entry.communitySize ??= 'medium';
  entry.isOpenSource ??= null;
  entry.keywords ??= [];
  entry.emergingYear ??= null;
}

/** Load taxonomy JSON from disk with backfill defaults applied */
export function loadTaxonomy(filePath: string): RawTaxonomy {
  const content = fs.readFileSync(filePath, 'utf-8');
  const raw = JSON.parse(content) as Record<string, Record<string, unknown>>;

  for (const entry of Object.values(raw)) {
    backfillEntry(entry);
  }

  return raw as unknown as RawTaxonomy;
}

/** Build a Set of all canonical names (lowercased) for relationship resolution */
export function buildCanonicalSet(taxonomy: RawTaxonomy): Set<string> {
  return new Set(Object.keys(taxonomy).map((k) => k.toLowerCase()));
}
