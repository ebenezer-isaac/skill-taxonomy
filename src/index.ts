import rawTaxonomy from './skill-taxonomy.json';
import type { SkillTaxonomy, TaxonomyStats } from './types';

export type { SkillTaxonomy, TaxonomyStats } from './types';

/** The full skill taxonomy with canonical entries and aliases. */
export const taxonomy: SkillTaxonomy = rawTaxonomy;

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
