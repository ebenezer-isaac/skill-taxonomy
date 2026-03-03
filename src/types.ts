/**
 * A skill taxonomy mapping canonical skill names to their known aliases.
 *
 * Keys are lowercase canonical names (e.g., "javascript", "react", "kubernetes").
 * Values are arrays of known aliases/synonyms (e.g., ["js", "ecmascript", "es6"]).
 */
export type SkillTaxonomy = Readonly<Record<string, readonly string[]>>;

/** Stats about a loaded taxonomy. */
export interface TaxonomyStats {
  readonly canonicals: number;
  readonly aliases: number;
  readonly total: number;
}
