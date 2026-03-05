import type { Driver } from 'neo4j-driver';

/** Apollo Server context — available in every resolver */
export interface GraphContext {
  readonly driver: Driver;
}

/** Mapped skill DTO returned from Neo4j → GraphQL */
export interface SkillDTO {
  readonly canonicalName: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly category: string;
  readonly parentCategory: string;
  readonly skillType: string;
  readonly ecosystem: string;
  readonly senioritySignal: string;
  readonly trendDirection: string;
  readonly demandLevel: string;
  readonly confidence: string;
  readonly isValidSkill: boolean;
  readonly isOpenSource: boolean | null;
  readonly isRegionSpecific: string | null;
  readonly learningDifficulty: string;
  readonly typicalExperienceYears: string;
  readonly salaryImpact: string;
  readonly automationRisk: string;
  readonly communitySize: string;
  readonly emergingYear: number | null;
  readonly sources: readonly string[];
  readonly keywords: readonly string[];
  readonly commonJobTitles: readonly string[];
  readonly certifications: readonly string[];
  readonly unresolvedBroaderTerms: readonly string[];
  readonly unresolvedRelatedSkills: readonly string[];
  readonly unresolvedPrerequisites: readonly string[];
  readonly unresolvedComplementarySkills: readonly string[];
}

/** Filter input for skill listing */
export interface SkillFilter {
  readonly ecosystem?: string | null;
  readonly category?: string | null;
  readonly skillType?: string | null;
  readonly demandLevel?: string | null;
  readonly trendDirection?: string | null;
  readonly confidence?: string | null;
  readonly senioritySignal?: string | null;
  readonly isValidSkill?: boolean | null;
}

/** Search result with relevance score */
export interface SearchResult {
  readonly skill: SkillDTO;
  readonly score: number;
}

/** Path traversal result */
export interface PathResult {
  readonly skills: readonly SkillDTO[];
  readonly relationships: readonly string[];
  readonly length: number;
}

/** Key-count pair for distributions */
export interface KeyCount {
  readonly key: string;
  readonly count: number;
}

/** Taxonomy-wide statistics */
export interface TaxonomyStats {
  readonly totalSkills: number;
  readonly totalIndustries: number;
  readonly totalCategories: number;
  readonly totalRelationships: number;
  readonly enrichedSkills: number;
  readonly skillTypeDistribution: readonly KeyCount[];
  readonly demandLevelDistribution: readonly KeyCount[];
  readonly trendDistribution: readonly KeyCount[];
}
