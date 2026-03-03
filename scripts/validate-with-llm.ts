/**
 * LLM-powered taxonomy validation using Gemini Flash.
 *
 * Validates each skill entry in the taxonomy by checking:
 * 1. Is this a real technology/skill used in software/tech jobs?
 * 2. Are the aliases correct synonyms/variants?
 * 3. Should any aliases be removed (false positives)?
 * 4. What aliases are missing?
 * 5. Skill categorization, seniority signal, industry relevance
 * 6. Version variants, common misspellings, abbreviations
 *
 * Designed to run overnight with rate limiting.
 *
 * Usage:
 *   pnpm validate:llm                    # run full validation
 *   pnpm validate:llm --resume           # resume from checkpoint
 *   pnpm validate:llm --skill=python     # single skill
 *   pnpm validate:llm --dry-run          # show prompt without calling API
 *   pnpm validate:llm --apply            # apply LLM results back to taxonomy
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { loadTaxonomy, saveTaxonomy, normalize, buildKnownTerms } from './common';
import type { SkillTaxonomy } from './common';

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
const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Rate limiting - Gemini Tier 1: 1500 RPM, but we pace conservatively
const DELAY_BETWEEN_REQUESTS_MS = 1000; // 1 second between requests (~60 RPM)
const CHECKPOINT_INTERVAL = 25; // Save progress every N skills

// Output files
const OUTPUT_DIR = path.join(__dirname, 'data', 'validation');
const RESULTS_FILE = path.join(OUTPUT_DIR, 'validation-results.json');
const CHECKPOINT_FILE = path.join(OUTPUT_DIR, 'checkpoint.json');
const REPORT_FILE = path.join(OUTPUT_DIR, 'validation-report.md');

// CLI args
const RESUME_MODE = process.argv.includes('--resume');
const SINGLE_SKILL = process.argv.find(a => a.startsWith('--skill='))?.split('=')[1];
const DRY_RUN = process.argv.includes('--dry-run');
const APPLY_MODE = process.argv.includes('--apply');

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

// ─── Zod schema ──────────────────────────────────────────────────────────────

const LLMResponseSchema = z.object({
  // Core validation
  isValidSkill: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  category: z.string(),

  // Alias analysis
  validAliases: z.array(z.string()),
  invalidAliases: z.array(z.string()),
  suggestedAliases: z.array(z.string()),

  // Extended vectors
  commonMisspellings: z.array(z.string()),
  versionVariants: z.array(z.string()),
  abbreviations: z.array(z.string()),

  // Contextual signals
  senioritySignal: z.string(),
  industries: z.array(z.string()),
  relatedSkills: z.array(z.string()),

  // Recommendations
  shouldRemove: z.boolean(),
  shouldMergeWith: z.string().nullable(),
  preferredCanonical: z.string().nullable(),
  notes: z.string(),
});

type LLMResponse = z.infer<typeof LLMResponseSchema>;

// ─── Gemini JSON schema (mirrors Zod — simplified for API limits) ────────────
// Category and industry enums are enforced by Zod locally, not in the API schema
// to avoid "schema too complex" errors. Nullable uses type array per Gemini docs.

const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    isValidSkill: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    category: { type: 'string' },

    validAliases: { type: 'array', items: { type: 'string' } },
    invalidAliases: { type: 'array', items: { type: 'string' } },
    suggestedAliases: { type: 'array', items: { type: 'string' } },

    commonMisspellings: { type: 'array', items: { type: 'string' } },
    versionVariants: { type: 'array', items: { type: 'string' } },
    abbreviations: { type: 'array', items: { type: 'string' } },

    senioritySignal: { type: 'string', enum: [...SENIORITY_SIGNALS] },
    industries: { type: 'array', items: { type: 'string' } },
    relatedSkills: { type: 'array', items: { type: 'string' } },

    shouldRemove: { type: 'boolean' },
    shouldMergeWith: { type: 'string', nullable: true },
    preferredCanonical: { type: 'string', nullable: true },
    notes: { type: 'string' },
  },
  required: [
    'isValidSkill', 'confidence', 'category',
    'validAliases', 'invalidAliases', 'suggestedAliases',
    'commonMisspellings', 'versionVariants', 'abbreviations',
    'senioritySignal', 'industries', 'relatedSkills',
    'shouldRemove', 'shouldMergeWith', 'preferredCanonical', 'notes',
  ],
};

/** Validation result for a single skill */
interface SkillValidation extends LLMResponse {
  canonical: string;
  aliases: string[];
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

/** Call Gemini API with structured output */
async function callGemini(prompt: string): Promise<LLMResponse> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  const parsed = JSON.parse(text);
  return LLMResponseSchema.parse(parsed);
}

/** Build validation prompt for a skill */
function buildPrompt(canonical: string, aliases: string[]): string {
  return `You are an expert skill taxonomy curator for a universal ATS (Applicant Tracking System) that parses resumes and matches them to job descriptions across ALL industries — not just tech.

This taxonomy covers every profession: software, healthcare, finance, law, engineering, manufacturing, marketing, HR, education, construction, science, government, hospitality, agriculture, transportation, and more.

Analyze this skill entry thoroughly:
- Canonical name: "${canonical}"
- Current aliases: ${JSON.stringify(aliases)}

Evaluate along these vectors:

CORE VALIDATION:
- isValidSkill: Is this a real skill, tool, technology, methodology, certification, technique, or competency that appears on resumes or job descriptions in ANY industry?
- confidence: How certain are you? (high/medium/low)
- category: Best-fit category from the enum

ALIAS ANALYSIS:
- validAliases: Which current aliases are TRUE synonyms/abbreviations/variants?
- invalidAliases: Which current aliases are WRONG (different concept, too generic, or unrelated)?
- suggestedAliases: 3-10 missing aliases that job seekers or recruiters commonly use. Think broadly:
  - Full names and short forms ("Certified Public Accountant" ↔ "CPA")
  - Regional variants ("CV" ↔ "resume", "maths" ↔ "math")
  - Brand names vs generic ("Salesforce" ↔ "SFDC")
  - Formal vs informal ("financial modeling" ↔ "fin modeling")

EXPANDED ALIAS VECTORS:
- commonMisspellings: Frequent typos/misspellings seen on resumes across all industries
  Examples: "managment", "liason", "anaesthesia"/"anesthesia", "gauge"/"gage", "licence"/"license"
- versionVariants: Version-specific or edition-specific forms if applicable
  Examples: "AutoCAD 2024", "ICD-10", "GAAP 2023", "Python 3.12", "ISO 9001:2015"
- abbreviations: Common short forms, acronyms, or initialisms not already in aliases
  Examples: "k8s", "CPR", "HVAC", "P&L", "GAAP", "OSHA", "PMP", "GMP"

CONTEXTUAL SIGNALS:
- senioritySignal: Does this skill signal a particular career level?
  entry-level | junior | mid | senior | lead | principal | executive | all-levels
- industries: Which industries commonly require this skill? Select all that apply
- relatedSkills: 2-5 closely related but DISTINCT skills (for cross-referencing, NOT aliases)
  Example: for "python" → ["django", "pandas", "flask"] (related, not aliases)
  Example: for "project management" → ["risk management", "stakeholder management", "agile"]

RECOMMENDATIONS:
- shouldRemove: true ONLY if this is not a real skill/competency in any profession
- shouldMergeWith: If this duplicates another common skill, give the canonical name to merge into, else null
- preferredCanonical: If the canonical name isn't the standard industry form, suggest the better one, else null
- notes: Brief explanation of your assessment

RULES:
- This is a UNIVERSAL taxonomy — do not assume everything is a tech skill
- Aliases must be TRUE synonyms, not related-but-different concepts
- Be aggressive with misspellings — resumes across all industries have typos
- Include regional/international spelling variants (US vs UK English)
- Abbreviations should be what hiring managers actually search for
- relatedSkills are for cross-referencing only, NEVER include them as aliases
- If a skill spans multiple industries, list all relevant ones`;
}

/** Parse LLM response into full validation result */
function toValidation(
  canonical: string,
  aliases: string[],
  llmResponse: LLMResponse,
  rawResponse?: string
): SkillValidation {
  return {
    canonical,
    aliases,
    timestamp: new Date().toISOString(),
    ...llmResponse,
    rawResponse,
  };
}

/** Create default validation for errors */
function defaultValidation(canonical: string, aliases: string[], error: string): SkillValidation {
  return {
    canonical,
    aliases,
    timestamp: new Date().toISOString(),
    isValidSkill: true,
    confidence: 'low',
    category: 'other',
    validAliases: aliases,
    invalidAliases: [],
    suggestedAliases: [],
    commonMisspellings: [],
    versionVariants: [],
    abbreviations: [],
    senioritySignal: 'all-levels',
    industries: ['general'],
    relatedSkills: [],
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
  const withSuggestions = data.filter(r =>
    r.suggestedAliases.length + r.commonMisspellings.length +
    r.versionVariants.length + r.abbreviations.length > 0
  ).length;
  const totalNewAliases = data.reduce((s, r) =>
    s + r.suggestedAliases.length + r.commonMisspellings.length +
    r.versionVariants.length + r.abbreviations.length, 0
  );

  // Category breakdown
  const byCategory = new Map<string, number>();
  for (const r of data) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);

  // Industry breakdown
  const byIndustry = new Map<string, number>();
  for (const r of data) for (const ind of r.industries) byIndustry.set(ind, (byIndustry.get(ind) ?? 0) + 1);

  // Seniority breakdown
  const bySeniority = new Map<string, number>();
  for (const r of data) bySeniority.set(r.senioritySignal, (bySeniority.get(r.senioritySignal) ?? 0) + 1);

  const pct = (n: number) => ((n / total) * 100).toFixed(1);

  const report = `# Taxonomy Validation Report

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
| Has Suggested Additions | ${withSuggestions} | ${pct(withSuggestions)}% |
| Total New Aliases Available | ${totalNewAliases} | — |

## Categories

| Category | Count |
|----------|-------|
${[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

## Industries

| Industry | Skills |
|----------|--------|
${[...byIndustry.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

## Seniority Distribution

| Level | Count |
|-------|-------|
${[...bySeniority.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

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

## Suggested Aliases (by vector)

### Direct Synonyms
${data.filter(r => r.suggestedAliases.length > 0).slice(0, 100).map(r =>
  '- **' + r.canonical + '**: ' + r.suggestedAliases.join(', ')
).join('\n') || 'None'}

### Common Misspellings
${data.filter(r => r.commonMisspellings.length > 0).slice(0, 100).map(r =>
  '- **' + r.canonical + '**: ' + r.commonMisspellings.join(', ')
).join('\n') || 'None'}

### Version Variants
${data.filter(r => r.versionVariants.length > 0).slice(0, 100).map(r =>
  '- **' + r.canonical + '**: ' + r.versionVariants.join(', ')
).join('\n') || 'None'}

### Abbreviations
${data.filter(r => r.abbreviations.length > 0).slice(0, 100).map(r =>
  '- **' + r.canonical + '**: ' + r.abbreviations.join(', ')
).join('\n') || 'None'}

## Low Confidence

${data.filter(r => r.confidence === 'low').map(r =>
  '- **' + r.canonical + '**: ' + r.notes
).join('\n') || 'None'}
`;

  fs.writeFileSync(REPORT_FILE, report);
  console.log(`\n📄 Report saved to: ${REPORT_FILE}`);
}

// ─── Apply validation results back to taxonomy ──────────────────────────────

function applyResults(results: Map<string, SkillValidation>): void {
  const taxonomy = loadTaxonomy();
  const known = buildKnownTerms(taxonomy);
  let removed = 0;
  let merged = 0;
  let renamed = 0;
  let aliasesRemoved = 0;
  let aliasesAdded = 0;

  const data = [...results.values()].filter(r => r.confidence !== 'low');

  // Pass 1: Remove invalid skills (high/medium confidence only)
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

    // Move all aliases from source to target
    const targetAliases = new Set(taxonomy[target].map(a => a.toLowerCase()));
    for (const alias of taxonomy[r.canonical]) {
      if (!targetAliases.has(alias.toLowerCase())) {
        taxonomy[target].push(alias);
      }
    }
    // Add the old canonical as an alias of the target
    if (!targetAliases.has(r.canonical.toLowerCase())) {
      taxonomy[target].push(r.canonical);
    }
    delete taxonomy[r.canonical];
    merged++;
  }

  // Pass 3: Rename canonicals (preferred form)
  for (const r of data) {
    if (!r.preferredCanonical || r.shouldRemove || r.shouldMergeWith) continue;
    const preferred = normalize(r.preferredCanonical);
    if (taxonomy[r.canonical] === undefined || taxonomy[preferred] !== undefined) continue;

    const aliases = [...taxonomy[r.canonical]];
    // Add old canonical as alias
    if (!aliases.some(a => a.toLowerCase() === r.canonical.toLowerCase())) {
      aliases.push(r.canonical);
    }
    // Remove preferred from aliases if present
    const filtered = aliases.filter(a => a.toLowerCase() !== preferred.toLowerCase());
    taxonomy[preferred] = filtered;
    delete taxonomy[r.canonical];
    renamed++;
  }

  // Rebuild known terms after structural changes
  const updatedKnown = buildKnownTerms(taxonomy);

  // Pass 4: Remove invalid aliases
  for (const r of data) {
    if (taxonomy[r.canonical] === undefined) continue;
    if (r.invalidAliases.length === 0) continue;
    const badSet = new Set(r.invalidAliases.map(a => a.toLowerCase()));
    const before = taxonomy[r.canonical].length;
    taxonomy[r.canonical] = taxonomy[r.canonical].filter(
      a => !badSet.has(a.toLowerCase())
    );
    aliasesRemoved += before - taxonomy[r.canonical].length;
  }

  // Pass 5: Add new aliases (suggestedAliases + misspellings + versions + abbreviations)
  for (const r of data) {
    if (taxonomy[r.canonical] === undefined) continue;
    const existingAliases = new Set(taxonomy[r.canonical].map(a => a.toLowerCase()));
    const newAliases = [
      ...r.suggestedAliases,
      ...r.commonMisspellings,
      ...r.versionVariants,
      ...r.abbreviations,
    ];
    for (const alias of newAliases) {
      const norm = normalize(alias);
      if (norm && !existingAliases.has(norm) && !updatedKnown.has(norm)) {
        taxonomy[r.canonical].push(alias.toLowerCase());
        existingAliases.add(norm);
        updatedKnown.add(norm);
        aliasesAdded++;
      }
    }
  }

  saveTaxonomy(taxonomy);

  // Count final stats
  const finalSkills = Object.keys(taxonomy).length;
  const finalAliases = Object.values(taxonomy).reduce((s, a) => s + a.length, 0);

  console.log('\n🔧 Applied validation results to taxonomy:');
  console.log(`   Removed: ${removed} invalid skills`);
  console.log(`   Merged: ${merged} duplicates`);
  console.log(`   Renamed: ${renamed} canonicals`);
  console.log(`   Aliases removed: ${aliasesRemoved}`);
  console.log(`   Aliases added: ${aliasesAdded}`);
  console.log(`\n📊 Final taxonomy: ${finalSkills} skills, ${finalAliases} aliases, ${finalSkills + finalAliases} total terms`);
}

/** Main validation loop */
async function main(): Promise<void> {
  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY environment variable not set');
    console.log('Get a free API key at: https://aistudio.google.com/app/apikey');
    process.exit(1);
  }

  console.log('🔍 LLM-Powered Taxonomy Validation');
  console.log('===================================\n');

  // Load taxonomy
  const taxonomy = loadTaxonomy();
  const skills = Object.entries(taxonomy);
  const total = skills.length;

  console.log(`📊 Taxonomy: ${total} skills to validate`);
  console.log(`⏱  Estimated time: ${Math.ceil((total * DELAY_BETWEEN_REQUESTS_MS) / 1000 / 60)} minutes\n`);

  // Handle single skill mode
  if (SINGLE_SKILL) {
    const entry = skills.find(([k]) => k === SINGLE_SKILL.toLowerCase());
    if (!entry) {
      console.error(`❌ Skill "${SINGLE_SKILL}" not found in taxonomy`);
      process.exit(1);
    }

    console.log(`🎯 Validating single skill: ${entry[0]}`);
    const prompt = buildPrompt(entry[0], entry[1]);
    
    if (DRY_RUN) {
      console.log('\n📝 Prompt:\n', prompt);
      return;
    }

    const llmResponse = await callGemini(prompt);
    const result = toValidation(entry[0], entry[1], llmResponse);
    
    console.log('\n📋 Result:');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Load existing results and checkpoint
  const results = RESUME_MODE ? loadResults() : new Map<string, SkillValidation>();
  const checkpoint = RESUME_MODE ? loadCheckpoint() : null;
  const startIndex = checkpoint?.lastProcessedIndex ?? 0;
  const startedAt = checkpoint?.startedAt ?? new Date().toISOString();

  if (RESUME_MODE && checkpoint) {
    console.log(`📌 Resuming from checkpoint: ${startIndex}/${total}`);
    console.log(`   Started: ${checkpoint.startedAt}`);
    console.log(`   Already validated: ${results.size} skills\n`);
  }

  if (DRY_RUN) {
    console.log('🏃 Dry run mode - no API calls will be made');
    const [testCanonical, testAliases] = skills[0];
    console.log('\nSample prompt for first skill:');
    console.log(buildPrompt(testCanonical, testAliases));
    return;
  }

  // Main validation loop
  let processed = 0;
  let errors = 0;

  for (let i = startIndex; i < total; i++) {
    const [canonical, aliases] = skills[i];
    
    // Skip if already validated
    if (results.has(canonical)) {
      console.log(`⏭  [${i + 1}/${total}] ${canonical} (cached)`);
      continue;
    }

    console.log(`🔄 [${i + 1}/${total}] Validating: ${canonical}`);

    try {
      const prompt = buildPrompt(canonical, aliases);
      const llmResponse = await callGemini(prompt);
      const result = toValidation(canonical, aliases, llmResponse);
      
      results.set(canonical, result);
      processed++;

      // Log key findings
      if (!result.isValidSkill) {
        console.log(`   ❌ Invalid skill`);
      } else if (result.invalidAliases.length > 0) {
        console.log(`   ⚠  Invalid aliases: ${result.invalidAliases.join(', ')}`);
      } else if (result.suggestedAliases.length > 0) {
        console.log(`   💡 Suggestions: ${result.suggestedAliases.join(', ')}`);
      } else {
        console.log(`   ✅ Valid (${result.category})`);
      }

      // Save checkpoint periodically
      if (processed % CHECKPOINT_INTERVAL === 0) {
        saveResults(results);
        saveCheckpoint(i + 1, total, startedAt);
        console.log(`\n💾 Checkpoint saved (${results.size} validated)\n`);
      }

    } catch (error) {
      errors++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Error: ${errorMessage}`);
      
      // Save default validation with error note
      results.set(canonical, defaultValidation(canonical, aliases, errorMessage));
      
      // Save progress on error
      saveResults(results);
      saveCheckpoint(i, total, startedAt);
      
      // If too many errors, abort
      if (errors > 10) {
        console.error('\n❌ Too many errors, aborting. Run with --resume to continue.');
        process.exit(1);
      }
      
      // Wait longer on error (might be rate limit)
      await sleep(10000);
    }

    // Rate limiting delay
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  // Final save
  saveResults(results);
  generateReport(results);

  // Summary
  console.log('\n===================================');
  console.log('✅ Validation Complete!');
  console.log(`   Total: ${total}`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Results: ${RESULTS_FILE}`);
  console.log(`   Report: ${REPORT_FILE}`);

  // Apply results if --apply flag is set
  if (APPLY_MODE) {
    applyResults(results);
  } else {
    console.log('\n💡 Run with --apply to update the taxonomy with these results');
  }
}

main().catch(console.error);
