import neo4j from 'neo4j-driver';
import type { GraphContext } from '../types/index.js';
import { mapSkillNode } from '../neo4j/mapper.js';
import {
  ALL_INDUSTRIES,
  ALL_CATEGORIES,
  ALL_ECOSYSTEMS,
  INDUSTRY_SKILLS,
  CATEGORY_SKILLS,
  TAXONOMY_STATS,
  TOTAL_RELATIONSHIPS,
  TOTAL_CATEGORIES,
  PROCESSED_COUNT,
  SKILL_TYPE_DISTRIBUTION,
  DEMAND_LEVEL_DISTRIBUTION,
  TREND_DISTRIBUTION,
} from '../neo4j/queries.js';

export const taxonomyResolvers = {
  Query: {
    industries: async (_: unknown, _args: unknown, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(ALL_INDUSTRIES);
        return result.records.map((r) => ({
          name: r.get('i').properties.name as string,
        }));
      } finally {
        await session.close();
      }
    },

    categories: async (_: unknown, _args: unknown, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(ALL_CATEGORIES);
        return result.records.map((r) => ({
          name: r.get('c').properties.name as string,
        }));
      } finally {
        await session.close();
      }
    },

    ecosystems: async (_: unknown, _args: unknown, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(ALL_ECOSYSTEMS);
        return result.records.map((r) => r.get('ecosystem') as string);
      } finally {
        await session.close();
      }
    },

    stats: async (_: unknown, _args: unknown, ctx: GraphContext) => {
      const runQuery = async (query: string) => {
        const s = ctx.driver.session({ defaultAccessMode: 'READ' });
        try { return await s.run(query); }
        finally { await s.close(); }
      };

      const [statsRes, relRes, catRes, processedRes, typeRes, demandRes, trendRes] =
        await Promise.all([
          runQuery(TAXONOMY_STATS),
          runQuery(TOTAL_RELATIONSHIPS),
          runQuery(TOTAL_CATEGORIES),
          runQuery(PROCESSED_COUNT),
          runQuery(SKILL_TYPE_DISTRIBUTION),
          runQuery(DEMAND_LEVEL_DISTRIBUTION),
          runQuery(TREND_DISTRIBUTION),
        ]);

      return {
        totalSkills: statsRes.records[0]?.get('totalSkills')?.toNumber?.() ?? 0,
        totalIndustries: statsRes.records[0]?.get('totalIndustries')?.toNumber?.() ?? 0,
        totalCategories: catRes.records[0]?.get('total')?.toNumber?.() ?? 0,
        totalRelationships: relRes.records[0]?.get('total')?.toNumber?.() ?? 0,
        processedSkills: processedRes.records[0]?.get('total')?.toNumber?.() ?? 0,
        skillTypeDistribution: typeRes.records.map((r) => ({
          key: r.get('key') as string,
          count: (r.get('count') as neo4j.Integer).toNumber(),
        })),
        demandLevelDistribution: demandRes.records.map((r) => ({
          key: r.get('key') as string,
          count: (r.get('count') as neo4j.Integer).toNumber(),
        })),
        trendDistribution: trendRes.records.map((r) => ({
          key: r.get('key') as string,
          count: (r.get('count') as neo4j.Integer).toNumber(),
        })),
      };
    },
  },

  Industry: {
    skills: async (
      parent: { name: string },
      args: { limit?: number; offset?: number },
      ctx: GraphContext,
    ) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(INDUSTRY_SKILLS, {
          name: parent.name,
          limit: neo4j.int(args.limit ?? 50),
          offset: neo4j.int(args.offset ?? 0),
        });
        return result.records.map((r) => mapSkillNode(r));
      } finally {
        await session.close();
      }
    },
  },

  Category: {
    skills: async (
      parent: { name: string },
      args: { limit?: number; offset?: number },
      ctx: GraphContext,
    ) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(CATEGORY_SKILLS, {
          name: parent.name,
          limit: neo4j.int(args.limit ?? 50),
          offset: neo4j.int(args.offset ?? 0),
        });
        return result.records.map((r) => mapSkillNode(r));
      } finally {
        await session.close();
      }
    },
  },
};
