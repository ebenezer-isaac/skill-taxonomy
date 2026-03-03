/**
 * Core taxonomy types for the enterprise-grade skill ontology engine.
 *
 * Supports:
 * - Hierarchical parent-child relationships (SKOS-style)
 * - Multi-source provenance tracking
 * - Semantic similarity scoring
 * - Cross-lingual aliases
 */

/** Source systems for skill data ingestion */
export type SkillSource =
  | 'esco'
  | 'onet'
  | 'stackoverflow'
  | 'lightcast'
  | 'linkedin'
  | 'wikipedia'
  | 'llm-generated'
  | 'telemetry-miss'
  | 'manual-curation'
  | 'industry-vertical';

/** ESCO skill types from EU taxonomy */
export type ESCOSkillType = 'skill' | 'competence' | 'knowledge';

/** ESCO reuse levels indicating skill transferability */
export type ESCOReuseLevel = 'transversal' | 'cross-sector' | 'sector-specific' | 'occupation-specific';

/** O*NET technology classification indicators */
export interface ONETClassification {
  readonly hotTechnology: boolean;
  readonly inDemand: boolean;
  readonly unspscCode?: string;
  readonly commodityTitle?: string;
}

/** Industry vertical categories */
export type IndustryVertical =
  | 'software-engineering'
  | 'finance'
  | 'healthcare'
  | 'data-analytics'
  | 'design'
  | 'devops-platform'
  | 'game-development'
  | 'cybersecurity'
  | 'blockchain'
  | 'iot-embedded'
  | 'ai-ml'
  | 'general';

/** Alias with metadata about its origin and confidence */
export interface AliasEntry {
  readonly term: string;
  readonly source: SkillSource;
  readonly confidence: number; // 0.0 - 1.0
  readonly language?: string; // ISO 639-1 code
  readonly isAbbreviation?: boolean;
  readonly isVersionVariant?: boolean;
}

/** Hierarchical relationship between skills */
export interface SkillRelation {
  readonly targetUri: string;
  readonly relationType: 'broader' | 'narrower' | 'related' | 'similar';
  readonly confidence: number;
  readonly source: SkillSource;
}

/** Full skill node for the knowledge graph */
export interface SkillNode {
  /** Unique identifier (URI-style for ESCO compatibility) */
  readonly uri: string;
  /** Canonical display name (lowercase, normalized) */
  readonly canonicalName: string;
  /** Human-readable preferred label */
  readonly preferredLabel: string;
  /** Extended description */
  readonly description?: string;
  /** All known aliases with metadata */
  readonly aliases: readonly AliasEntry[];
  /** Parent/child/related skill relationships */
  readonly relations: readonly SkillRelation[];
  /** Data sources this skill was derived from */
  readonly sources: readonly SkillSource[];
  /** Industry verticals this skill applies to */
  readonly verticals: readonly IndustryVertical[];
  /** ESCO-specific classification */
  readonly escoMeta?: {
    readonly skillType: ESCOSkillType;
    readonly reuseLevel: ESCOReuseLevel;
    readonly occupationCount: number;
  };
  /** O*NET-specific classification */
  readonly onetMeta?: ONETClassification;
  /** Timestamp of last update */
  readonly updatedAt: string;
  /** Embedding vector for semantic search (optional, computed separately) */
  readonly embedding?: readonly number[];
}

/** Flat taxonomy format for backward compatibility */
export type SkillTaxonomy = Readonly<Record<string, readonly string[]>>;

/** Stats about a loaded taxonomy */
export interface TaxonomyStats {
  readonly canonicals: number;
  readonly aliases: number;
  readonly total: number;
  readonly bySource?: Readonly<Record<SkillSource, number>>;
  readonly byVertical?: Readonly<Record<IndustryVertical, number>>;
}

/** Candidate entry for import processing */
export interface CandidateEntry {
  readonly canonical: string;
  readonly aliases: readonly string[];
  readonly source: SkillSource;
  readonly category?: string;
  readonly confidence?: number;
  readonly relations?: readonly SkillRelation[];
  readonly verticals?: readonly IndustryVertical[];
}

/** Result of a merge operation */
export interface MergeResult {
  readonly added: number;
  readonly aliasesExpanded: number;
  readonly conflicts: readonly MergeConflict[];
}

/** Conflict during merge */
export interface MergeConflict {
  readonly term: string;
  readonly existingOwner: string;
  readonly newOwner: string;
  readonly resolution: 'kept-existing' | 'overwrote' | 'deferred';
}

/** Telemetry miss event from ATS parsing */
export interface TelemetryMissEvent {
  readonly keyword: string;
  readonly passLevel: 2 | 3;
  readonly timestamp: string;
  readonly jobTitle?: string;
  readonly jobDescriptionSnippet?: string;
  readonly normalizedKeyword: string;
}

/** Aggregated miss data for promotion */
export interface AggregatedMiss {
  readonly keyword: string;
  readonly count: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly sampleJobTitles: readonly string[];
  readonly sampleSnippets: readonly string[];
}

/** LLM validation result for alias candidates */
export interface LLMValidationResult {
  readonly alias: string;
  readonly canonical: string;
  readonly classification:
    | 'exact-synonym'
    | 'version-variant'
    | 'ecosystem-component'
    | 'abbreviation'
    | 'related-but-distinct'
    | 'invalid-noise';
  readonly confidence: number;
  readonly reasoning?: string;
}

/** Semantic similarity result */
export interface SemanticMatch {
  readonly termA: string;
  readonly termB: string;
  readonly cosineSimilarity: number;
  readonly shouldMerge: boolean;
}

/** Entity resolution decision */
export interface EntityResolutionDecision {
  readonly sourceTerms: readonly string[];
  readonly canonicalTerm: string;
  readonly mergedAliases: readonly string[];
  readonly confidence: number;
  readonly method: 'fuzzy' | 'semantic' | 'exact' | 'manual';
}
