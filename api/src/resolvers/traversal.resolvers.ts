import neo4j, { type Record as Neo4jRecord, type PathSegment } from 'neo4j-driver';
import type { GraphContext, SkillDTO } from '../types/index.js';
import { mapSkillNode } from '../neo4j/mapper.js';
import {
  BROADER_TERMS_N_LEVELS,
  RELATED_SKILLS_N_HOPS,
  SHORTEST_PATH,
  LEARNING_PATH,
} from '../neo4j/queries.js';

function nodeToSkillDTO(properties: Record<string, unknown>): SkillDTO {
  const p = properties;
  return Object.freeze({
    canonicalName: (p.canonicalName as string) ?? '',
    description: (p.description as string) ?? '',
    aliases: Array.isArray(p.aliases) ? p.aliases : [],
    category: (p.category as string) ?? '',
    parentCategory: (p.parentCategory as string) ?? '',
    skillType: (p.skillType as string) ?? '',
    ecosystem: (p.ecosystem as string) ?? '',
    senioritySignal: (p.senioritySignal as string) ?? '',
    trendDirection: (p.trendDirection as string) ?? '',
    demandLevel: (p.demandLevel as string) ?? '',
    confidence: (p.confidence as string) ?? 'pending',
    isValidSkill: (p.isValidSkill as boolean) ?? true,
    isOpenSource: (p.isOpenSource as boolean | null) ?? null,
    isRegionSpecific: (p.isRegionSpecific as string | null) ?? null,
    learningDifficulty: (p.learningDifficulty as string) ?? '',
    typicalExperienceYears: (p.typicalExperienceYears as string) ?? '',
    salaryImpact: (p.salaryImpact as string) ?? '',
    automationRisk: (p.automationRisk as string) ?? '',
    communitySize: (p.communitySize as string) ?? '',
    emergingYear: null,
    sources: Array.isArray(p.sources) ? p.sources : [],
    keywords: Array.isArray(p.keywords) ? p.keywords : [],
    commonJobTitles: Array.isArray(p.commonJobTitles) ? p.commonJobTitles : [],
    certifications: Array.isArray(p.certifications) ? p.certifications : [],
    unresolvedBroaderTerms: Array.isArray(p.unresolvedBroaderTerms) ? p.unresolvedBroaderTerms : [],
    unresolvedRelatedSkills: Array.isArray(p.unresolvedRelatedSkills) ? p.unresolvedRelatedSkills : [],
    unresolvedPrerequisites: Array.isArray(p.unresolvedPrerequisites) ? p.unresolvedPrerequisites : [],
    unresolvedComplementarySkills: Array.isArray(p.unresolvedComplementarySkills) ? p.unresolvedComplementarySkills : [],
  });
}

function extractPath(record: Neo4jRecord) {
  const path = record.get('path');
  const skills = path.segments.map((seg: PathSegment) =>
    nodeToSkillDTO(seg.end.properties as Record<string, unknown>),
  );

  const startSkill = nodeToSkillDTO(path.start.properties as Record<string, unknown>);
  const allSkills = [startSkill, ...skills];
  const relationships = path.segments.map((seg: PathSegment) => seg.relationship.type);

  return {
    skills: allSkills,
    relationships,
    length: path.length,
  };
}

export const traversalResolvers = {
  Query: {
    broaderTerms: async (
      _: unknown,
      args: { canonicalName: string; depth?: number },
      ctx: GraphContext,
    ) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(BROADER_TERMS_N_LEVELS, {
          name: args.canonicalName.toLowerCase(),
          depth: neo4j.int(Math.min(args.depth ?? 1, 10)),
        });
        return result.records.map((r) => mapSkillNode(r));
      } finally {
        await session.close();
      }
    },

    relatedSkills: async (
      _: unknown,
      args: { canonicalName: string; hops?: number; limit?: number },
      ctx: GraphContext,
    ) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(RELATED_SKILLS_N_HOPS, {
          name: args.canonicalName.toLowerCase(),
          hops: neo4j.int(Math.min(args.hops ?? 1, 5)),
          limit: neo4j.int(args.limit ?? 20),
        });
        return result.records.map((r) => mapSkillNode(r));
      } finally {
        await session.close();
      }
    },

    shortestPath: async (
      _: unknown,
      args: { from: string; to: string },
      ctx: GraphContext,
    ) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(SHORTEST_PATH, {
          from: args.from.toLowerCase(),
          to: args.to.toLowerCase(),
        });
        if (result.records.length === 0) return null;
        return extractPath(result.records[0]);
      } finally {
        await session.close();
      }
    },

    learningPath: async (
      _: unknown,
      args: { from: string; to: string },
      ctx: GraphContext,
    ) => {
      const session = ctx.driver.session({ defaultAccessMode: 'READ' });
      try {
        const result = await session.run(LEARNING_PATH, {
          from: args.from.toLowerCase(),
          to: args.to.toLowerCase(),
        });
        if (result.records.length === 0) return null;
        return extractPath(result.records[0]);
      } finally {
        await session.close();
      }
    },
  },
};
