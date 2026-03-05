import neo4j from 'neo4j-driver';
import type { GraphContext, SkillDTO, SkillFilter } from '../types/index.js';
import { mapSkillNode } from '../neo4j/mapper.js';
import {
  FIND_SKILL_BY_NAME,
  FIND_SKILL_BY_ALIAS,
  FILTER_SKILLS,
  COUNT_SKILLS,
  SKILL_BROADER_TERMS,
  SKILL_RELATED,
  SKILL_COMPLEMENTARY,
  SKILL_ALTERNATIVES,
  SKILL_PREREQUISITES,
  SKILL_INDUSTRIES,
} from '../neo4j/queries.js';

function filterParams(filter?: SkillFilter | null) {
  return {
    ecosystem: filter?.ecosystem ?? null,
    category: filter?.category ?? null,
    skillType: filter?.skillType ?? null,
    demandLevel: filter?.demandLevel?.toLowerCase() ?? null,
    trendDirection: filter?.trendDirection?.toLowerCase() ?? null,
    confidence: filter?.confidence?.toLowerCase() ?? null,
    senioritySignal: filter?.senioritySignal ?? null,
    isValidSkill: filter?.isValidSkill ?? null,
  };
}

export const skillResolvers = {
  Query: {
    skill: async (_: unknown, args: { canonicalName: string }, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(FIND_SKILL_BY_NAME, {
          name: args.canonicalName.toLowerCase(),
        });
        return result.records.length > 0 ? mapSkillNode(result.records[0]) : null;
      } finally {
        await session.close();
      }
    },

    skillByAlias: async (_: unknown, args: { alias: string }, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(FIND_SKILL_BY_ALIAS, {
          alias: args.alias.toLowerCase(),
        });
        return result.records.length > 0 ? mapSkillNode(result.records[0]) : null;
      } finally {
        await session.close();
      }
    },

    skills: async (
      _: unknown,
      args: { filter?: SkillFilter | null; limit?: number; offset?: number },
      ctx: GraphContext,
    ) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(FILTER_SKILLS, {
          ...filterParams(args.filter),
          limit: neo4j.int(args.limit ?? 25),
          offset: neo4j.int(args.offset ?? 0),
        });
        return result.records.map((r) => mapSkillNode(r));
      } finally {
        await session.close();
      }
    },

    skillCount: async (_: unknown, args: { filter?: SkillFilter | null }, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(COUNT_SKILLS, filterParams(args.filter));
        return result.records[0]?.get('total')?.toNumber?.() ?? 0;
      } finally {
        await session.close();
      }
    },
  },

  Skill: {
    broaderTerms: async (parent: SkillDTO, _args: unknown, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(SKILL_BROADER_TERMS, { name: parent.canonicalName });
        return result.records.map((r) => mapSkillNode(r));
      } finally {
        await session.close();
      }
    },

    relatedSkills: async (parent: SkillDTO, args: { limit?: number }, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(SKILL_RELATED, {
          name: parent.canonicalName,
          limit: neo4j.int(args.limit ?? 20),
        });
        return result.records.map((r) => mapSkillNode(r));
      } finally {
        await session.close();
      }
    },

    complementarySkills: async (parent: SkillDTO, _args: unknown, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(SKILL_COMPLEMENTARY, { name: parent.canonicalName });
        return result.records.map((r) => mapSkillNode(r));
      } finally {
        await session.close();
      }
    },

    alternativeSkills: async (parent: SkillDTO, _args: unknown, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(SKILL_ALTERNATIVES, { name: parent.canonicalName });
        return result.records.map((r) => mapSkillNode(r));
      } finally {
        await session.close();
      }
    },

    prerequisites: async (parent: SkillDTO, _args: unknown, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(SKILL_PREREQUISITES, { name: parent.canonicalName });
        return result.records.map((r) => mapSkillNode(r));
      } finally {
        await session.close();
      }
    },

    industries: async (parent: SkillDTO, _args: unknown, ctx: GraphContext) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(SKILL_INDUSTRIES, { name: parent.canonicalName });
        return result.records.map((r) => ({
          name: r.get('i').properties.name as string,
        }));
      } finally {
        await session.close();
      }
    },
  },
};
