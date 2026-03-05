/**
 * Semantic deduplication and entity resolution pipeline.
 *
 * Combines multiple deduplication strategies:
 * 1. Exact match (case-insensitive)
 * 2. Fuzzy string matching (Levenshtein distance)
 * 3. Token-based similarity (Jaccard)
 * 4. N-gram similarity
 *
 * Usage:
 *   tsx scripts/deduplicate-taxonomy.ts          # dry run
 *   tsx scripts/deduplicate-taxonomy.ts --apply  # write merged taxonomy
 *   tsx scripts/deduplicate-taxonomy.ts --threshold 0.85
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadTaxonomy, saveTaxonomy, normalize, shouldApply } from './common';

// CLI arguments
const SIMILARITY_THRESHOLD = parseFloat(
  process.argv.find((a) => a.startsWith('--threshold='))?.split('=')[1] ?? '0.85',
);
const VERBOSE = process.argv.includes('--verbose');

/** Candidate merge pair */
interface MergeCandidate {
  termA: string;
  termB: string;
  similarity: number;
  method: 'exact' | 'fuzzy' | 'token' | 'ngram';
  recommendation: 'merge' | 'alias' | 'review';
}

/** Deduplication result */
interface DeduplicationResult {
  merges: MergeCandidate[];
  conflicts: Array<{ terms: string[]; reason: string }>;
  stats: {
    totalTerms: number;
    uniqueTerms: number;
    potentialDuplicates: number;
    mergeRecommendations: number;
  };
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s\-+#.]/g, ' ')
    .split(/[\s\-_]+/)
    .filter((t) => t.length > 0);
}

function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);

  return intersection.size / union.size;
}

function ngrams(s: string, n: number): Set<string> {
  const result = new Set<string>();
  const lower = s.toLowerCase();

  for (let i = 0; i <= lower.length - n; i++) {
    result.add(lower.slice(i, i + n));
  }

  return result;
}

function ngramSimilarity(a: string, b: string, n = 2): number {
  const ngramsA = ngrams(a, n);
  const ngramsB = ngrams(b, n);

  if (ngramsA.size === 0 && ngramsB.size === 0) return 1;
  if (ngramsA.size === 0 || ngramsB.size === 0) return 0;

  const intersection = new Set([...ngramsA].filter((x) => ngramsB.has(x)));

  return (2 * intersection.size) / (ngramsA.size + ngramsB.size);
}

function combinedSimilarity(a: string, b: string): { score: number; method: MergeCandidate['method'] } {
  const normalizedA = normalize(a);
  const normalizedB = normalize(b);

  if (normalizedA === normalizedB) {
    return { score: 1.0, method: 'exact' };
  }

  const fuzzyScore = levenshteinSimilarity(normalizedA, normalizedB);
  const tokenScore = jaccardSimilarity(a, b);
  const ngramScore = ngramSimilarity(normalizedA, normalizedB);

  const weightedScore = fuzzyScore * 0.4 + tokenScore * 0.3 + ngramScore * 0.3;

  let method: MergeCandidate['method'] = 'fuzzy';
  if (tokenScore > fuzzyScore && tokenScore > ngramScore) method = 'token';
  else if (ngramScore > fuzzyScore && ngramScore > tokenScore) method = 'ngram';

  return { score: weightedScore, method };
}

function getMergeRecommendation(
  termA: string,
  termB: string,
  similarity: number,
): MergeCandidate['recommendation'] {
  if (similarity >= 0.95) return 'merge';

  if (similarity >= 0.85) {
    if (termA.length < termB.length * 0.6 || termB.length < termA.length * 0.6) {
      return 'alias';
    }
    return 'merge';
  }

  return 'review';
}

function findDuplicates(terms: string[], threshold: number): MergeCandidate[] {
  const candidates: MergeCandidate[] = [];

  const normalizedTerms = terms.map((t) => ({ original: t, normalized: normalize(t) }));
  normalizedTerms.sort((a, b) => a.normalized.localeCompare(b.normalized));

  const blocks = new Map<string, typeof normalizedTerms>();
  for (const term of normalizedTerms) {
    const blockKey = term.normalized.slice(0, 3);
    const existing = blocks.get(blockKey) ?? [];
    existing.push(term);
    blocks.set(blockKey, existing);
  }

  let comparisons = 0;
  for (const block of blocks.values()) {
    for (let i = 0; i < block.length; i++) {
      for (let j = i + 1; j < block.length; j++) {
        comparisons++;
        const { score, method } = combinedSimilarity(block[i].original, block[j].original);

        if (score >= threshold) {
          candidates.push({
            termA: block[i].original,
            termB: block[j].original,
            similarity: score,
            method,
            recommendation: getMergeRecommendation(block[i].original, block[j].original, score),
          });
        }
      }
    }
  }

  const blockKeys = [...blocks.keys()].sort();
  for (let i = 0; i < blockKeys.length - 1; i++) {
    const blockA = blocks.get(blockKeys[i])!;
    const blockB = blocks.get(blockKeys[i + 1])!;

    if (levenshteinDistance(blockKeys[i], blockKeys[i + 1]) <= 1) {
      for (const termA of blockA.slice(-10)) {
        for (const termB of blockB.slice(0, 10)) {
          comparisons++;
          const { score, method } = combinedSimilarity(termA.original, termB.original);

          if (score >= threshold) {
            candidates.push({
              termA: termA.original,
              termB: termB.original,
              similarity: score,
              method,
              recommendation: getMergeRecommendation(termA.original, termB.original, score),
            });
          }
        }
      }
    }
  }

  if (VERBOSE) {
    console.log(`  [dedupe] Performed ${comparisons} comparisons across ${blocks.size} blocks`);
  }

  candidates.sort((a, b) => b.similarity - a.similarity);

  return candidates;
}

function analyzeDeduplication(): DeduplicationResult {
  const taxonomy = loadTaxonomy();

  const allTerms: string[] = [];
  const termToCanonical = new Map<string, string>();

  for (const [canonical, entry] of Object.entries(taxonomy)) {
    allTerms.push(canonical);
    termToCanonical.set(normalize(canonical), canonical);

    for (const alias of entry.aliases) {
      allTerms.push(alias);
      termToCanonical.set(normalize(alias), canonical);
    }
  }

  console.log(`[dedupe] Analyzing ${allTerms.length} total terms (${Object.keys(taxonomy).length} canonicals)`);

  const duplicates = findDuplicates(allTerms, SIMILARITY_THRESHOLD);

  const conflicts: Array<{ terms: string[]; reason: string }> = [];
  const seen = new Set<string>();

  for (const dup of duplicates) {
    const key = [dup.termA, dup.termB].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const canonicalA = termToCanonical.get(normalize(dup.termA));
    const canonicalB = termToCanonical.get(normalize(dup.termB));

    if (canonicalA && canonicalB && canonicalA !== canonicalB) {
      conflicts.push({
        terms: [dup.termA, dup.termB],
        reason: `Mapped to different canonicals: "${canonicalA}" vs "${canonicalB}"`,
      });
    }
  }

  return {
    merges: duplicates,
    conflicts,
    stats: {
      totalTerms: allTerms.length,
      uniqueTerms: new Set(allTerms.map(normalize)).size,
      potentialDuplicates: duplicates.length,
      mergeRecommendations: duplicates.filter((d) => d.recommendation === 'merge').length,
    },
  };
}

function main(): void {
  console.log('[dedupe] Starting semantic deduplication analysis');
  console.log(`[dedupe] Similarity threshold: ${SIMILARITY_THRESHOLD}\n`);

  const result = analyzeDeduplication();

  console.log('\n[dedupe] Analysis Results:');
  console.log(`  Total terms: ${result.stats.totalTerms}`);
  console.log(`  Unique normalized: ${result.stats.uniqueTerms}`);
  console.log(`  Potential duplicates: ${result.stats.potentialDuplicates}`);
  console.log(`  Merge recommendations: ${result.stats.mergeRecommendations}`);
  console.log(`  Conflicts: ${result.conflicts.length}`);

  if (result.merges.length > 0) {
    console.log('\n[dedupe] Top potential duplicates:');
    for (const merge of result.merges.slice(0, 30)) {
      const recEmoji = merge.recommendation === 'merge' ? '🔀' : merge.recommendation === 'alias' ? '➡️' : '❓';
      console.log(`  ${recEmoji} "${merge.termA}" ↔ "${merge.termB}" (${(merge.similarity * 100).toFixed(1)}% ${merge.method})`);
    }

    if (result.merges.length > 30) {
      console.log(`  ... and ${result.merges.length - 30} more`);
    }
  }

  if (result.conflicts.length > 0) {
    console.log('\n[dedupe] Conflicts (same term, different canonicals):');
    for (const conflict of result.conflicts.slice(0, 10)) {
      console.log(`  ⚠️ ${conflict.terms.join(' ↔ ')}`);
      console.log(`     ${conflict.reason}`);
    }
  }

  if (shouldApply() && result.merges.length > 0) {
    const taxonomy = loadTaxonomy();
    let mergesApplied = 0;
    let aliasesAdded = 0;

    for (const merge of result.merges) {
      if (merge.recommendation !== 'merge' && merge.recommendation !== 'alias') continue;

      const normalizedA = normalize(merge.termA);
      const normalizedB = normalize(merge.termB);

      const isACanonical = taxonomy[normalizedA] !== undefined;
      const isBCanonical = taxonomy[normalizedB] !== undefined;

      if (isACanonical && isBCanonical) {
        if (merge.termA.length >= merge.termB.length) {
          const entryA = taxonomy[normalizedA];
          const entryB = taxonomy[normalizedB];
          const existingAliasSet = new Set(entryA.aliases.map(normalize));

          for (const alias of entryB.aliases) {
            if (!existingAliasSet.has(normalize(alias))) {
              entryA.aliases.push(alias);
              existingAliasSet.add(normalize(alias));
              aliasesAdded++;
            }
          }
          if (!existingAliasSet.has(normalizedB)) {
            entryA.aliases.push(merge.termB);
            aliasesAdded++;
          }

          const broaderSet = new Set(entryA.broaderTerms.map(b => b.toLowerCase()));
          for (const bt of entryB.broaderTerms) {
            if (!broaderSet.has(bt.toLowerCase())) entryA.broaderTerms.push(bt);
          }

          const relatedSet = new Set(entryA.relatedSkills.map(r => r.toLowerCase()));
          for (const rs of entryB.relatedSkills) {
            if (!relatedSet.has(rs.toLowerCase())) entryA.relatedSkills.push(rs);
          }

          const srcSet = new Set(entryA.sources);
          for (const s of entryB.sources) {
            if (!srcSet.has(s)) entryA.sources.push(s);
          }

          delete taxonomy[normalizedB];
          mergesApplied++;
        }
      }
    }

    saveTaxonomy(taxonomy);
    console.log(`\n[dedupe] Applied: ${mergesApplied} merges, ${aliasesAdded} aliases added`);
  } else if (!shouldApply()) {
    console.log('\n[dedupe] Dry run — use --apply to write changes');
  }

  const outputPath = path.join(__dirname, 'data', 'deduplication-report.json');

  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n[dedupe] Full report saved to: ${outputPath}`);
}

main();
