import { describe, it, expect } from 'vitest';
import {
  AhoCorasickAutomaton,
  buildAutomaton,
  type AhoCorasickMatch,
} from '../src/aho-corasick';
import { taxonomy, buildTaxonomyAutomaton } from '../src/index';

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildSimple(entries: Record<string, string>): AhoCorasickAutomaton {
  return new AhoCorasickAutomaton(new Map(Object.entries(entries)));
}

function _canonicals(matches: AhoCorasickMatch[]): string[] {
  return matches.map((m) => m.canonical);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AhoCorasickAutomaton', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Construction & Basic Properties
  // ═══════════════════════════════════════════════════════════════════════════

  describe('construction', () => {
    it('should build from empty map', () => {
      const ac = new AhoCorasickAutomaton(new Map());
      expect(ac.size).toBe(0);
      expect(ac.search('anything')).toHaveLength(0);
    });

    it('should report correct pattern count', () => {
      const ac = buildSimple({ python: 'python', js: 'javascript' });
      expect(ac.size).toBe(2);
    });

    it('should skip empty string patterns', () => {
      const ac = new AhoCorasickAutomaton(
        new Map([
          ['', 'empty'],
          ['python', 'python'],
        ]),
      );
      // Empty pattern is skipped, only "python" is registered
      expect(ac.size).toBe(2); // Map.size, but effectively only 1 pattern in trie
      expect(ac.search('')).toHaveLength(0);
      expect(ac.extractSkills('python developer')).toEqual(new Set(['python']));
    });

    it('should build from buildAutomaton helper', () => {
      const lookup = new Map([
        ['python', 'python'],
        ['py', 'python'],
      ]);
      const ac = buildAutomaton(lookup);
      expect(ac.size).toBe(2);
      expect(ac.extractSkills('py developer')).toEqual(new Set(['python']));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Single-Pattern Matching
  // ═══════════════════════════════════════════════════════════════════════════

  describe('single pattern', () => {
    const ac = buildSimple({ python: 'python' });

    it('should match at start of string', () => {
      const matches = ac.search('python developer');
      expect(matches).toHaveLength(1);
      expect(matches[0].canonical).toBe('python');
      expect(matches[0].position).toBe(0);
    });

    it('should match at end of string', () => {
      const matches = ac.search('I know python');
      expect(matches).toHaveLength(1);
      expect(matches[0].position).toBe(7);
    });

    it('should match when entire string is the pattern', () => {
      const matches = ac.search('python');
      expect(matches).toHaveLength(1);
    });

    it('should match multiple occurrences', () => {
      const matches = ac.search('python and python');
      expect(matches).toHaveLength(2);
      expect(matches[0].position).toBe(0);
      expect(matches[1].position).toBe(11);
    });

    it('should be case-insensitive', () => {
      const matches = ac.search('PYTHON Developer');
      expect(matches).toHaveLength(1);
      expect(matches[0].canonical).toBe('python');
    });

    it('should NOT match as substring of a word', () => {
      expect(ac.search('pythonic')).toHaveLength(0);
      expect(ac.search('cpython')).toHaveLength(0);
      expect(ac.search('pythons')).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Multi-Pattern Matching
  // ═══════════════════════════════════════════════════════════════════════════

  describe('multi-pattern', () => {
    const ac = buildSimple({
      python: 'python',
      javascript: 'javascript',
      java: 'java',
      typescript: 'typescript',
    });

    it('should find all patterns in text', () => {
      const skills = ac.extractSkills('python javascript typescript java developer');
      expect(skills).toEqual(new Set(['python', 'javascript', 'typescript', 'java']));
    });

    it('should NOT match "java" inside "javascript"', () => {
      const matches = ac.search('javascript developer');
      const javaCandidates = matches.filter((m) => m.canonical === 'java');
      expect(javaCandidates).toHaveLength(0);
    });

    it('should match "java" separately from "javascript"', () => {
      const matches = ac.search('java and javascript');
      expect(matches.filter((m) => m.canonical === 'java')).toHaveLength(1);
      expect(matches.filter((m) => m.canonical === 'javascript')).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Alias → Canonical Deduplication
  // ═══════════════════════════════════════════════════════════════════════════

  describe('alias deduplication', () => {
    const ac = new AhoCorasickAutomaton(
      new Map([
        ['python', 'python'],
        ['py', 'python'],
        ['python3', 'python'],
        ['react', 'react'],
        ['reactjs', 'react'],
        ['react.js', 'react'],
      ]),
    );

    it('should deduplicate aliases to canonical in extractSkills', () => {
      const skills = ac.extractSkills('py and reactjs');
      expect(skills).toEqual(new Set(['python', 'react']));
    });

    it('should report individual matches in search()', () => {
      const matches = ac.search('python and py');
      expect(matches).toHaveLength(2);
      expect(matches[0].pattern).toBe('python');
      expect(matches[1].pattern).toBe('py');
      // Both map to same canonical
      expect(matches[0].canonical).toBe('python');
      expect(matches[1].canonical).toBe('python');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Word Boundary Edge Cases (ADVERSARIAL)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('word boundaries — adversarial', () => {
    const ac = buildSimple({
      'node.js': 'node.js',
      nodejs: 'node.js',
      'c#': 'c#',
      'ci/cd': 'ci/cd',
      sql: 'sql',
      css: 'css',
      go: 'go',
      r: 'r',
    });

    it('should match "node.js" with dots as non-word chars', () => {
      expect(ac.extractSkills('I use node.js daily')).toEqual(new Set(['node.js']));
    });

    it('should NOT match "node.js" inside "node.json"', () => {
      expect(ac.extractSkills('node.json parser')).toEqual(new Set([]));
    });

    it('should match "c#" with hash as non-word char', () => {
      expect(ac.extractSkills('c# developer')).toEqual(new Set(['c#']));
    });

    it('should NOT match "c#" inside "c#sharp"', () => {
      expect(ac.extractSkills('c#sharp')).toEqual(new Set([]));
    });

    it('should match "ci/cd" with slash as non-word char', () => {
      expect(ac.extractSkills('ci/cd pipelines')).toEqual(new Set(['ci/cd']));
    });

    it('should match skill after comma', () => {
      expect(ac.extractSkills('python,sql,css')).toEqual(new Set(['sql', 'css']));
    });

    it('should match skill after semicolon', () => {
      expect(ac.extractSkills('skills: sql; css')).toEqual(new Set(['sql', 'css']));
    });

    it('should match skill inside parentheses', () => {
      expect(ac.extractSkills('languages (sql, css)')).toEqual(new Set(['sql', 'css']));
    });

    it('should match skill after dash', () => {
      expect(ac.extractSkills('- sql\n- css')).toEqual(new Set(['sql', 'css']));
    });

    it('should NOT match "go" inside "going" or "algorithm"', () => {
      expect(ac.extractSkills('going forward with algorithms')).toEqual(new Set([]));
    });

    it('should match "go" as standalone word', () => {
      expect(ac.extractSkills('I use go and python')).toEqual(new Set(['go']));
    });

    it('should handle single-char pattern "r" at word boundary', () => {
      expect(ac.extractSkills('I use r for stats')).toEqual(new Set(['r']));
    });

    it('should NOT match single-char "r" inside "react"', () => {
      expect(ac.extractSkills('react developer')).toEqual(new Set([]));
    });

    it('should match single-char "r" at start of string', () => {
      expect(ac.extractSkills('r is great')).toEqual(new Set(['r']));
    });

    it('should match single-char "r" at end of string', () => {
      expect(ac.extractSkills('I use r')).toEqual(new Set(['r']));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Unicode & Special Characters (ADVERSARIAL)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('unicode and special characters', () => {
    const ac = buildSimple({
      python: 'python',
      react: 'react',
      docker: 'docker',
    });

    it('should match after emoji (surrogate pair boundary)', () => {
      expect(ac.extractSkills('🚀 python developer')).toEqual(new Set(['python']));
    });

    it('should match before emoji', () => {
      expect(ac.extractSkills('python 🚀')).toEqual(new Set(['python']));
    });

    it('should match between emoji', () => {
      expect(ac.extractSkills('🎉 python 🎊')).toEqual(new Set(['python']));
    });

    it('should match with null bytes as boundaries', () => {
      expect(ac.extractSkills('python\0react\0docker')).toEqual(
        new Set(['python', 'react', 'docker']),
      );
    });

    it('should match inside HTML tags (tags are text)', () => {
      expect(ac.extractSkills('<span>python</span>')).toEqual(new Set(['python']));
    });

    it('should match after HTML tag closing bracket', () => {
      expect(ac.extractSkills('<b>python</b> react')).toEqual(
        new Set(['python', 'react']),
      );
    });

    it('should handle RTL text mixed with skills', () => {
      expect(ac.extractSkills('مطور python خبرة')).toEqual(new Set(['python']));
    });

    it('should handle zero-width space as boundary', () => {
      const zws = '\u200B';
      expect(ac.extractSkills(`python${zws}react`)).toEqual(
        new Set(['python', 'react']),
      );
    });

    it('should NOT match through zero-width joiner splitting a word', () => {
      const zwj = '\u200D';
      expect(ac.extractSkills(`pyt${zwj}hon`)).toEqual(new Set([]));
    });

    it('should handle CRLF line endings', () => {
      expect(ac.extractSkills('python\r\nreact\r\ndocker')).toEqual(
        new Set(['python', 'react', 'docker']),
      );
    });

    it('should handle tab-separated values', () => {
      expect(ac.extractSkills('python\treact\tdocker')).toEqual(
        new Set(['python', 'react', 'docker']),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Overlapping Patterns
  // ═══════════════════════════════════════════════════════════════════════════

  describe('overlapping patterns', () => {
    it('should handle pattern that is prefix of another', () => {
      const ac = new AhoCorasickAutomaton(
        new Map([
          ['machine learning', 'machine learning'],
          ['machine', 'machine'],
        ]),
      );
      const skills = ac.extractSkills('machine learning engineer');
      expect(skills.has('machine learning')).toBe(true);
      expect(skills.has('machine')).toBe(true);
    });

    it('should handle pattern that is suffix of another', () => {
      const ac = new AhoCorasickAutomaton(
        new Map([
          ['deep learning', 'deep learning'],
          ['learning', 'learning'],
        ]),
      );
      const skills = ac.extractSkills('deep learning');
      expect(skills.has('deep learning')).toBe(true);
      expect(skills.has('learning')).toBe(true);
    });

    it('should handle nested patterns with different canonicals', () => {
      const ac = new AhoCorasickAutomaton(
        new Map([
          ['rest api', 'rest api'],
          ['rest', 'rest'],
          ['api', 'api'],
        ]),
      );
      const skills = ac.extractSkills('rest api development');
      expect(skills.has('rest api')).toBe(true);
      expect(skills.has('rest')).toBe(true);
      expect(skills.has('api')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. countOccurrences
  // ═══════════════════════════════════════════════════════════════════════════

  describe('countOccurrences', () => {
    const ac = buildSimple({ python: 'python', react: 'react' });

    it('should count multiple occurrences of same skill', () => {
      const counts = ac.countOccurrences('python and python and python');
      expect(counts.get('python')).toBe(3);
    });

    it('should count different skills independently', () => {
      const counts = ac.countOccurrences('python react python');
      expect(counts.get('python')).toBe(2);
      expect(counts.get('react')).toBe(1);
    });

    it('should return empty map for no matches', () => {
      const counts = ac.countOccurrences('no skills here');
      expect(counts.size).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. containsTerm / containsTermLower (static)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('containsTerm (static)', () => {
    it('should find term with word boundaries', () => {
      expect(AhoCorasickAutomaton.containsTerm('I know python well', 'python')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(AhoCorasickAutomaton.containsTerm('I know PYTHON well', 'python')).toBe(true);
    });

    it('should NOT match substring', () => {
      expect(AhoCorasickAutomaton.containsTerm('pythonic code', 'python')).toBe(false);
    });

    it('should match at start', () => {
      expect(AhoCorasickAutomaton.containsTerm('python is great', 'python')).toBe(true);
    });

    it('should match at end', () => {
      expect(AhoCorasickAutomaton.containsTerm('I use python', 'python')).toBe(true);
    });

    it('should match entire string', () => {
      expect(AhoCorasickAutomaton.containsTerm('python', 'python')).toBe(true);
    });

    it('should return false for empty text', () => {
      expect(AhoCorasickAutomaton.containsTerm('', 'python')).toBe(false);
    });

    it('should return false for empty term in non-empty text', () => {
      expect(AhoCorasickAutomaton.containsTerm('test', '')).toBe(false);
    });

    it('should handle empty term in empty text', () => {
      expect(AhoCorasickAutomaton.containsTerm('', '')).toBe(true);
    });

    it('should handle null bytes', () => {
      expect(AhoCorasickAutomaton.containsTerm('a\0python\0b', 'python')).toBe(true);
    });
  });

  describe('containsTermLower (static)', () => {
    it('should work with pre-lowered inputs', () => {
      expect(AhoCorasickAutomaton.containsTermLower('i know python', 'python')).toBe(true);
    });

    it('should NOT find uppercase when inputs not pre-lowered', () => {
      expect(AhoCorasickAutomaton.containsTermLower('I know PYTHON', 'python')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. countTerm / countTermLower (static)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('countTerm (static)', () => {
    it('should count occurrences with boundaries', () => {
      expect(AhoCorasickAutomaton.countTerm('python and python', 'python')).toBe(2);
    });

    it('should NOT count substrings', () => {
      expect(AhoCorasickAutomaton.countTerm('pythonic pythonista', 'python')).toBe(0);
    });

    it('should return 0 for empty text', () => {
      expect(AhoCorasickAutomaton.countTerm('', 'python')).toBe(0);
    });

    it('should count mixed boundary types', () => {
      expect(AhoCorasickAutomaton.countTerm('python,python;python.python', 'python')).toBe(4);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. Empty / Degenerate Inputs (ADVERSARIAL)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('empty and degenerate inputs', () => {
    const ac = buildSimple({ python: 'python' });

    it('should return no matches for empty string', () => {
      expect(ac.search('')).toHaveLength(0);
    });

    it('should return no matches for whitespace-only string', () => {
      expect(ac.search('   \t\n  ')).toHaveLength(0);
    });

    it('should handle very long text without stack overflow', () => {
      const longText = 'python '.repeat(10000);
      const matches = ac.search(longText);
      expect(matches).toHaveLength(10000);
    });

    it('should handle text with only delimiters', () => {
      expect(ac.search(',,,,;;;;....')).toHaveLength(0);
    });

    it('should handle single character text', () => {
      expect(ac.search('p')).toHaveLength(0);
    });

    it('should handle text shorter than pattern', () => {
      expect(ac.search('py')).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. Failure Link Correctness (pattern-is-suffix-of-another)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('failure link correctness', () => {
    it('should find shorter pattern via failure links when longer fails', () => {
      const ac = new AhoCorasickAutomaton(
        new Map([
          ['abcd', 'abcd'],
          ['bcd', 'bcd'],
        ]),
      );
      const skills = ac.extractSkills('xbcd y');
      expect(skills.has('bcd')).toBe(false);

      const skills2 = ac.extractSkills(' bcd y');
      expect(skills2.has('bcd')).toBe(true);
    });

    it('should handle overlapping failure chains', () => {
      const ac = new AhoCorasickAutomaton(
        new Map([
          ['she', 'she'],
          ['he', 'he'],
          ['her', 'her'],
          ['hers', 'hers'],
        ]),
      );
      const matches = ac.search('she said hers');
      const patterns = matches.map((m) => m.pattern);
      expect(patterns).toContain('she');
      expect(patterns).toContain('hers');
      expect(patterns).not.toContain('he');
      expect(patterns).not.toContain('her');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. Security: Input Bombs & Malicious Patterns
  // ═══════════════════════════════════════════════════════════════════════════

  describe('security — input bombs', () => {
    it('should handle 10KB text without timeout', () => {
      const ac = buildSimple({ python: 'python', react: 'react' });
      const text = 'a '.repeat(5000) + 'python' + ' b'.repeat(5000);
      const start = performance.now();
      const matches = ac.search(text);
      const elapsed = performance.now() - start;
      expect(matches).toHaveLength(1);
      expect(elapsed).toBeLessThan(100);
    });

    it('should handle 100K repeated pattern text', () => {
      const ac = buildSimple({ a: 'a' });
      const text = 'a '.repeat(50000);
      const start = performance.now();
      const matches = ac.search(text);
      const elapsed = performance.now() - start;
      expect(matches).toHaveLength(50000);
      expect(elapsed).toBeLessThan(500);
    });

    it('should handle pattern with special regex chars as literals', () => {
      const ac = new AhoCorasickAutomaton(
        new Map([
          ['c++', 'c++'],
          ['c#', 'c#'],
          ['.net', '.net'],
        ]),
      );
      expect(ac.extractSkills('I use c++ and c# and .net')).toEqual(
        new Set(['c++', 'c#', '.net']),
      );
    });

    it('should not crash on null byte patterns', () => {
      const ac = new AhoCorasickAutomaton(
        new Map([['test\0skill', 'test-skill']]),
      );
      expect(ac.search('test\0skill here')).toHaveLength(1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. buildTaxonomyAutomaton — Convenience Factory
// ═══════════════════════════════════════════════════════════════════════════

describe('buildTaxonomyAutomaton', () => {
  it('should build an automaton from the real taxonomy', () => {
    const automaton = buildTaxonomyAutomaton(taxonomy);
    expect(automaton.size).toBeGreaterThan(10000);
  });

  it('should find known skills in text', () => {
    const automaton = buildTaxonomyAutomaton(taxonomy);
    const skills = automaton.extractSkills('experienced python and react developer');
    expect(skills.has('python')).toBe(true);
    expect(skills.has('react')).toBe(true);
  });

  it('should resolve aliases to canonicals', () => {
    const automaton = buildTaxonomyAutomaton(taxonomy);
    const skills = automaton.extractSkills('proficient in k8s and js');
    expect(skills.has('kubernetes')).toBe(true);
    expect(skills.has('javascript')).toBe(true);
  });

  it('should not match non-skills', () => {
    const automaton = buildTaxonomyAutomaton(taxonomy);
    const skills = automaton.extractSkills('the quick brown fox jumps over the lazy dog');
    // No common skills in this sentence
    expect(skills.size).toBeLessThanOrEqual(1); // "fox" or similar might be a niche match
  });
});
