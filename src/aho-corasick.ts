/**
 * Aho-Corasick automaton for multi-pattern string matching.
 *
 * Replaces 50k+ regex compilations with a single-pass O(text_length) scan.
 * Built from the full skill taxonomy (14,750 canonical + aliases), this
 * automaton finds ALL skill mentions in one traversal of the input text.
 *
 * Algorithm:
 *   1. Build a trie from all patterns
 *   2. Compute failure links via BFS (suffix fallback on mismatch)
 *   3. Compute output links (chained matches at each node)
 *   4. Search: traverse automaton char-by-char, collect matches
 *
 * Word boundaries use \b semantics: any non-word character (outside
 * [a-zA-Z0-9_]) counts as a boundary. This correctly handles null bytes,
 * HTML tags, Unicode, and every other non-alphanumeric delimiter.
 */

function isWordChar(charCode: number): boolean {
  return (
    (charCode >= 0x30 && charCode <= 0x39) || // 0-9
    (charCode >= 0x41 && charCode <= 0x5a) || // A-Z
    (charCode >= 0x61 && charCode <= 0x7a) || // a-z
    charCode === 0x5f                          // _
  );
}

function isBoundary(charCode: number | undefined): boolean {
  return charCode === undefined || !isWordChar(charCode);
}

export interface AhoCorasickMatch {
  readonly pattern: string;
  readonly canonical: string;
  readonly position: number;
  readonly length: number;
}

interface TrieNode {
  readonly children: Map<number, TrieNode>;
  failure: TrieNode | null;
  outputLink: TrieNode | null;
  readonly outputs: Array<{ pattern: string; canonical: string }>;
  readonly depth: number;
}

function createNode(depth: number): TrieNode {
  return {
    children: new Map(),
    failure: null,
    outputLink: null,
    outputs: [],
    depth,
  };
}

export class AhoCorasickAutomaton {
  private readonly root: TrieNode;
  private readonly patternCount: number;

  /**
   * Build the automaton from a map of patterns → canonical names.
   * All patterns should be pre-lowercased.
   *
   * @param patterns Map<lowercased_pattern, lowercased_canonical>
   */
  constructor(patterns: ReadonlyMap<string, string>) {
    this.root = createNode(0);
    this.patternCount = patterns.size;
    this.buildTrie(patterns);
    this.buildFailureLinks();
  }

  get size(): number {
    return this.patternCount;
  }

  /**
   * Find all taxonomy skill matches in text with word-boundary enforcement.
   * Matches are returned in traversal order (not sorted).
   *
   * Complexity: O(text.length + number_of_matches)
   */
  search(text: string): AhoCorasickMatch[] {
    const lower = text.toLowerCase();
    const matches: AhoCorasickMatch[] = [];
    let node = this.root;

    for (let i = 0; i < lower.length; i++) {
      const charCode = lower.charCodeAt(i);

      while (node !== this.root && !node.children.has(charCode)) {
        node = node.failure!;
      }

      node = node.children.get(charCode) ?? this.root;

      // Collect all outputs at this node (direct + via output links)
      let outputNode: TrieNode | null = node;
      while (outputNode !== null) {
        for (const output of outputNode.outputs) {
          const start = i - output.pattern.length + 1;
          const end = i + 1;

          // Enforce word boundaries
          const beforeCode = start > 0 ? lower.charCodeAt(start - 1) : undefined;
          const afterCode = end < lower.length ? lower.charCodeAt(end) : undefined;

          if (isBoundary(beforeCode) && isBoundary(afterCode)) {
            matches.push({
              pattern: output.pattern,
              canonical: output.canonical,
              position: start,
              length: output.pattern.length,
            });
          }
        }
        outputNode = outputNode.outputLink;
      }
    }

    return matches;
  }

  /**
   * Extract unique canonical skills found in text.
   * Returns a Set of canonical names (lowercased).
   *
   * When multiple aliases of the same canonical match,
   * only the canonical is returned (deduplicated).
   */
  extractSkills(text: string): Set<string> {
    const matches = this.search(text);
    const canonicals = new Set<string>();
    for (const m of matches) {
      canonicals.add(m.canonical);
    }
    return canonicals;
  }

  /**
   * Count occurrences of each canonical skill in text.
   * Returns a Map<canonical, count>.
   */
  countOccurrences(text: string): Map<string, number> {
    const matches = this.search(text);
    const counts = new Map<string, number>();
    for (const m of matches) {
      counts.set(m.canonical, (counts.get(m.canonical) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Check if a single term exists in text with word boundaries.
   * Both text and term are lowercased internally.
   * If the text is already lowered, use `containsTermLower` to avoid double-lowering.
   */
  static containsTerm(text: string, term: string): boolean {
    return AhoCorasickAutomaton.containsTermLower(text.toLowerCase(), term.toLowerCase());
  }

  /**
   * Check if a lowercased term exists in pre-lowercased text with word boundaries.
   * Avoids redundant toLowerCase calls on hot paths.
   */
  static containsTermLower(textLower: string, termLower: string): boolean {
    let searchFrom = 0;

    while (searchFrom <= textLower.length - termLower.length) {
      const idx = textLower.indexOf(termLower, searchFrom);
      if (idx === -1) return false;

      const beforeCode = idx > 0 ? textLower.charCodeAt(idx - 1) : undefined;
      const afterCode =
        idx + termLower.length < textLower.length
          ? textLower.charCodeAt(idx + termLower.length)
          : undefined;

      if (isBoundary(beforeCode) && isBoundary(afterCode)) {
        return true;
      }

      searchFrom = idx + 1;
    }

    return false;
  }

  /**
   * Count how many times a single term appears in text with word boundaries.
   * Both text and term are lowercased internally.
   * If the text is already lowered, use `countTermLower` to avoid double-lowering.
   */
  static countTerm(text: string, term: string): number {
    return AhoCorasickAutomaton.countTermLower(text.toLowerCase(), term.toLowerCase());
  }

  /**
   * Count term occurrences in pre-lowercased text with word boundaries.
   * Avoids redundant toLowerCase calls on hot paths.
   */
  static countTermLower(textLower: string, termLower: string): number {
    let count = 0;
    let searchFrom = 0;

    while (searchFrom <= textLower.length - termLower.length) {
      const idx = textLower.indexOf(termLower, searchFrom);
      if (idx === -1) break;

      const beforeCode = idx > 0 ? textLower.charCodeAt(idx - 1) : undefined;
      const afterCode =
        idx + termLower.length < textLower.length
          ? textLower.charCodeAt(idx + termLower.length)
          : undefined;

      if (isBoundary(beforeCode) && isBoundary(afterCode)) {
        count++;
      }

      searchFrom = idx + 1;
    }

    return count;
  }

  // ── Trie construction ──────────────────────────────────────────────────

  private buildTrie(patterns: ReadonlyMap<string, string>): void {
    for (const [pattern, canonical] of patterns) {
      if (pattern.length === 0) continue;

      let node = this.root;
      for (let i = 0; i < pattern.length; i++) {
        const charCode = pattern.charCodeAt(i);
        let child = node.children.get(charCode);
        if (!child) {
          child = createNode(i + 1);
          node.children.set(charCode, child);
        }
        node = child;
      }

      node.outputs.push({ pattern, canonical });
    }
  }

  // ── Failure links (BFS from root) ──────────────────────────────────────

  private buildFailureLinks(): void {
    const queue: TrieNode[] = [];
    let queueHead = 0;

    // Root's children all fail back to root
    for (const child of this.root.children.values()) {
      child.failure = this.root;
      child.outputLink = null;
      queue.push(child);
    }

    while (queueHead < queue.length) {
      const current = queue[queueHead++];

      for (const [charCode, child] of current.children) {
        // Walk up failure chain to find the longest proper suffix
        let fallback = current.failure!;
        while (fallback !== this.root && !fallback.children.has(charCode)) {
          fallback = fallback.failure!;
        }

        child.failure = fallback.children.get(charCode) ?? this.root;

        // Don't let a node be its own failure
        if (child.failure === child) {
          child.failure = this.root;
        }

        // Output link: chain to nearest ancestor with outputs
        child.outputLink =
          child.failure.outputs.length > 0
            ? child.failure
            : child.failure.outputLink;

        queue.push(child);
      }
    }
  }
}

/**
 * Build an Aho-Corasick automaton from a reverse lookup map.
 * The reverse lookup maps every alias/canonical (lowercased) to its
 * canonical name (lowercased).
 */
export function buildAutomaton(reverseLookup: ReadonlyMap<string, string>): AhoCorasickAutomaton {
  return new AhoCorasickAutomaton(reverseLookup);
}
