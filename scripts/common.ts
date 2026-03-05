import * as fs from 'node:fs';
import * as path from 'node:path';

export type { SkillEntry, EnrichedTaxonomy, CandidateEntry } from '../src/types/taxonomy.types';
import type { SkillEntry, EnrichedTaxonomy, CandidateEntry } from '../src/types/taxonomy.types';

/** Path to the single canonical taxonomy file. */
const TAXONOMY_PATH = path.join(__dirname, '..', 'src', 'skill-taxonomy.json');

/** Backfill defaults for fields added after initial data load. No-op for already-populated entries. */
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

/** Load the taxonomy from disk. */
export function loadTaxonomy(): EnrichedTaxonomy {
  const raw = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf-8'));
  for (const entry of Object.values(raw) as Record<string, unknown>[]) {
    backfillEntry(entry);
  }
  return raw;
}

/** Check if the taxonomy file exists. */
export function taxonomyExists(): boolean {
  return fs.existsSync(TAXONOMY_PATH);
}

/** Save taxonomy to disk (sorted by canonical name). */
export function saveTaxonomy(taxonomy: EnrichedTaxonomy): void {
  const sorted: EnrichedTaxonomy = {};
  for (const key of Object.keys(taxonomy).sort()) {
    const entry = taxonomy[key];
    sorted[key] = {
      ...entry,
      aliases: [...entry.aliases].sort(),
      industries: [...entry.industries].sort(),
      broaderTerms: [...entry.broaderTerms].sort(),
      relatedSkills: [...entry.relatedSkills].sort(),
      sources: [...entry.sources].sort(),
      commonJobTitles: [...entry.commonJobTitles].sort(),
      prerequisites: [...entry.prerequisites].sort(),
      complementarySkills: [...entry.complementarySkills].sort(),
      certifications: [...entry.certifications].sort(),
      alternativeSkills: [...entry.alternativeSkills].sort(),
      keywords: [...entry.keywords].sort(),
    };
  }
  fs.writeFileSync(TAXONOMY_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
}

/** Build a set of all known terms (canonicals + aliases), lowercased. */
export function buildKnownTerms(taxonomy: EnrichedTaxonomy): Set<string> {
  const known = new Set<string>();
  for (const [canonical, entry] of Object.entries(taxonomy)) {
    known.add(canonical.toLowerCase());
    for (const alias of entry.aliases) {
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
  taxonomy: EnrichedTaxonomy,
  candidates: readonly CandidateEntry[],
): { readonly added: number; readonly aliasesExpanded: number } {
  const known = buildKnownTerms(taxonomy);
  let added = 0;
  let aliasesExpanded = 0;

  for (const candidate of candidates) {
    const canonical = normalize(candidate.canonical);
    if (canonical === '') continue;

    if (taxonomy[canonical] !== undefined) {
      const entry = taxonomy[canonical];
      const existing = new Set(entry.aliases.map(a => a.toLowerCase()));
      for (const alias of candidate.aliases) {
        const n = normalize(alias);
        if (n !== '' && !existing.has(n) && !known.has(n)) {
          entry.aliases.push(alias);
          existing.add(n);
          known.add(n);
          aliasesExpanded++;
        }
      }
    } else if (!known.has(canonical)) {
      const safeAliases = candidate.aliases.filter(a => {
        const n = normalize(a);
        return n !== '' && !known.has(n);
      });
      taxonomy[canonical] = createDefaultSkillEntry(
        safeAliases,
        candidate.source ? [candidate.source] : ['unknown'],
      );
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

  const known = buildKnownTerms(taxonomy);
  const newEntries = candidates.filter(c => !known.has(normalize(c.canonical)) && taxonomy[normalize(c.canonical)] === undefined);
  const aliasExpansions = candidates.filter(c => taxonomy[normalize(c.canonical)] !== undefined);

  if (newEntries.length > 0) {
    console.log(`New entries (${newEntries.length}):`);
    for (const e of newEntries.slice(0, 30)) {
      console.log(`  + "${e.canonical}": [${e.aliases.map(a => `"${a}"`).join(', ')}]`);
    }
    if (newEntries.length > 30) console.log(`  ... and ${newEntries.length - 30} more`);
  }

  if (aliasExpansions.length > 0) {
    console.log(`\nAlias expansions (${aliasExpansions.length}):`);
    for (const e of aliasExpansions.slice(0, 20)) {
      console.log(`  ~ "${e.canonical}": +[${e.aliases.map(a => `"${a}"`).join(', ')}]`);
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

/** Create a default SkillEntry. */
export function createDefaultSkillEntry(aliases: string[], sources: string[] = ['unknown']): SkillEntry {
  return {
    aliases: [...aliases],
    category: '',
    description: '',
    industries: [],
    senioritySignal: 'all-levels',
    broaderTerms: [],
    relatedSkills: [],
    isValidSkill: true,
    confidence: 'pending',
    sources,
    skillType: '',
    trendDirection: 'stable',
    demandLevel: 'medium',
    commonJobTitles: [],
    prerequisites: [],
    complementarySkills: [],
    certifications: [],
    parentCategory: '',
    isRegionSpecific: null,
    ecosystem: '',
    alternativeSkills: [],
    learningDifficulty: 'intermediate',
    typicalExperienceYears: '',
    salaryImpact: 'average',
    automationRisk: 'low',
    communitySize: 'medium',
    isOpenSource: null,
    keywords: [],
    emergingYear: null,
  };
}
