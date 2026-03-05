import neo4j from 'neo4j-driver';
import type { GraphContext } from '../types/index.js';
import { mapSkillNode } from '../neo4j/mapper.js';
import { SEARCH_SKILLS_FUZZY } from '../neo4j/queries.js';

export const searchResolvers = {
  Query: {
    searchSkills: async (
      _: unknown,
      args: { query: string; limit?: number },
      ctx: GraphContext,
    ) => {
      const searchTerm = args.query.trim();
      if (!searchTerm) return [];

      // Append wildcard for prefix matching; escape special Lucene chars
      const sanitized = searchTerm.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
      const fuzzyTerm = `${sanitized}*`;

      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(SEARCH_SKILLS_FUZZY, {
          searchTerm: fuzzyTerm,
          limit: neo4j.int(args.limit ?? 20),
        });
        return result.records.map((r) => ({
          skill: mapSkillNode(r),
          score: r.get('score') as number,
        }));
      } finally {
        await session.close();
      }
    },
  },
};
