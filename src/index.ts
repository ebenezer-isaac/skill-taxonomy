import rawTaxonomy from './skill-taxonomy.json';
import type { SkillTaxonomy, SkillTaxonomyMap, SkillEntry, TaxonomyStats } from './types/taxonomy.types';

export type { SkillTaxonomy, SkillTaxonomyMap, SkillEntry, TaxonomyStats } from './types/taxonomy.types';

// Backfill defaults for any fields not yet present in the JSON
const rawEntries = rawTaxonomy as unknown as Record<string, Record<string, unknown>>;
for (const entry of Object.values(rawEntries)) {
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

/** The skill taxonomy — single source of truth. */
export const skillTaxonomyMap: SkillTaxonomyMap = rawEntries as unknown as SkillTaxonomyMap;

/** Flat derived view: canonical → aliases[] for O(1) keyword matching. */
export const taxonomy: SkillTaxonomy = Object.freeze(
  Object.fromEntries(
    Object.entries(skillTaxonomyMap).map(([k, v]) => [k, Object.freeze([...v.aliases])])
  )
) as SkillTaxonomy;

/**
 * Build a reverse lookup map: every alias and canonical (lowercased) → canonical.
 * Enables O(1) "what is the canonical form of this term?" lookups.
 */
export function buildReverseLookup(t: SkillTaxonomy): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(t)) {
    const lower = canonical.toLowerCase();
    lookup.set(lower, lower);
    for (const alias of aliases) {
      lookup.set(alias.toLowerCase(), lower);
    }
  }
  return lookup;
}

/** Build a set of all lowercase canonical skill names. */
export function buildCanonicalSet(t: SkillTaxonomy): Set<string> {
  return new Set(Object.keys(t).map((k) => k.toLowerCase()));
}

/** Get taxonomy statistics. */
export function getStats(t: SkillTaxonomy): TaxonomyStats {
  const canonicals = Object.keys(t).length;
  const aliases = Object.values(t).reduce((sum, a) => sum + a.length, 0);
  return { canonicals, aliases, total: canonicals + aliases };
}
