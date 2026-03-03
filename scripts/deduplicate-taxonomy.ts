/**
 * Semantic deduplication and entity resolution pipeline.
 *
 * Combines multiple deduplication strategies:
 * 1. Exact match (case-insensitive)
 * 2. Fuzzy string matching (Levenshtein distance)
 * 3. Token-based similarity (Jaccard)
 * 4. N-gram similarity
 *
 * For production semantic embeddings, integrate with:
 * - OpenAI embeddings API
 * - Sentence Transformers
 * - BERT-based models
 *
 * Usage:
 *   tsx scripts/deduplicate-taxonomy.ts          # dry run
 *   tsx scripts/deduplicate-taxonomy.ts --apply  # write merged taxonomy
 *   tsx scripts/deduplicate-taxonomy.ts --threshold 0.85
 */
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

/**
 * Calculate Levenshtein distance between two strings.
 */
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
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  return matrix[a.length][b.length];
}

/**
 * Calculate normalized Levenshtein similarity (0-1).
 */
function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Tokenize a string into words.
 */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s\-+#.]/g, ' ')
    .split(/[\s\-_]+/)
    .filter((t) => t.length > 0);
}

/**
 * Calculate Jaccard similarity between two token sets.
 */
function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  
  const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  
  return intersection.size / union.size;
}

/**
 * Generate n-grams from a string.
 */
function ngrams(s: string, n: number): Set<string> {
  const result = new Set<string>();
  const lower = s.toLowerCase();
  
  for (let i = 0; i <= lower.length - n; i++) {
    result.add(lower.slice(i, i + n));
  }
  
  return result;
}

/**
 * Calculate n-gram similarity (Dice coefficient).
 */
function ngramSimilarity(a: string, b: string, n = 2): number {
  const ngramsA = ngrams(a, n);
  const ngramsB = ngrams(b, n);
  
  if (ngramsA.size === 0 && ngramsB.size === 0) return 1;
  if (ngramsA.size === 0 || ngramsB.size === 0) return 0;
  
  const intersection = new Set([...ngramsA].filter((x) => ngramsB.has(x)));
  
  return (2 * intersection.size) / (ngramsA.size + ngramsB.size);
}

/**
 * Calculate combined similarity score using multiple methods.
 */
function combinedSimilarity(a: string, b: string): { score: number; method: MergeCandidate['method'] } {
  const normalizedA = normalize(a);
  const normalizedB = normalize(b);
  
  // Exact match
  if (normalizedA === normalizedB) {
    return { score: 1.0, method: 'exact' };
  }
  
  // Calculate individual scores
  const fuzzyScore = levenshteinSimilarity(normalizedA, normalizedB);
  const tokenScore = jaccardSimilarity(a, b);
  const ngramScore = ngramSimilarity(normalizedA, normalizedB);
  
  // Weight the scores
  const weightedScore = fuzzyScore * 0.4 + tokenScore * 0.3 + ngramScore * 0.3;
  
  // Determine primary method
  let method: MergeCandidate['method'] = 'fuzzy';
  if (tokenScore > fuzzyScore && tokenScore > ngramScore) method = 'token';
  else if (ngramScore > fuzzyScore && ngramScore > tokenScore) method = 'ngram';
  
  return { score: weightedScore, method };
}

/**
 * Determine merge recommendation based on similarity and term characteristics.
 */
function getMergeRecommendation(
  termA: string,
  termB: string,
  similarity: number,
): MergeCandidate['recommendation'] {
  // Very high similarity - likely the same thing
  if (similarity >= 0.95) return 'merge';
  
  // High similarity - one might be an alias of the other
  if (similarity >= 0.85) {
    // If one is significantly shorter, it's probably an alias
    if (termA.length < termB.length * 0.6 || termB.length < termA.length * 0.6) {
      return 'alias';
    }
    return 'merge';
  }
  
  // Medium similarity - needs human review
  return 'review';
}

/**
 * Find potential duplicates in a list of terms.
 */
function findDuplicates(terms: string[], threshold: number): MergeCandidate[] {
  const candidates: MergeCandidate[] = [];
  
  // Pre-compute normalized forms for blocking
  const normalizedTerms = terms.map((t) => ({ original: t, normalized: normalize(t) }));
  
  // Sort by normalized form for efficient blocking
  normalizedTerms.sort((a, b) => a.normalized.localeCompare(b.normalized));
  
  // Use blocking to reduce comparisons
  // Block 1: First 3 characters
  const blocks = new Map<string, typeof normalizedTerms>();
  for (const term of normalizedTerms) {
    const blockKey = term.normalized.slice(0, 3);
    const existing = blocks.get(blockKey) ?? [];
    existing.push(term);
    blocks.set(blockKey, existing);
  }
  
  // Compare within blocks
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
  
  // Also compare across adjacent blocks (for edge cases)
  const blockKeys = [...blocks.keys()].sort();
  for (let i = 0; i < blockKeys.length - 1; i++) {
    const blockA = blocks.get(blockKeys[i])!;
    const blockB = blocks.get(blockKeys[i + 1])!;
    
    // Only compare if block keys are similar
    if (levenshteinDistance(blockKeys[i], blockKeys[i + 1]) <= 1) {
      for (const termA of blockA.slice(-10)) { // Last 10 from block A
        for (const termB of blockB.slice(0, 10)) { // First 10 from block B
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
  
  // Sort by similarity descending
  candidates.sort((a, b) => b.similarity - a.similarity);
  
  return candidates;
}

/**
 * Run deduplication analysis on the taxonomy.
 */
function analyzeDeduplication(): DeduplicationResult {
  const taxonomy = loadTaxonomy();
  
  // Collect all terms (canonicals + aliases)
  const allTerms: string[] = [];
  const termToCanonical = new Map<string, string>();
  
  for (const [canonical, aliases] of Object.entries(taxonomy)) {
    allTerms.push(canonical);
    termToCanonical.set(normalize(canonical), canonical);
    
    for (const alias of aliases) {
      allTerms.push(alias);
      termToCanonical.set(normalize(alias), canonical);
    }
  }
  
  console.log(`[dedupe] Analyzing ${allTerms.length} total terms (${Object.keys(taxonomy).length} canonicals)`);
  
  // Find duplicates
  const duplicates = findDuplicates(allTerms, SIMILARITY_THRESHOLD);
  
  // Identify conflicts (same term mapped to different canonicals)
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
  
  // Print stats
  console.log('\n[dedupe] Analysis Results:');
  console.log(`  Total terms: ${result.stats.totalTerms}`);
  console.log(`  Unique normalized: ${result.stats.uniqueTerms}`);
  console.log(`  Potential duplicates: ${result.stats.potentialDuplicates}`);
  console.log(`  Merge recommendations: ${result.stats.mergeRecommendations}`);
  console.log(`  Conflicts: ${result.conflicts.length}`);
  
  // Print top duplicates
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
  
  // Print conflicts
  if (result.conflicts.length > 0) {
    console.log('\n[dedupe] Conflicts (same term, different canonicals):');
    for (const conflict of result.conflicts.slice(0, 10)) {
      console.log(`  ⚠️ ${conflict.terms.join(' ↔ ')}`);
      console.log(`     ${conflict.reason}`);
    }
  }
  
  // Apply merges if requested
  if (shouldApply() && result.merges.length > 0) {
    const taxonomy = loadTaxonomy();
    let mergesApplied = 0;
    let aliasesAdded = 0;
    
    for (const merge of result.merges) {
      if (merge.recommendation !== 'merge' && merge.recommendation !== 'alias') continue;
      
      const normalizedA = normalize(merge.termA);
      const normalizedB = normalize(merge.termB);
      
      // Check if both are canonicals
      const isACanonical = taxonomy[normalizedA] !== undefined;
      const isBCanonical = taxonomy[normalizedB] !== undefined;
      
      if (isACanonical && isBCanonical) {
        // Both are canonicals - merge B into A (keep the longer/more descriptive one)
        if (merge.termA.length >= merge.termB.length) {
          // Merge B's aliases into A, add B as alias, delete B
          const existingA = new Set(taxonomy[normalizedA].map(normalize));
          for (const alias of taxonomy[normalizedB]) {
            if (!existingA.has(normalize(alias))) {
              taxonomy[normalizedA].push(alias);
              aliasesAdded++;
            }
          }
          if (!existingA.has(normalizedB)) {
            taxonomy[normalizedA].push(merge.termB);
            aliasesAdded++;
          }
          delete taxonomy[normalizedB];
          mergesApplied++;
        }
      } else if (!isACanonical && !isBCanonical) {
        // Both are aliases - potential cleanup needed, skip for now
        continue;
      }
    }
    
    saveTaxonomy(taxonomy);
    console.log(`\n[dedupe] Applied: ${mergesApplied} merges, ${aliasesAdded} aliases added`);
  } else if (!shouldApply()) {
    console.log('\n[dedupe] Dry run — use --apply to write changes');
  }
  
  // Export results for external processing
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const outputPath = nodePath.join(__dirname, 'data', 'deduplication-report.json');
  
  if (!fs.existsSync(nodePath.dirname(outputPath))) {
    fs.mkdirSync(nodePath.dirname(outputPath), { recursive: true });
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n[dedupe] Full report saved to: ${outputPath}`);
}

main();
