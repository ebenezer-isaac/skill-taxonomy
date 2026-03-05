/**
 * Core taxonomy types for the ATS skill matching engine.
 *
 * SkillTaxonomyMap is the canonical format (canonical → SkillEntry).
 * SkillTaxonomy is a flat derived view (canonical → aliases[]) for O(1) keyword matching.
 */

/** Data sources for skill provenance tracking */
export type SkillSource =
  | 'esco'
  | 'onet'
  | 'stackoverflow'
  | 'lightcast'
  | 'linkedin'
  | 'llm-generated'
  | 'manual-curation'
  | 'industry-vertical'
  | 'unknown';

/**
 * Full skill entry with ATS metadata.
 *
 * Single source of truth for each skill in the taxonomy.
 */
export interface SkillEntry {
  /** All known surface forms: synonyms, abbreviations, misspellings, versions, former names */
  aliases: string[];
  /** Best-fit skill category (e.g. 'programming-language', 'clinical', 'cad-tool') */
  category: string;
  /** One-sentence description of what this skill IS and what domain it belongs to */
  description: string;
  /** Industries that commonly require this skill */
  industries: string[];
  /** Career level this skill typically signals */
  senioritySignal: string;
  /**
   * Transferable parent concepts for ATS cross-matching.
   * NOT aliases — broader competencies implied by this skill.
   * Example: "adobe experience manager" → ["enterprise cms", "java development"]
   */
  broaderTerms: string[];
  /** Related but distinct skills (for recommendations, NOT aliases) */
  relatedSkills: string[];
  /** Whether this is a valid real-world skill */
  isValidSkill: boolean;
  /** LLM confidence level — 'pending' means not yet processed */
  confidence: 'high' | 'medium' | 'low' | 'pending';
  /** Data provenance: which sources this skill was found in */
  sources: string[];
  /** Classification: tool, framework, language, methodology, certification, etc. */
  skillType: string;
  /** Market trajectory: emerging, growing, stable, declining */
  trendDirection: string;
  /** Job market demand: high, medium, low, niche */
  demandLevel: string;
  /** 3-5 job titles that commonly require this skill */
  commonJobTitles: string[];
  /** 2-3 prerequisite skills needed before learning this one */
  prerequisites: string[];
  /** 3-5 skills commonly paired with this one in job descriptions */
  complementarySkills: string[];
  /** Relevant professional certifications */
  certifications: string[];
  /** Hierarchical parent category for taxonomy tree navigation */
  parentCategory: string;
  /** Region/country if skill is geographically specific, null if globally applicable */
  isRegionSpecific: string | null;
  /** Primary technology/professional ecosystem (e.g. "javascript", "jvm", "aws", "healthcare") */
  ecosystem: string;
  /** Competing or directly substitutable skills (React vs Angular vs Vue) */
  alternativeSkills: string[];
  /** Difficulty level to learn this skill */
  learningDifficulty: string;
  /** Typical years of experience when this skill appears on resumes */
  typicalExperienceYears: string;
  /** Salary/compensation impact of having this skill */
  salaryImpact: string;
  /** Risk of this skill being automated or obsoleted */
  automationRisk: string;
  /** Size of the practitioner/user community */
  communitySize: string;
  /** Whether this is open-source software (null if not applicable) */
  isOpenSource: boolean | null;
  /** Cross-cutting discovery tags for search and filtering */
  keywords: string[];
  /** Year this skill/technology emerged or was introduced (null if unknown/ancient) */
  emergingYear: number | null;
}

/** Canonical taxonomy map: skill name → full metadata */
export type SkillTaxonomyMap = Record<string, SkillEntry>;

/** Flat derived view for ATS runtime keyword matching (immutable for consumers) */
export type SkillTaxonomy = Readonly<Record<string, readonly string[]>>;

/** Stats about a loaded taxonomy */
export interface TaxonomyStats {
  readonly canonicals: number;
  readonly aliases: number;
  readonly total: number;
}

/** Candidate entry for import processing */
export interface CandidateEntry {
  readonly canonical: string;
  readonly aliases: readonly string[];
  readonly source: string;
  readonly category?: string;
}
