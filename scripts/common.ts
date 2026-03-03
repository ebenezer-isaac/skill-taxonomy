import * as fs from 'node:fs';
import * as path from 'node:path';

const TAXONOMY_PATH = path.join(__dirname, '..', 'src', 'skill-taxonomy.json');

export type SkillTaxonomy = Record<string, string[]>;

export interface CandidateEntry {
  readonly canonical: string;
  readonly aliases: string[];
  readonly source: string;
  readonly category?: string;
}

/** Load the current taxonomy from disk. */
export function loadTaxonomy(): SkillTaxonomy {
  return JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf-8'));
}

/** Save taxonomy to disk (sorted alphabetically within each group). */
export function saveTaxonomy(taxonomy: SkillTaxonomy): void {
  const sorted: SkillTaxonomy = {};
  for (const key of Object.keys(taxonomy).sort()) {
    sorted[key] = [...taxonomy[key]].sort();
  }
  fs.writeFileSync(TAXONOMY_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
}

/** Build a set of all known terms (canonicals + aliases), lowercased. */
export function buildKnownTerms(taxonomy: SkillTaxonomy): Set<string> {
  const known = new Set<string>();
  for (const [canonical, aliases] of Object.entries(taxonomy)) {
    known.add(canonical.toLowerCase());
    for (const alias of aliases) {
      known.add(alias.toLowerCase());
    }
  }
  return known;
}

/** Normalize a skill name for comparison. */
export function normalize(term: string): string {
  return term.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Check if --apply flag is passed. */
export function shouldApply(): boolean {
  return process.argv.includes('--apply');
}

/** Merge candidates into the taxonomy. Returns count of additions. */
export function mergeCandidates(
  taxonomy: SkillTaxonomy,
  candidates: readonly CandidateEntry[],
): { added: number; aliasesExpanded: number } {
  const known = buildKnownTerms(taxonomy);
  let added = 0;
  let aliasesExpanded = 0;

  for (const candidate of candidates) {
    const canonical = normalize(candidate.canonical);
    
    // Skip empty canonicals
    if (!canonical || canonical.length === 0) continue;

    if (taxonomy[canonical] !== undefined) {
      // Entry exists — merge new aliases
      const existingEntry = taxonomy[canonical];
      
      // Safety check: ensure existing entry is an array
      if (!Array.isArray(existingEntry)) {
        console.warn(`  [merge] Skipping invalid entry: ${canonical}`);
        continue;
      }
      
      const existingAliases = new Set(existingEntry.map((a) => a.toLowerCase()));
      for (const alias of candidate.aliases) {
        const normalizedAlias = normalize(alias);
        if (normalizedAlias !== '' && !existingAliases.has(normalizedAlias) && !known.has(normalizedAlias)) {
          taxonomy[canonical].push(alias);
          existingAliases.add(normalizedAlias);
          known.add(normalizedAlias);
          aliasesExpanded++;
        }
      }
    } else if (!known.has(canonical)) {
      // New entry — filter out aliases that conflict with existing terms
      const safeAliases = candidate.aliases.filter((a) => {
        const n = normalize(a);
        return n !== '' && !known.has(n);
      });
      taxonomy[canonical] = safeAliases;
      known.add(canonical);
      for (const a of safeAliases) known.add(normalize(a));
      added++;
    }
  }

  return { added, aliasesExpanded };
}

/** Print a summary report and optionally apply. */
export function reportAndApply(
  candidates: readonly CandidateEntry[],
  source: string,
): void {
  const taxonomy = loadTaxonomy();
  const apply = shouldApply();

  console.log(`\n[${source}] Found ${candidates.length} candidate(s)\n`);

  if (candidates.length === 0) {
    console.log('Nothing to add.');
    return;
  }

  // Dry run: show what would be added
  const known = buildKnownTerms(taxonomy);
  const newEntries = candidates.filter((c) => !known.has(normalize(c.canonical)) && taxonomy[normalize(c.canonical)] === undefined);
  const aliasExpansions = candidates.filter((c) => taxonomy[normalize(c.canonical)] !== undefined);

  if (newEntries.length > 0) {
    console.log(`New entries (${newEntries.length}):`);
    for (const e of newEntries.slice(0, 30)) {
      console.log(`  + "${e.canonical}": [${e.aliases.map((a) => `"${a}"`).join(', ')}]`);
    }
    if (newEntries.length > 30) console.log(`  ... and ${newEntries.length - 30} more`);
  }

  if (aliasExpansions.length > 0) {
    console.log(`\nAlias expansions (${aliasExpansions.length}):`);
    for (const e of aliasExpansions.slice(0, 20)) {
      console.log(`  ~ "${e.canonical}": +[${e.aliases.map((a) => `"${a}"`).join(', ')}]`);
    }
    if (aliasExpansions.length > 20) console.log(`  ... and ${aliasExpansions.length - 20} more`);
  }

  if (apply) {
    const result = mergeCandidates(taxonomy, candidates);
    saveTaxonomy(taxonomy);
    console.log(`\nApplied: ${result.added} new entries, ${result.aliasesExpanded} aliases expanded`);
  } else {
    console.log('\nDry run — use --apply to write changes');
  }
}
