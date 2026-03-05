/**
 * LLM-powered taxonomy processing using Gemini Flash.
 *
 * Processes every skill entry with 29 structured fields including:
 * category, broader terms, related skills, seniority signal, industry
 * relevance, trend direction, demand level, common job titles, and more.
 *
 * Features:
 * - Batch processing with configurable batch size (default 5)
 * - Checkpoint/resume for long runs
 * - Live apply — each batch is written to taxonomy immediately
 * - Source context injection from ESCO, O*NET, StackExchange, and verticals
 * - Structured output via Gemini's responseSchema (Zod → JSON Schema)
 *
 * Usage:
 *   pnpm validate:llm                    # run full enrichment
 *   pnpm validate:llm --resume           # resume from checkpoint
 *   pnpm validate:llm --skill=python     # single skill
 *   pnpm validate:llm --dry-run          # show prompt without calling API
 *   pnpm validate:llm --apply            # apply structural changes (remove/merge/rename)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import {
  normalize,
  loadTaxonomy,
  saveTaxonomy,
  taxonomyExists,
  buildKnownTerms,
} from './common';
import type { SkillTaxonomyMap, SkillEntry } from './common';

// Load .env file
function loadEnv(): void {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=');
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}
loadEnv();

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// CLI args
const RESUME_MODE = process.argv.includes('--resume');
const SINGLE_SKILL = process.argv.find(a => a.startsWith('--skill='))?.split('=')[1];
const DRY_RUN = process.argv.includes('--dry-run');
const APPLY_MODE = process.argv.includes('--apply');
const MODEL_ARG = process.argv.find(a => a.startsWith('--model='))?.split('=')[1] ?? 'flash';
const BATCH_ARG = process.argv.find(a => a.startsWith('--batch='))?.split('=')[1];
const CONCURRENCY = Math.max(1, parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] ?? '1', 10));

// Model selection: flash (free) or pro ($2/$12 per 1M tokens)
const MODELS: Record<string, { model: string; defaultBatch: number; delayMs: number; maxOutputTokens: number; thinkingBudget?: number }> = {
  flash: { model: 'gemini-3-flash-preview', defaultBatch: 1, delayMs: 1000, maxOutputTokens: 4096, thinkingBudget: 2048 },
  pro: { model: 'gemini-3.1-pro-preview', defaultBatch: 5, delayMs: 2000, maxOutputTokens: 16384 },
};

const MODEL_CONFIG = MODELS[MODEL_ARG] ?? MODELS.flash;
const GEMINI_MODEL = MODEL_CONFIG.model;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const BATCH_SIZE = BATCH_ARG ? parseInt(BATCH_ARG, 10) : MODEL_CONFIG.defaultBatch;
const DELAY_BETWEEN_REQUESTS_MS = MODEL_CONFIG.delayMs;
const MAX_OUTPUT_TOKENS = MODEL_CONFIG.maxOutputTokens;
const CHECKPOINT_INTERVAL = 25; // Save checkpoint every N API calls

// Output files
const OUTPUT_DIR = path.join(__dirname, 'data', 'validation');
const RESULTS_FILE = path.join(OUTPUT_DIR, 'validation-results.json');
const CHECKPOINT_FILE = path.join(OUTPUT_DIR, 'checkpoint.json');
const REPORT_FILE = path.join(OUTPUT_DIR, 'validation-report.md');

// ─── Domain-agnostic enums ───────────────────────────────────────────────────

const SKILL_CATEGORIES = [
  // Software & Engineering
  'programming-language', 'framework', 'library', 'runtime', 'sdk',
  'tool', 'platform', 'database', 'cloud-service', 'devops', 'cicd',
  'testing', 'api-protocol', 'architecture', 'operating-system',
  'networking', 'security', 'embedded', 'mobile', 'game-engine',
  'cms', 'ecommerce-platform', 'erp', 'blockchain', 'ai-ml',
  'data-science', 'data-engineering', 'bi-analytics',
  // Design & Creative
  'design-tool', 'ux-method', 'graphic-design', 'video-production',
  'audio-production', 'animation', '3d-modeling', 'typography',
  // Business & Management
  'project-management', 'agile-methodology', 'business-analysis',
  'product-management', 'strategy', 'leadership', 'communication',
  'negotiation', 'sales-technique', 'crm-platform',
  // Marketing & Growth
  'digital-marketing', 'seo-sem', 'social-media', 'content-strategy',
  'email-marketing', 'marketing-automation', 'analytics-tool',
  // Finance & Accounting
  'accounting', 'financial-analysis', 'financial-modeling',
  'tax', 'audit', 'risk-management', 'compliance', 'fintech-tool',
  // Healthcare & Life Sciences
  'clinical', 'medical-device', 'pharmaceutical', 'biotech',
  'health-informatics', 'ehr-system', 'lab-technique',
  // Legal
  'legal-research', 'contract-management', 'regulatory',
  'ip-law', 'legal-tech',
  // Engineering & Manufacturing
  'mechanical-engineering', 'electrical-engineering', 'civil-engineering',
  'chemical-engineering', 'industrial-engineering', 'cad-tool',
  'plc-scada', 'quality-management', 'lean-six-sigma',
  'supply-chain', 'logistics',
  // Human Resources
  'hr-management', 'talent-acquisition', 'hris-platform',
  'compensation-benefits', 'labor-relations',
  // Education & Training
  'instructional-design', 'lms-platform', 'curriculum-development',
  'teaching-method', 'edtech',
  // Science & Research
  'research-method', 'statistical-analysis', 'laboratory',
  'geoscience', 'environmental',
  // Construction & Real Estate
  'construction-management', 'bim-tool', 'estimating',
  'real-estate', 'property-management',
  // Media & Communications
  'journalism', 'public-relations', 'broadcasting',
  'content-creation', 'translation-localization',
  // Hospitality & Food Service
  'hospitality-management', 'food-safety', 'culinary',
  // Agriculture
  'agronomy', 'precision-agriculture', 'food-science',
  // Transportation
  'fleet-management', 'aviation', 'maritime', 'rail',
  // Government & Public Sector
  'public-administration', 'policy-analysis', 'grant-management',
  // Soft Skills & Cross-cutting
  'soft-skill', 'language-proficiency', 'domain-knowledge',
  'certification', 'methodology',
  // Meta
  'other', 'invalid',
] as const;

const SKILL_TYPES = [
  'tool', 'framework', 'library', 'language', 'methodology',
  'certification', 'domain-knowledge', 'soft-skill', 'technique',
  'platform', 'standard', 'protocol', 'other',
] as const;

const TREND_DIRECTIONS = ['emerging', 'growing', 'stable', 'declining'] as const;

const DEMAND_LEVELS = ['high', 'medium', 'low', 'niche'] as const;

const SENIORITY_SIGNALS = [
  'entry-level', 'junior', 'mid', 'senior', 'lead',
  'principal', 'executive', 'all-levels',
] as const;

const INDUSTRIES = [
  // Technology
  'software', 'hardware', 'saas', 'fintech', 'healthtech', 'edtech',
  'ecommerce', 'gaming', 'embedded-iot', 'cybersecurity', 'ai-ml',
  'data-engineering', 'devops-infra', 'telecom', 'blockchain-web3',
  // Business
  'consulting', 'banking', 'insurance', 'investment', 'real-estate',
  'retail', 'wholesale', 'advertising', 'media-entertainment',
  // Healthcare
  'healthcare', 'pharmaceutical', 'biotech', 'medical-devices',
  // Manufacturing & Engineering
  'manufacturing', 'automotive', 'aerospace', 'defense',
  'energy', 'oil-gas', 'mining', 'construction', 'chemicals',
  // Services
  'legal', 'accounting-finance', 'hr-staffing', 'education',
  'government', 'nonprofit', 'hospitality', 'food-beverage',
  // Other
  'agriculture', 'transportation-logistics', 'environmental',
  'architecture-design', 'sports-fitness', 'arts-culture',
  'general', 'cross-industry',
] as const;

// ─── Zod schema (response format) ─────────────────────────────────────────────
// The LLM returns the COMPLETE alias list (existing valid + new suggestions,
// misspellings, versions, abbreviations merged). This gets plugged directly
// into the taxonomy entry.

const LLMResponseSchema = z.object({
  // Core validation
  isValidSkill: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  category: z.string(),
  description: z.string(),

  // COMPLETE alias list — all valid surface forms for ATS matching
  aliases: z.array(z.string()),

  // Transferable parent concepts for ATS cross-matching
  broaderTerms: z.array(z.string()),

  // Related but distinct skills (for recommendations, NOT aliases)
  relatedSkills: z.array(z.string()),

  // Contextual signals
  senioritySignal: z.string(),
  industries: z.array(z.string()),

  // Extended enrichment fields
  skillType: z.string(),
  trendDirection: z.string(),
  demandLevel: z.string(),
  commonJobTitles: z.array(z.string()),
  prerequisites: z.array(z.string()),
  complementarySkills: z.array(z.string()),
  certifications: z.array(z.string()),
  parentCategory: z.string(),
  isRegionSpecific: z.string().nullable(),

  // Extended enrichment fields (10 new)
  ecosystem: z.string(),
  alternativeSkills: z.array(z.string()),
  learningDifficulty: z.string(),
  typicalExperienceYears: z.string(),
  salaryImpact: z.string(),
  automationRisk: z.string(),
  communitySize: z.string(),
  isOpenSource: z.boolean().nullable(),
  keywords: z.array(z.string()),
  emergingYear: z.number().nullable(),

  // Operational (not stored in taxonomy)
  invalidAliases: z.array(z.string()),
  shouldRemove: z.boolean(),
  shouldMergeWith: z.string().nullable(),
  preferredCanonical: z.string().nullable(),
  notes: z.string(),
});

type LLMResponse = z.infer<typeof LLMResponseSchema>;

// Batch response: each item includes the skillName it corresponds to
const BatchItemSchema = LLMResponseSchema.extend({
  skillName: z.string(),
});
type BatchItem = z.infer<typeof BatchItemSchema>;
const BatchResponseSchema = z.array(BatchItemSchema);

// ─── Gemini JSON schema (mirrors Zod) ────────────────────────────────────────

const GEMINI_SINGLE_ITEM_PROPERTIES = {
  isValidSkill: { type: 'boolean' },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  category: { type: 'string' },
  description: { type: 'string' },

  aliases: { type: 'array', items: { type: 'string' } },
  broaderTerms: { type: 'array', items: { type: 'string' } },
  relatedSkills: { type: 'array', items: { type: 'string' } },

  senioritySignal: { type: 'string', enum: [...SENIORITY_SIGNALS] },
  industries: { type: 'array', items: { type: 'string' } },

  skillType: { type: 'string', enum: [...SKILL_TYPES] },
  trendDirection: { type: 'string', enum: [...TREND_DIRECTIONS] },
  demandLevel: { type: 'string', enum: [...DEMAND_LEVELS] },
  commonJobTitles: { type: 'array', items: { type: 'string' } },
  prerequisites: { type: 'array', items: { type: 'string' } },
  complementarySkills: { type: 'array', items: { type: 'string' } },
  certifications: { type: 'array', items: { type: 'string' } },
  parentCategory: { type: 'string' },
  isRegionSpecific: { type: 'string', nullable: true },

  ecosystem: { type: 'string' },
  alternativeSkills: { type: 'array', items: { type: 'string' } },
  learningDifficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced', 'expert'] },
  typicalExperienceYears: { type: 'string' },
  salaryImpact: { type: 'string', enum: ['high', 'above-average', 'average', 'below-average', 'low'] },
  automationRisk: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
  communitySize: { type: 'string', enum: ['massive', 'large', 'medium', 'small', 'niche'] },
  isOpenSource: { type: 'boolean', nullable: true },
  keywords: { type: 'array', items: { type: 'string' } },
  emergingYear: { type: 'integer', nullable: true },

  invalidAliases: { type: 'array', items: { type: 'string' } },
  shouldRemove: { type: 'boolean' },
  shouldMergeWith: { type: 'string', nullable: true },
  preferredCanonical: { type: 'string', nullable: true },
  notes: { type: 'string' },
} as const;

const GEMINI_SINGLE_ITEM_REQUIRED = [
  'isValidSkill', 'confidence', 'category', 'description',
  'aliases', 'broaderTerms', 'relatedSkills',
  'senioritySignal', 'industries',
  'skillType', 'trendDirection', 'demandLevel',
  'commonJobTitles', 'prerequisites', 'complementarySkills',
  'certifications', 'parentCategory', 'isRegionSpecific',
  'ecosystem', 'alternativeSkills', 'learningDifficulty', 'typicalExperienceYears',
  'salaryImpact', 'automationRisk', 'communitySize', 'isOpenSource', 'keywords', 'emergingYear',
  'invalidAliases', 'shouldRemove', 'shouldMergeWith', 'preferredCanonical', 'notes',
];

// Single-skill schema (batch=1 fallback)
const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: GEMINI_SINGLE_ITEM_PROPERTIES,
  required: GEMINI_SINGLE_ITEM_REQUIRED,
};

// Batch schema: array of items, each with a skillName identifier
const GEMINI_BATCH_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      skillName: { type: 'string' },
      ...GEMINI_SINGLE_ITEM_PROPERTIES,
    },
    required: ['skillName', ...GEMINI_SINGLE_ITEM_REQUIRED],
  },
};

/** Validation result for a single skill */
interface SkillValidation extends LLMResponse {
  canonical: string;
  existingAliases: string[];
  timestamp: string;
  rawResponse?: string;
}

/** Checkpoint for resuming */
interface Checkpoint {
  lastProcessedIndex: number;
  totalSkills: number;
  startedAt: string;
  updatedAt: string;
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Source data context loader (ESCO + O*NET + StackOverflow + Verticals) ───

interface SkillContext {
  /** Rich description from ESCO (multi-sentence) */
  escoDescription?: string;
  /** ESCO skill type: skill/competence or knowledge */
  escoType?: string;
  /** ESCO reuse level: transversal, cross-sector, sector-specific, occupation-specific */
  escoReuse?: string;
  /** ESCO alternative labels from the API (may differ from taxonomy aliases) */
  escoAltLabels?: string[];
  /** O*NET category: Basic Skill, Knowledge - Health, Work Style, etc. */
  onetCategory?: string;
  /** Stack Overflow / Stack Exchange question count + site */
  soPopularity?: Array<{ count: number; site: string }>;
  /** Verticals industry category: Financial Services & FinTech, Healthcare & Life Sciences, etc. */
  verticalCategory?: string;
  /** Verticals source aliases (may differ from taxonomy) */
  verticalAliases?: string[];
}

/** Load and index all source data into a lookup map keyed by normalized skill name */
function loadSourceContext(): Map<string, SkillContext> {
  const ctx = new Map<string, SkillContext>();
  const DATA_DIR = path.join(__dirname, 'data');

  const getOrCreate = (key: string): SkillContext => {
    const norm = key.toLowerCase().trim();
    if (!norm) return {};
    let entry = ctx.get(norm);
    if (!entry) { entry = {}; ctx.set(norm, entry); }
    return entry;
  };

  // 1. ESCO skills (~13K): descriptions, altLabels, skillType, reuseLevel
  const escoPath = path.join(DATA_DIR, 'esco', 'skills_api.json');
  if (fs.existsSync(escoPath)) {
    try {
      const esco = JSON.parse(fs.readFileSync(escoPath, 'utf-8')) as Array<{
        preferredLabel: string;
        altLabels: string[];
        description: string;
        skillType: string;
        reuseLevel: string;
      }>;
      for (const skill of esco) {
        const entry = getOrCreate(skill.preferredLabel);
        entry.escoDescription = skill.description;
        entry.escoType = skill.skillType;
        entry.escoReuse = skill.reuseLevel;
        if (skill.altLabels?.length > 0) {
          entry.escoAltLabels = skill.altLabels;
        }
      }
      console.log(`   📚 ESCO: ${esco.length} skill descriptions loaded`);
    } catch (e) {
      console.warn(`   ⚠ Failed to load ESCO data: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 2. O*NET hot technologies (~250): name + category (110 unique categories)
  const onetPath = path.join(DATA_DIR, 'onet', 'hot_technologies.json');
  if (fs.existsSync(onetPath)) {
    try {
      const onet = JSON.parse(fs.readFileSync(onetPath, 'utf-8')) as Array<{
        name: string;
        category: string;
      }>;
      for (const item of onet) {
        const entry = getOrCreate(item.name);
        entry.onetCategory = item.category;
      }
      console.log(`   🏛  O*NET: ${onet.length} skills with categories loaded`);
    } catch (e) {
      console.warn(`   ⚠ Failed to load O*NET data: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 3. Stack Overflow / Stack Exchange tags (~7K): name + count + site
  const soPath = path.join(DATA_DIR, 'stackoverflow', 'popular_tags.json');
  if (fs.existsSync(soPath)) {
    try {
      const tags = JSON.parse(fs.readFileSync(soPath, 'utf-8')) as Array<{
        name: string;
        count: number;
        site: string;
      }>;
      for (const tag of tags) {
        const entry = getOrCreate(tag.name);
        if (!entry.soPopularity) entry.soPopularity = [];
        entry.soPopularity.push({ count: tag.count, site: tag.site });
      }
      console.log(`   📊 StackExchange: ${tags.length} tags with popularity loaded`);
    } catch (e) {
      console.warn(`   ⚠ Failed to load SO data: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 4. Verticals (~1K): canonical + aliases + category (28 industries)
  const vertPath = path.join(DATA_DIR, 'verticals', 'candidates.json');
  if (fs.existsSync(vertPath)) {
    try {
      const verts = JSON.parse(fs.readFileSync(vertPath, 'utf-8')) as Array<{
        canonical: string;
        aliases: string[];
        source: string;
        category: string;
      }>;
      for (const v of verts) {
        const entry = getOrCreate(v.canonical);
        entry.verticalCategory = v.category;
        if (v.aliases?.length > 0) {
          entry.verticalAliases = v.aliases;
        }
      }
      console.log(`   🏭 Verticals: ${verts.length} skills with industry categories loaded`);
    } catch (e) {
      console.warn(`   ⚠ Failed to load Verticals data: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`   📦 Total context entries: ${ctx.size}`);
  return ctx;
}

/** Format source context for a single skill into a compact string for the LLM prompt */
function formatContext(canonical: string, contextMap: Map<string, SkillContext>): string {
  const ctx = contextMap.get(canonical.toLowerCase().trim());
  if (!ctx) return '';

  const parts: string[] = [];

  if (ctx.escoDescription) {
    parts.push(`ESCO: ${ctx.escoDescription}`);
  }
  if (ctx.escoType || ctx.escoReuse) {
    const tags = [ctx.escoType, ctx.escoReuse].filter(Boolean).join(', ');
    parts.push(`ESCO type: ${tags}`);
  }
  if (ctx.escoAltLabels?.length) {
    parts.push(`ESCO alt labels: ${ctx.escoAltLabels.join(', ')}`);
  }
  if (ctx.onetCategory) {
    parts.push(`O*NET category: ${ctx.onetCategory}`);
  }
  if (ctx.soPopularity?.length) {
    const top = ctx.soPopularity
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(t => `${t.site}:${t.count.toLocaleString()}`)
      .join(', ');
    parts.push(`StackExchange popularity: ${top}`);
  }
  if (ctx.verticalCategory) {
    parts.push(`Industry vertical: ${ctx.verticalCategory}`);
  }
  if (ctx.verticalAliases?.length) {
    parts.push(`Vertical aliases: ${ctx.verticalAliases.join(', ')}`);
  }

  return parts.length > 0 ? parts.join(' | ') : '';
}

// ─── Retry logic for Gemini API ──────────────────────────────────────────────

/** HTTP status codes that are safe to retry with exponential backoff */
const RETRYABLE_STATUS_CODES = new Set([
  429, // RESOURCE_EXHAUSTED — rate limit hit
  500, // INTERNAL — Google-side transient error
  503, // UNAVAILABLE — service overloaded/down
  504, // DEADLINE_EXCEEDED — processing timeout
]);

/** HTTP status codes that indicate a permanent/fatal error — never retry */
const FATAL_STATUS_CODES = new Set([
  400, // INVALID_ARGUMENT or FAILED_PRECONDITION — bad request
  403, // PERMISSION_DENIED — wrong API key / auth
  404, // NOT_FOUND — wrong model or resource
]);

class GeminiApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly retryable: boolean,
  ) {
    super(`Gemini API error ${status}: ${body.slice(0, 200)}`);
    this.name = 'GeminiApiError';
  }
}

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 2000; // 2 seconds
const MAX_RETRY_DELAY_MS = 60000; // 60 seconds cap

/**
 * Execute a Gemini API call with exponential backoff retry.
 * Retries on 429/500/503/504. Fails immediately on 400/403/404.
 */
async function callGeminiWithRetry<T>(
  requestBody: Record<string, unknown>,
  parseResponse: (text: string) => T,
): Promise<T> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const retryable = RETRYABLE_STATUS_CODES.has(response.status);

        // Fatal errors — don't waste retries
        if (FATAL_STATUS_CODES.has(response.status)) {
          throw new GeminiApiError(response.status, errorBody, false);
        }

        // Retryable errors — throw to trigger backoff
        if (retryable) {
          throw new GeminiApiError(response.status, errorBody, true);
        }

        // Unknown status — treat as retryable once, then give up
        throw new GeminiApiError(response.status, errorBody, attempt < 1);
      }

      const data = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Empty response from Gemini (no text in candidates)');
      }

      const parsed = JSON.parse(text);
      return parseResponse(parsed);

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry fatal (non-retryable) errors
      if (error instanceof GeminiApiError && !error.retryable) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === MAX_RETRIES) {
        break;
      }

      // Exponential backoff with jitter: 2s, 4s, 8s, 16s, 32s (capped at 60s)
      const baseDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.random() * 1000;
      const delay = Math.min(baseDelay + jitter, MAX_RETRY_DELAY_MS);

      const statusInfo = error instanceof GeminiApiError ? ` (HTTP ${error.status})` : '';
      console.warn(`   ⚠ Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed${statusInfo}, retrying in ${(delay / 1000).toFixed(1)}s...`);

      await sleep(delay);
    }
  }

  throw lastError ?? new Error('callGeminiWithRetry: all retries exhausted');
}

/** Call Gemini API with structured output (single skill) — with retry */
async function callGemini(prompt: string): Promise<LLMResponse> {
  return callGeminiWithRetry(
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        ...(MODEL_CONFIG.thinkingBudget ? { thinkingConfig: { thinkingBudget: MODEL_CONFIG.thinkingBudget } } : {}),
      },
    },
    (parsed) => LLMResponseSchema.parse(parsed),
  );
}

/** Call Gemini API with structured output (batch of skills) — with retry */
async function callGeminiBatch(prompt: string): Promise<BatchItem[]> {
  return callGeminiWithRetry(
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_BATCH_SCHEMA,
        ...(MODEL_CONFIG.thinkingBudget ? { thinkingConfig: { thinkingBudget: MODEL_CONFIG.thinkingBudget } } : {}),
      },
    },
    (parsed) => BatchResponseSchema.parse(parsed),
  );
}

/**
 * Build an LLM validation prompt for one or more skills.
 *
 * Single-skill calls embed the skill inline with full source context.
 * Batch calls format a numbered list with per-skill context suffixes.
 * Both share the same instructions and field definitions.
 */
function buildPrompt(
  skills: ReadonlyArray<{ readonly canonical: string; readonly aliases: string[] }>,
  contextMap: Map<string, SkillContext>,
): string {
  const isBatch = skills.length > 1;

  // ── Skill input block ──────────────────────────────────────────────
  let skillBlock: string;
  if (isBatch) {
    const skillList = skills.map((s, i) => {
      const ctx = formatContext(s.canonical, contextMap);
      const ctxSuffix = ctx ? ` | Context: ${ctx}` : '';
      return `${i + 1}. Canonical: "${s.canonical}" | Aliases: ${JSON.stringify(s.aliases)}${ctxSuffix}`;
    }).join('\n');
    skillBlock = `Analyze EACH of these ${skills.length} skill entries:\n\n${skillList}\n\nFor EACH skill, return:`;
  } else {
    const { canonical, aliases } = skills[0];
    const ctx = formatContext(canonical, contextMap);
    const contextLine = ctx
      ? `\nSOURCE CONTEXT (use this to inform your analysis — it comes from ESCO, O*NET, StackExchange, and industry databases):\n${ctx}\n`
      : '';
    skillBlock = `Analyze this skill entry:\n- Canonical name: "${canonical}"\n- Current aliases: ${JSON.stringify(aliases)}\n${contextLine}\nReturn these fields:`;
  }

  // ── Batch-specific rules (only for multi-skill prompts) ────────────
  const batchRules = isBatch
    ? `\n- Return a JSON array with EXACTLY ${skills.length} objects, one per skill, in the same order\n- Each object MUST include "skillName" matching the canonical name exactly`
    : '';
  const skillNameField = isBatch
    ? '\n- skillName: The EXACT canonical name from the input (must match precisely)'
    : '';

  return `You are an expert skill taxonomy curator for ATS (Applicant Tracking System) resume-to-job-description matching.

PURPOSE: This taxonomy powers keyword matching between resumes and job descriptions. When a candidate lists a skill on their resume, the ATS looks up ALL aliases to find matches against job description requirements, and vice versa. The goal is to maximize LEGITIMATE matches so qualified candidates are not filtered out due to terminology differences.

KEY PRINCIPLE — SKILL TRANSFERENCE:
Many skills are niche or specialized, but they imply broader, transferable competencies. The taxonomy must capture these generalizations so candidates are not penalized for using specific terminology when the JD uses general terms, or vice versa.

Example: "Adobe Experience Manager" is a niche enterprise CMS built on Java/OSGi.
  - Direct aliases: "AEM", "Adobe CQ", "CQ5" (same product, different names)
  - Broader terms: "enterprise cms", "web content management", "wcm" (generalized equivalents — these should be in broaderTerms)
  - Implied underlying skills: "java", "osgi", "jcr", "apache sling" (separate skills the practitioner inherently has — these go in relatedSkills, NOT aliases)

This applies across ALL industries and professions — not just tech.

${skillBlock}

CORE:${skillNameField}
- isValidSkill: Is this a real skill/tool/technology/methodology/certification/technique/competency on resumes or JDs in ANY industry?
- confidence: high | medium | low
- category: Best-fit category
- description: One clear sentence describing what this skill IS, what domain it belongs to, and what it is used for. This should help a non-expert understand the skill.

ALIASES (COMPLETE list — all valid ways someone might write this skill on a resume or search for in a JD):
Return ONE merged array called "aliases" containing ALL of the following:
  - Existing aliases that are correct (drop any that are wrong)
  - Missing synonyms, full names ↔ short forms ("Certified Public Accountant" ↔ "CPA")
  - Regional/international variants ("colour grading" ↔ "color grading")
  - Brand names ↔ generic terms ("Salesforce" ↔ "SFDC")
  - Hyphenated/spaced/concatenated variants ("e-commerce" ↔ "ecommerce")
  - Common misspellings and typos found on real resumes ("managment", "liason")
  - Version/edition variants if applicable ("AutoCAD 2024", "ICD-10", "Python 3.12")
  - Acronyms or initialisms ("k8s", "HVAC", "P&L", "GMP")
  Do NOT include broaderTerms or relatedSkills as aliases.

BROADER TERMS (transferable parent concepts):
- broaderTerms: 2-6 generalized equivalents — the broader category or discipline this skill belongs to. These help candidates with niche skills match general JD requirements:
  - A specialized tool should map to its generic function
  - A niche methodology should map to its parent discipline
  - A proprietary product should map to the general capability it provides
  Example: niche EHR system → "ehr administration", "health informatics"
  Example: specific CAD software → "cad modeling", "computer-aided design"

RELATED SKILLS:
- relatedSkills: 2-5 closely related but DISTINCT skills that a practitioner would likely also possess. NOT aliases, NOT parents — separate competencies.

EXTENDED ENRICHMENT:
- skillType: Classification of this skill (tool | framework | library | language | methodology | certification | domain-knowledge | soft-skill | technique | platform | standard | protocol | other)
- trendDirection: Market trajectory (emerging | growing | stable | declining)
- demandLevel: Job market demand level (high | medium | low | niche)
- commonJobTitles: 3-5 job titles that commonly list this skill in their requirements
- prerequisites: 2-3 foundational skills someone should know BEFORE learning this
- complementarySkills: 3-5 skills commonly paired with this in job descriptions (not prerequisites, not the same as relatedSkills — these are "frequently seen together")
- certifications: Relevant professional certifications that validate expertise in this skill (empty array if none exist)
- parentCategory: The immediate hierarchical parent for taxonomy navigation (e.g. "JavaScript" → "programming-language", "Scrum" → "agile-methodology")
- isRegionSpecific: If the skill is only relevant in a specific country/region, name it (e.g. "United States" for HIPAA, "European Union" for GDPR). null if globally applicable.

ECOSYSTEM & MARKET:
- ecosystem: Primary technology or professional ecosystem this skill belongs to (e.g. "javascript", "jvm", "aws", "healthcare", ".net", "data-science"). Use lowercase kebab-case.
- alternativeSkills: 2-5 competing or directly substitutable skills (React vs Angular vs Vue, PostgreSQL vs MySQL). NOT aliases — genuinely different skills that serve the same purpose.
- learningDifficulty: How hard is this to learn? (beginner | intermediate | advanced | expert)
- typicalExperienceYears: Typical experience range when this appears on resumes (e.g. "1-3", "3-5", "5-10", "0-1"). Use a range string.
- salaryImpact: Salary/compensation impact of having this skill (high | above-average | average | below-average | low)
- automationRisk: Risk of this skill being automated or obsoleted (high | medium | low | none)
- communitySize: Size of practitioner/user community (massive | large | medium | small | niche)
- isOpenSource: Is this open-source software? true/false, or null if not applicable (e.g. soft skills, methodologies)
- keywords: 3-8 cross-cutting discovery tags for search and filtering (e.g. for "React": ["frontend", "ui", "spa", "component-based", "virtual-dom"])
- emergingYear: Year this skill/technology was first introduced or emerged. null if unknown or ancient/traditional.

OPERATIONAL:
- invalidAliases: Which current aliases should be REMOVED (wrong concept, different skill)?
- senioritySignal: Career level signal (entry-level | junior | mid | senior | lead | principal | executive | all-levels)
- industries: Which industries commonly require this? List all that apply.
- shouldRemove: true ONLY if this is not a real skill in any profession
- shouldMergeWith: canonical to merge into if duplicate, else null
- preferredCanonical: better canonical name if current isn't standard, else null
- notes: Brief reasoning

RULES:${batchRules}
- This taxonomy covers ALL industries and professions universally
- "aliases" must ONLY contain terms that mean THE SAME THING as the canonical
- "broaderTerms" are PARENT concepts for transferability, NOT aliases
- "relatedSkills" are SEPARATE competencies, NOT aliases or parents
- Be aggressive with misspellings — real resumes are full of typos
- Include US/UK spelling variants ("analyse"/"analyze", "colour"/"color")`;
}

/** Parse LLM response into full validation result */
function toValidation(
  canonical: string,
  existingAliases: string[],
  llmResponse: LLMResponse,
  rawResponse?: string
): SkillValidation {
  return {
    canonical,
    existingAliases,
    timestamp: new Date().toISOString(),
    ...llmResponse,
    rawResponse,
  };
}

/** Create default validation for errors */
function defaultValidation(canonical: string, existingAliases: string[], error: string): SkillValidation {
  return {
    canonical,
    existingAliases,
    timestamp: new Date().toISOString(),
    isValidSkill: true,
    confidence: 'low',
    category: 'other',
    description: '',
    aliases: existingAliases,
    invalidAliases: [],
    broaderTerms: [],
    senioritySignal: 'all-levels',
    industries: ['general'],
    relatedSkills: [],
    skillType: 'other',
    trendDirection: 'stable',
    demandLevel: 'medium',
    commonJobTitles: [],
    prerequisites: [],
    complementarySkills: [],
    certifications: [],
    parentCategory: '',
    isRegionSpecific: null,
    ecosystem: '',
    alternativeSkills: [],
    learningDifficulty: 'intermediate',
    typicalExperienceYears: '',
    salaryImpact: 'average',
    automationRisk: 'low',
    communitySize: 'medium',
    isOpenSource: null,
    keywords: [],
    emergingYear: null,
    shouldRemove: false,
    shouldMergeWith: null,
    preferredCanonical: null,
    notes: `Validation error: ${error}`,
  };
}

/** Load existing results */
function loadResults(): Map<string, SkillValidation> {
  const results = new Map<string, SkillValidation>();

  if (fs.existsSync(RESULTS_FILE)) {
    try {
      const content = fs.readFileSync(RESULTS_FILE, 'utf-8');
      const data = JSON.parse(content) as SkillValidation[];
      for (const result of data) {
        results.set(result.canonical, result);
      }
    } catch {
      console.warn('Could not load existing results');
    }
  }

  return results;
}

/** Save results */
function saveResults(results: Map<string, SkillValidation>): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  const data = [...results.values()].sort((a, b) => 
    a.canonical.localeCompare(b.canonical)
  );
  
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2));
}

/** Load checkpoint */
function loadCheckpoint(): Checkpoint | null {
  if (!fs.existsSync(CHECKPOINT_FILE)) return null;
  
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8')) as Checkpoint;
  } catch {
    return null;
  }
}

/** Save checkpoint */
function saveCheckpoint(index: number, total: number, startedAt: string): void {
  const checkpoint: Checkpoint = {
    lastProcessedIndex: index,
    totalSkills: total,
    startedAt,
    updatedAt: new Date().toISOString(),
  };
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

/** Generate markdown report */
function generateReport(results: Map<string, SkillValidation>): void {
  const data = [...results.values()];
  
  const total = data.length;
  const valid = data.filter(r => r.isValidSkill).length;
  const invalid = data.filter(r => !r.isValidSkill).length;
  const toRemove = data.filter(r => r.shouldRemove).length;
  const toMerge = data.filter(r => r.shouldMergeWith).length;
  const toRename = data.filter(r => r.preferredCanonical).length;
  const withInvalidAliases = data.filter(r => r.invalidAliases.length > 0).length;
  const withMetadata = data.filter(r => r.aliases.length > 0 || r.broaderTerms.length > 0).length;
  const totalAliases = data.reduce((s, r) => s + r.aliases.length, 0);
  const totalBroaderTerms = data.reduce((s, r) => s + r.broaderTerms.length, 0);
  const withCerts = data.filter(r => r.certifications.length > 0).length;
  const withPrereqs = data.filter(r => r.prerequisites.length > 0).length;
  const regionSpecific = data.filter(r => r.isRegionSpecific !== null).length;

  // Breakdowns
  const breakdownMap = (extract: (r: SkillValidation) => string) => {
    const map = new Map<string, number>();
    for (const r of data) { const k = extract(r); map.set(k, (map.get(k) ?? 0) + 1); }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };
  const breakdownArrayMap = (extract: (r: SkillValidation) => string[]) => {
    const map = new Map<string, number>();
    for (const r of data) for (const v of extract(r)) map.set(v, (map.get(v) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };

  const byCategory = breakdownMap(r => r.category);
  const byIndustry = breakdownArrayMap(r => r.industries);
  const bySeniority = breakdownMap(r => r.senioritySignal);
  const byConfidence = breakdownMap(r => r.confidence);
  const bySkillType = breakdownMap(r => r.skillType);
  const byTrend = breakdownMap(r => r.trendDirection);
  const byDemand = breakdownMap(r => r.demandLevel);

  const pct = (n: number) => ((n / total) * 100).toFixed(1);

  const report = `# Taxonomy Enrichment Report

Generated: ${new Date().toISOString()}

## Summary

| Metric | Count | % |
|--------|-------|---|
| Total Skills | ${total} | 100% |
| Valid | ${valid} | ${pct(valid)}% |
| Invalid | ${invalid} | ${pct(invalid)}% |
| Should Remove | ${toRemove} | ${pct(toRemove)}% |
| Should Merge | ${toMerge} | ${pct(toMerge)}% |
| Should Rename | ${toRename} | ${pct(toRename)}% |
| Has Invalid Aliases | ${withInvalidAliases} | ${pct(withInvalidAliases)}% |
| Has Metadata | ${withMetadata} | ${pct(withMetadata)}% |
| Has Certifications | ${withCerts} | ${pct(withCerts)}% |
| Has Prerequisites | ${withPrereqs} | ${pct(withPrereqs)}% |
| Region-Specific | ${regionSpecific} | ${pct(regionSpecific)}% |
| Total Aliases (LLM) | ${totalAliases} | — |
| Total Broader Terms | ${totalBroaderTerms} | — |

## Confidence Distribution

| Level | Count |
|-------|-------|
${byConfidence.map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

## Skill Type Distribution

| Type | Count |
|------|-------|
${bySkillType.map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

## Trend Direction

| Trend | Count |
|-------|-------|
${byTrend.map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

## Demand Level

| Level | Count |
|-------|-------|
${byDemand.map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

## Categories

| Category | Count |
|----------|-------|
${byCategory.map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

## Industries

| Industry | Skills |
|----------|--------|
${byIndustry.map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

## Seniority Distribution

| Level | Count |
|-------|-------|
${bySeniority.map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

## Skills to Remove

${data.filter(r => r.shouldRemove).map(r => `- **${r.canonical}**: ${r.notes}`).join('\n') || 'None'}

## Skills to Merge

${data.filter(r => r.shouldMergeWith).map(r => `- **${r.canonical}** → ${r.shouldMergeWith}: ${r.notes}`).join('\n') || 'None'}

## Skills to Rename

${data.filter(r => r.preferredCanonical).map(r => `- **${r.canonical}** → ${r.preferredCanonical}: ${r.notes}`).join('\n') || 'None'}

## Invalid Aliases

${data.filter(r => r.invalidAliases.length > 0).map(r =>
  '- **' + r.canonical + '**: Remove `' + r.invalidAliases.join('`, `') + '`'
).join('\n') || 'None'}

## Broader / Transferable Terms

${data.filter(r => r.broaderTerms.length > 0).slice(0, 100).map(r =>
  '- **' + r.canonical + '**: ' + r.broaderTerms.join(', ')
).join('\n') || 'None'}

## Low Confidence

${data.filter(r => r.confidence === 'low').map(r =>
  '- **' + r.canonical + '**: ' + r.notes
).join('\n') || 'None'}
`;

  fs.writeFileSync(REPORT_FILE, report);
  console.log(`\n📄 Report saved to: ${REPORT_FILE}`);
}

// ─── Apply enrichment results back to taxonomy ─────────────────────────────

function applyResults(results: Map<string, SkillValidation>): void {
  const taxonomy = loadTaxonomy();
  const known = buildKnownTerms(taxonomy);
  let removed = 0;
  let merged = 0;
  let renamed = 0;
  let aliasesRemoved = 0;
  let aliasesUpdated = 0;

  const data = [...results.values()].filter(r => r.confidence !== 'low');

  // Pass 1: Remove invalid skills (high confidence only)
  for (const r of data) {
    if (r.shouldRemove && r.confidence === 'high') {
      delete taxonomy[r.canonical];
      removed++;
    }
  }

  // Pass 2: Merge duplicates
  for (const r of data) {
    if (!r.shouldMergeWith || r.shouldRemove) continue;
    const target = normalize(r.shouldMergeWith);
    if (taxonomy[target] === undefined || taxonomy[r.canonical] === undefined) continue;

    // Merge aliases into target
    const targetAliasSet = new Set(taxonomy[target].aliases.map(a => a.toLowerCase()));
    for (const alias of taxonomy[r.canonical].aliases) {
      if (!targetAliasSet.has(alias.toLowerCase())) {
        taxonomy[target].aliases.push(alias);
        targetAliasSet.add(alias.toLowerCase());
      }
    }
    // Add old canonical as alias of target
    if (!targetAliasSet.has(r.canonical.toLowerCase())) {
      taxonomy[target].aliases.push(r.canonical);
    }
    // Merge broader terms
    const targetBroaderSet = new Set(taxonomy[target].broaderTerms.map(b => b.toLowerCase()));
    for (const bt of taxonomy[r.canonical].broaderTerms) {
      if (!targetBroaderSet.has(bt.toLowerCase())) {
        taxonomy[target].broaderTerms.push(bt);
      }
    }
    delete taxonomy[r.canonical];
    merged++;
  }

  // Pass 3: Rename canonicals
  for (const r of data) {
    if (!r.preferredCanonical || r.shouldRemove || r.shouldMergeWith) continue;
    const preferred = normalize(r.preferredCanonical);
    if (taxonomy[r.canonical] === undefined || taxonomy[preferred] !== undefined) continue;

    const entry = taxonomy[r.canonical];
    // Add old canonical as alias
    if (!entry.aliases.some(a => a.toLowerCase() === r.canonical.toLowerCase())) {
      entry.aliases.push(r.canonical);
    }
    // Remove preferred from aliases if present
    entry.aliases = entry.aliases.filter(a => a.toLowerCase() !== preferred.toLowerCase());
    taxonomy[preferred] = entry;
    delete taxonomy[r.canonical];
    renamed++;
  }

  // Pass 4: Remove invalid aliases
  for (const r of data) {
    if (taxonomy[r.canonical] === undefined) continue;
    if (r.invalidAliases.length === 0) continue;
    const badSet = new Set(r.invalidAliases.map(a => a.toLowerCase()));
    const before = taxonomy[r.canonical].aliases.length;
    taxonomy[r.canonical].aliases = taxonomy[r.canonical].aliases.filter(
      a => !badSet.has(a.toLowerCase())
    );
    aliasesRemoved += before - taxonomy[r.canonical].aliases.length;
  }

  // Pass 5: Update entries with LLM data
  for (const r of data) {
    if (taxonomy[r.canonical] === undefined) continue;
    const entry = taxonomy[r.canonical];

    // Update aliases from LLM (merge with existing, deduplicate)
    const aliasSet = new Set(entry.aliases.map(a => a.toLowerCase()));
    for (const alias of r.aliases) {
      const norm = normalize(alias);
      if (norm && !aliasSet.has(norm) && norm !== r.canonical.toLowerCase()) {
        entry.aliases.push(alias.toLowerCase());
        aliasSet.add(norm);
        aliasesUpdated++;
      }
    }

    // Update metadata
    entry.category = r.category;
    if (r.description) entry.description = r.description;
    entry.broaderTerms = r.broaderTerms;
    entry.relatedSkills = r.relatedSkills;
    entry.senioritySignal = r.senioritySignal;
    entry.industries = r.industries;
    entry.isValidSkill = r.isValidSkill;
    entry.confidence = r.confidence as 'high' | 'medium' | 'low';
    entry.skillType = r.skillType;
    entry.trendDirection = r.trendDirection;
    entry.demandLevel = r.demandLevel;
    entry.commonJobTitles = r.commonJobTitles;
    entry.prerequisites = r.prerequisites;
    entry.complementarySkills = r.complementarySkills;
    entry.certifications = r.certifications;
    entry.parentCategory = r.parentCategory;
    entry.isRegionSpecific = r.isRegionSpecific;
    entry.ecosystem = r.ecosystem;
    entry.alternativeSkills = r.alternativeSkills;
    entry.learningDifficulty = r.learningDifficulty;
    entry.typicalExperienceYears = r.typicalExperienceYears;
    entry.salaryImpact = r.salaryImpact;
    entry.automationRisk = r.automationRisk;
    entry.communitySize = r.communitySize;
    entry.isOpenSource = r.isOpenSource;
    entry.keywords = r.keywords;
    entry.emergingYear = r.emergingYear;
  }

  saveTaxonomy(taxonomy);

  const finalSkills = Object.keys(taxonomy).length;
  const finalAliases = Object.values(taxonomy).reduce((s, e) => s + e.aliases.length, 0);

  console.log('\n🔧 Applied enrichment results to taxonomy:');
  console.log(`   Removed: ${removed} invalid skills`);
  console.log(`   Merged: ${merged} duplicates`);
  console.log(`   Renamed: ${renamed} canonicals`);
  console.log(`   Aliases removed: ${aliasesRemoved}`);
  console.log(`   Aliases updated: ${aliasesUpdated}`);
  console.log(`\n📊 Final taxonomy: ${finalSkills} skills, ${finalAliases} aliases, ${finalSkills + finalAliases} total terms`);
}

// ─── Live enrichment (apply results in real-time after each batch) ───────────

/**
 * Apply a batch of LLM results to the in-memory taxonomy.
 * Updates aliases, metadata, and confidence. Structural changes (remove, merge, rename)
 * are deferred to --apply pass.
 */
function applyBatchLive(
  taxonomy: SkillTaxonomyMap,
  known: Set<string>,
  batchResults: ReadonlyArray<SkillValidation>,
): number {
  let aliasesAdded = 0;

  for (const r of batchResults) {
    if (r.confidence === 'low') continue;
    if (taxonomy[r.canonical] === undefined) continue;

    const entry = taxonomy[r.canonical];
    const existingAliasSet = new Set(entry.aliases.map(a => a.toLowerCase()));

    // Merge LLM aliases into existing
    for (const alias of r.aliases) {
      const norm = normalize(alias);
      if (norm && !existingAliasSet.has(norm) && !known.has(norm) && norm !== r.canonical.toLowerCase()) {
        entry.aliases.push(alias.toLowerCase());
        existingAliasSet.add(norm);
        known.add(norm);
        aliasesAdded++;
      }
    }

    // Update metadata from LLM
    entry.category = r.category;
    if (r.description) entry.description = r.description;
    entry.broaderTerms = r.broaderTerms;
    entry.relatedSkills = r.relatedSkills;
    entry.senioritySignal = r.senioritySignal;
    entry.industries = r.industries;
    entry.isValidSkill = r.isValidSkill;
    entry.confidence = r.confidence as 'high' | 'medium' | 'low';
    entry.skillType = r.skillType;
    entry.trendDirection = r.trendDirection;
    entry.demandLevel = r.demandLevel;
    entry.commonJobTitles = r.commonJobTitles;
    entry.prerequisites = r.prerequisites;
    entry.complementarySkills = r.complementarySkills;
    entry.certifications = r.certifications;
    entry.parentCategory = r.parentCategory;
    entry.isRegionSpecific = r.isRegionSpecific;
    entry.ecosystem = r.ecosystem;
    entry.alternativeSkills = r.alternativeSkills;
    entry.learningDifficulty = r.learningDifficulty;
    entry.typicalExperienceYears = r.typicalExperienceYears;
    entry.salaryImpact = r.salaryImpact;
    entry.automationRisk = r.automationRisk;
    entry.communitySize = r.communitySize;
    entry.isOpenSource = r.isOpenSource;
    entry.keywords = r.keywords;
    entry.emergingYear = r.emergingYear;
  }

  return aliasesAdded;
}

/** Main validation loop */
async function main(): Promise<void> {
  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY environment variable not set');
    console.log('Get a free API key at: https://aistudio.google.com/app/apikey');
    process.exit(1);
  }

  console.log('🔍 LLM-Powered Taxonomy Enrichment');
  console.log('===================================\n');
  console.log(`🤖 Model: ${GEMINI_MODEL}`);
  console.log(`📦 Batch size: ${BATCH_SIZE}`);
  console.log(`🚀 Concurrency: ${CONCURRENCY}`);
  console.log(`⏱  Delay: ${DELAY_BETWEEN_REQUESTS_MS}ms between requests`);

  // Load source data context (ESCO + O*NET + SO + Verticals)
  console.log('\n📚 Loading source data context...');
  const contextMap = loadSourceContext();

  // Load taxonomy (single source of truth)
  if (!taxonomyExists()) {
    console.error('Taxonomy not found at src/skill-taxonomy.json');
    process.exit(1);
  }

  const taxonomy = loadTaxonomy();
  const known = buildKnownTerms(taxonomy);

  // Filter to skills that need processing (pending confidence)
  const allEntries = Object.entries(taxonomy);
  const pendingEntries = allEntries.filter(([, entry]) => entry.confidence === 'pending');
  const total = pendingEntries.length;

  // Convert to [canonical, aliases] pairs for prompt building
  const skills: [string, string[]][] = pendingEntries.map(([canonical, entry]) => [canonical, entry.aliases]);
  const totalBatches = Math.ceil(total / BATCH_SIZE);

  console.log(`📊 Taxonomy: ${allEntries.length} skills total`);
  console.log(`   Pending: ${total} skills → ${totalBatches} batches`);
  console.log(`   Already processed: ${allEntries.length - total} skills`);
  console.log(`⏱  Estimated time: ${Math.ceil((totalBatches * DELAY_BETWEEN_REQUESTS_MS) / 1000 / 60)} minutes\n`);

  if (total === 0 && !SINGLE_SKILL && !APPLY_MODE) {
    console.log('✅ All skills already processed! Nothing to do.');
    console.log('   Run with --apply to apply structural changes (remove/merge/rename).');
    return;
  }

  // Handle single skill mode (always uses single-skill prompt)
  if (SINGLE_SKILL) {
    const entry = allEntries.find(([k]) => k === SINGLE_SKILL.toLowerCase());
    if (!entry) {
      console.error(`❌ Skill "${SINGLE_SKILL}" not found in taxonomy`);
      process.exit(1);
    }

    const [canonical, skillEntry] = entry;
    console.log(`🎯 Validating single skill: ${canonical}`);
    const prompt = buildPrompt([{ canonical, aliases: skillEntry.aliases }], contextMap);
    
    if (DRY_RUN) {
      console.log('\n📝 Prompt:\n', prompt);
      return;
    }

    const llmResponse = await callGemini(prompt);
    const result = toValidation(canonical, skillEntry.aliases, llmResponse);
    
    console.log('\n📋 Result:');
    console.log(JSON.stringify(result, null, 2));

    // Apply to taxonomy
    applyBatchLive(taxonomy, known, [result]);
    saveTaxonomy(taxonomy);
    console.log('\n💾 Saved to taxonomy');
    return;
  }

  // Load existing results and checkpoint
  const results = RESUME_MODE ? loadResults() : new Map<string, SkillValidation>();
  const checkpoint = RESUME_MODE ? loadCheckpoint() : null;
  const startIndex = checkpoint?.lastProcessedIndex ?? 0;
  const startedAt = checkpoint?.startedAt ?? new Date().toISOString();

  if (RESUME_MODE && checkpoint) {
    console.log(`📌 Resuming from checkpoint: skill ${startIndex}/${total}`);
    console.log(`   Started: ${checkpoint.startedAt}`);
    console.log(`   Already validated: ${results.size} skills\n`);
  }

  if (DRY_RUN) {
    console.log('🏃 Dry run mode - no API calls will be made\n');
    if (BATCH_SIZE > 1) {
      const sampleBatch = skills.slice(0, BATCH_SIZE);
      console.log(`Sample BATCH prompt (${sampleBatch.length} skills):\n`);
      console.log(buildPrompt(sampleBatch.map(([c, a]) => ({ canonical: c, aliases: a })), contextMap));
    } else {
      const [testCanonical, testAliases] = skills[0];
      console.log('Sample prompt for first skill:\n');
      console.log(buildPrompt([{ canonical: testCanonical, aliases: testAliases }], contextMap));
    }
    return;
  }

  // Main enrichment loop (chunked by BATCH_SIZE, with concurrency)
  let processed = 0;
  let errors = 0;
  let apiCalls = 0;
  let totalAliasesAdded = 0;

  /** Process a single batch index, returning validations or an error */
  async function processSingleBatch(
    i: number,
  ): Promise<{ index: number; validations: SkillValidation[] } | { index: number; error: unknown }> {
    const batchEnd = Math.min(i + BATCH_SIZE, total);
    const batchSkills = skills.slice(i, batchEnd);
    const toValidate = batchSkills.filter(([canonical]) => !results.has(canonical));

    if (toValidate.length === 0) return { index: i, validations: [] };

    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const skillNames = toValidate.map(([c]) => c);
    console.log(`🔄 [batch ${batchNum}/${totalBatches}] Enriching ${toValidate.length} skills: ${skillNames.slice(0, 3).join(', ')}${skillNames.length > 3 ? ` +${skillNames.length - 3} more` : ''}`);

    try {
      let batchValidations: SkillValidation[];

      if (toValidate.length === 1) {
        const [canonical, aliases] = toValidate[0];
        const prompt = buildPrompt([{ canonical, aliases }], contextMap);
        const llmResponse = await callGemini(prompt);
        batchValidations = [toValidation(canonical, aliases, llmResponse)];
      } else {
        const prompt = buildPrompt(toValidate.map(([c, a]) => ({ canonical: c, aliases: a })), contextMap);
        const batchItems = await callGeminiBatch(prompt);
        const responseMap = new Map(batchItems.map(item => [item.skillName.toLowerCase(), item]));
        batchValidations = [];
        for (const [canonical, aliases] of toValidate) {
          const item = responseMap.get(canonical.toLowerCase());
          if (item) {
            batchValidations.push(toValidation(canonical, aliases, item));
          } else {
            console.warn(`   ⚠ Missing response for: ${canonical}`);
            batchValidations.push(defaultValidation(canonical, aliases, 'Not returned in batch response'));
          }
        }
      }

      return { index: i, validations: batchValidations };
    } catch (error) {
      return { index: i, error };
    }
  }

  for (let i = startIndex; i < total; i += BATCH_SIZE * CONCURRENCY) {
    // Launch up to CONCURRENCY batches in parallel
    const batchIndices: number[] = [];
    for (let c = 0; c < CONCURRENCY && i + c * BATCH_SIZE < total; c++) {
      batchIndices.push(i + c * BATCH_SIZE);
    }

    const concurrentResults = await Promise.all(batchIndices.map(idx => processSingleBatch(idx)));

    // Apply all results sequentially (shared state: taxonomy, known, results)
    let shouldAbort = false;
    for (const outcome of concurrentResults) {
      if ('error' in outcome) {
        errors++;
        const isFatal = outcome.error instanceof GeminiApiError && !(outcome.error as GeminiApiError).retryable;
        const errorMessage = outcome.error instanceof Error ? (outcome.error as Error).message : String(outcome.error);

        if (isFatal) {
          console.error(`   🚫 Fatal error (no retry): ${errorMessage}`);
        } else {
          console.error(`   ❌ Batch error (retries exhausted): ${errorMessage}`);
        }

        // Save default validations for failed batch
        const batchEnd = Math.min(outcome.index + BATCH_SIZE, total);
        const batchSkills = skills.slice(outcome.index, batchEnd);
        for (const [canonical, aliases] of batchSkills) {
          if (!results.has(canonical)) {
            results.set(canonical, defaultValidation(canonical, aliases, errorMessage));
          }
        }

        if (isFatal) {
          saveResults(results);
          saveTaxonomy(taxonomy);
          saveCheckpoint(outcome.index, total, startedAt);
          console.error('\n🚫 Fatal API error — check your API key, model name, or request format.');
          process.exit(1);
        }

        if (errors > 10) {
          saveResults(results);
          saveTaxonomy(taxonomy);
          saveCheckpoint(outcome.index, total, startedAt);
          console.error('\n❌ Too many errors (10+), aborting. Run with --resume to continue.');
          process.exit(1);
        }

        shouldAbort = true;
        continue;
      }

      // Successful batch — apply results
      const { validations } = outcome;
      if (validations.length === 0) {
        const batchNum = Math.floor(outcome.index / BATCH_SIZE) + 1;
        const batchEnd = Math.min(outcome.index + BATCH_SIZE, total);
        const batchSkills = skills.slice(outcome.index, batchEnd);
        console.log(`⏭  [batch ${batchNum}/${totalBatches}] All ${batchSkills.length} skills cached`);
        continue;
      }

      apiCalls++;

      for (const result of validations) {
        results.set(result.canonical, result);
        processed++;
      }

      // Log summary
      const invalidCount = validations.filter(r => !r.isValidSkill).length;
      const aliasCount = validations.reduce((s, r) => s + r.aliases.length, 0);
      const broaderCount = validations.reduce((s, r) => s + r.broaderTerms.length, 0);
      const badAliasCount = validations.reduce((s, r) => s + r.invalidAliases.length, 0);

      if (invalidCount > 0) console.log(`   ❌ ${invalidCount} invalid`);
      if (badAliasCount > 0) console.log(`   ⚠  ${badAliasCount} invalid aliases flagged`);
      if (aliasCount > 0) console.log(`   💡 ${aliasCount} aliases returned`);
      if (broaderCount > 0) console.log(`   🔗 ${broaderCount} broader terms`);
      if (invalidCount === 0 && badAliasCount === 0) console.log(`   ✅ All valid`);

      // Live enrichment
      const aliasesAdded = applyBatchLive(taxonomy, known, validations);
      totalAliasesAdded += aliasesAdded;
      if (aliasesAdded > 0) {
        console.log(`   📝 +${aliasesAdded} new aliases applied`);
      }
    }

    // Checkpoint after each concurrent round
    const lastIndex = batchIndices[batchIndices.length - 1] + BATCH_SIZE;
    if (apiCalls % CHECKPOINT_INTERVAL === 0 || shouldAbort) {
      saveResults(results);
      saveTaxonomy(taxonomy);
      saveCheckpoint(Math.min(lastIndex, total), total, startedAt);
      const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000 / 60;
      const processedCount = Object.values(taxonomy).filter(e => e.confidence !== 'pending').length;
      console.log(`\n💾 Checkpoint: ${processedCount}/${Object.keys(taxonomy).length} processed, +${totalAliasesAdded} aliases, ${elapsed.toFixed(1)}m elapsed\n`);
    }

    if (shouldAbort) {
      await sleep(5000);
    } else {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  // Final save
  saveResults(results);
  saveTaxonomy(taxonomy);
  generateReport(results);

  // Count final taxonomy stats
  const finalSkills = Object.keys(taxonomy).length;
  const finalAliases = Object.values(taxonomy).reduce((s, e) => s + e.aliases.length, 0);
  const finalBroader = Object.values(taxonomy).reduce((s, e) => s + e.broaderTerms.length, 0);
  const processedCount = Object.values(taxonomy).filter(e => e.confidence !== 'pending').length;

  // Summary
  console.log('\n===================================');
  console.log('✅ Processing Complete!');
  console.log(`   Skills processed: ${processed}/${total} pending`);
  console.log(`   Total processed: ${processedCount}/${finalSkills}`);
  console.log(`   API calls: ${apiCalls}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Aliases added (live): ${totalAliasesAdded}`);
  console.log(`   Taxonomy: ${finalSkills} skills, ${finalAliases} aliases, ${finalBroader} broader terms`);
  console.log(`   Results: ${RESULTS_FILE}`);
  console.log(`   Report: ${REPORT_FILE}`);

  // Apply structural changes (remove, merge, rename) if --apply flag is set
  if (APPLY_MODE) {
    console.log('\n🔧 Applying structural changes (remove/merge/rename)...');
    applyResults(results);
  } else {
    console.log('\n💡 Run with --apply to also apply structural changes (remove/merge/rename)');
    console.log('   (Metadata enrichment has already been applied live)');
  }
}

main().catch(console.error);
