import { describe, it, expect } from 'vitest';
import { taxonomy, buildReverseLookup, buildCanonicalSet, getStats } from '../src/index';

describe('skill-taxonomy', () => {
  describe('taxonomy structure', () => {
    it('should be a non-empty object', () => {
      expect(typeof taxonomy).toBe('object');
      expect(Object.keys(taxonomy).length).toBeGreaterThan(0);
    });

    it('should have string arrays as values', () => {
      for (const [canonical, aliases] of Object.entries(taxonomy)) {
        expect(Array.isArray(aliases), `"${canonical}" should have array aliases`).toBe(true);
        for (const alias of aliases) {
          expect(typeof alias, `"${canonical}" alias should be string`).toBe('string');
        }
      }
    });

    it('should have no empty canonical names', () => {
      for (const canonical of Object.keys(taxonomy)) {
        expect(canonical.trim().length, `Empty canonical found`).toBeGreaterThan(0);
      }
    });

    it('should have no duplicate aliases across different entries', () => {
      const aliasMap = new Map<string, string>();
      const duplicates: string[] = [];

      for (const [canonical, aliases] of Object.entries(taxonomy)) {
        for (const alias of aliases) {
          const lower = alias.toLowerCase();
          const owner = aliasMap.get(lower);
          if (owner !== undefined && owner !== canonical.toLowerCase()) {
            duplicates.push(`"${alias}" in both "${owner}" and "${canonical}"`);
          }
          aliasMap.set(lower, canonical.toLowerCase());
        }
      }

      expect(duplicates, `Duplicate aliases found: ${duplicates.join(', ')}`).toHaveLength(0);
    });

    it('should have no duplicate aliases within the same entry', () => {
      const duplicates: string[] = [];

      for (const [canonical, aliases] of Object.entries(taxonomy)) {
        const seen = new Set<string>();
        for (const alias of aliases) {
          const lower = alias.toLowerCase();
          if (seen.has(lower)) {
            duplicates.push(`"${alias}" duplicated in "${canonical}"`);
          }
          seen.add(lower);
        }
      }

      expect(duplicates, `Intra-entry duplicates: ${duplicates.join(', ')}`).toHaveLength(0);
    });
  });

  describe('buildReverseLookup', () => {
    const lookup = buildReverseLookup(taxonomy);

    it('should map every canonical to itself', () => {
      for (const canonical of Object.keys(taxonomy)) {
        const lower = canonical.toLowerCase();
        expect(lookup.get(lower)).toBe(lower);
      }
    });

    it('should map every alias to its canonical', () => {
      for (const [canonical, aliases] of Object.entries(taxonomy)) {
        for (const alias of aliases) {
          expect(lookup.get(alias.toLowerCase())).toBe(canonical.toLowerCase());
        }
      }
    });

    it('should return undefined for unknown terms', () => {
      expect(lookup.get('xyzzy_nonexistent_skill_42')).toBeUndefined();
    });
  });

  describe('buildCanonicalSet', () => {
    const set = buildCanonicalSet(taxonomy);

    it('should contain all canonical names lowercase', () => {
      for (const canonical of Object.keys(taxonomy)) {
        expect(set.has(canonical.toLowerCase())).toBe(true);
      }
    });

    it('should not contain aliases', () => {
      // Check a few known aliases
      expect(set.has('js')).toBe(false);
      expect(set.has('k8s')).toBe(false);
    });
  });

  describe('getStats', () => {
    const stats = getStats(taxonomy);

    it('should return correct canonical count', () => {
      expect(stats.canonicals).toBe(Object.keys(taxonomy).length);
    });

    it('should return correct alias count', () => {
      const expected = Object.values(taxonomy).reduce((sum, a) => sum + a.length, 0);
      expect(stats.aliases).toBe(expected);
    });

    it('should have total = canonicals + aliases', () => {
      expect(stats.total).toBe(stats.canonicals + stats.aliases);
    });
  });
});
