/**
 * LLM-powered taxonomy validation using Gemini Flash.
 *
 * Validates each skill entry in the taxonomy by checking:
 * 1. Is this a real technology/skill used in software/tech jobs?
 * 2. Are the aliases correct synonyms/variants?
 * 3. Should any aliases be removed (false positives)?
 * 4. What aliases are missing?
 *
 * Designed to run overnight with rate limiting.
 *
 * Usage:
 *   pnpm validate:llm                    # run full validation
 *   pnpm validate:llm --resume           # resume from checkpoint
 *   pnpm validate:llm --skill python     # single skill
 *   pnpm validate:llm --dry-run          # show prompt without calling API
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { loadTaxonomy } from './common';

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

// Zod schema for LLM response validation
const LLMResponseSchema = z.object({
  isValidSkill: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  category: z.enum([
    'programming-language', 'framework', 'library', 'tool', 'platform',
    'database', 'cloud', 'methodology', 'soft-skill', 'domain-knowledge',
    'certification', 'other', 'invalid'
  ]),
  validAliases: z.array(z.string()),
  invalidAliases: z.array(z.string()),
  suggestedAliases: z.array(z.string()),
  shouldRemove: z.boolean(),
  shouldMergeWith: z.string().nullable(),
  notes: z.string(),
});

type LLMResponse = z.infer<typeof LLMResponseSchema>;

// JSON Schema for Gemini structured output (matches Zod schema)
const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    isValidSkill: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    category: {
      type: 'string',
      enum: [
        'programming-language', 'framework', 'library', 'tool', 'platform',
        'database', 'cloud', 'methodology', 'soft-skill', 'domain-knowledge',
        'certification', 'other', 'invalid'
      ]
    },
    validAliases: { type: 'array', items: { type: 'string' } },
    invalidAliases: { type: 'array', items: { type: 'string' } },
    suggestedAliases: { type: 'array', items: { type: 'string' } },
    shouldRemove: { type: 'boolean' },
    shouldMergeWith: { type: 'string', nullable: true },
    notes: { type: 'string' },
  },
  required: [
    'isValidSkill', 'confidence', 'category', 'validAliases',
    'invalidAliases', 'suggestedAliases', 'shouldRemove', 'shouldMergeWith', 'notes'
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
        maxOutputTokens: 1024,
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
  return `You are validating a skill taxonomy for an ATS (Applicant Tracking System) that matches job descriptions to resumes.

Analyze this skill entry:
- Canonical name: "${canonical}"
- Aliases: ${JSON.stringify(aliases)}

Rules:
1. isValidSkill: true if this appears on tech job descriptions or resumes
2. validAliases: aliases that are TRUE synonyms/variants (e.g., "js" for "javascript")
3. invalidAliases: aliases that should NOT map to this skill
4. suggestedAliases: 2-5 obvious missing aliases (abbreviations, versions, misspellings)
5. shouldRemove: true only if this isn't a real skill/technology
6. shouldMergeWith: canonical name if this duplicates another skill, else null
7. Do NOT include related-but-different skills as aliases`;
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
    shouldRemove: false,
    shouldMergeWith: null,
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
  
  // Statistics
  const total = data.length;
  const valid = data.filter(r => r.isValidSkill).length;
  const invalid = data.filter(r => !r.isValidSkill).length;
  const toRemove = data.filter(r => r.shouldRemove).length;
  const toMerge = data.filter(r => r.shouldMergeWith).length;
  const withInvalidAliases = data.filter(r => r.invalidAliases.length > 0).length;
  const withSuggestedAliases = data.filter(r => r.suggestedAliases.length > 0).length;
  
  // Category breakdown
  const byCategory = new Map<string, number>();
  for (const r of data) {
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
  }
  
  let report = `# Taxonomy Validation Report

Generated: ${new Date().toISOString()}

## Summary

| Metric | Count | Percentage |
|--------|-------|------------|
| Total Skills | ${total} | 100% |
| Valid Skills | ${valid} | ${((valid / total) * 100).toFixed(1)}% |
| Invalid Skills | ${invalid} | ${((invalid / total) * 100).toFixed(1)}% |
| Should Remove | ${toRemove} | ${((toRemove / total) * 100).toFixed(1)}% |
| Should Merge | ${toMerge} | ${((toMerge / total) * 100).toFixed(1)}% |
| Has Invalid Aliases | ${withInvalidAliases} | ${((withInvalidAliases / total) * 100).toFixed(1)}% |
| Has Suggested Aliases | ${withSuggestedAliases} | ${((withSuggestedAliases / total) * 100).toFixed(1)}% |

## Categories

| Category | Count |
|----------|-------|
${[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([cat, count]) => `| ${cat} | ${count} |`).join('\n')}

## Skills to Remove

${data.filter(r => r.shouldRemove).map(r => `- **${r.canonical}**: ${r.notes}`).join('\n') || 'None'}

## Skills to Merge

${data.filter(r => r.shouldMergeWith).map(r => `- **${r.canonical}** → ${r.shouldMergeWith}: ${r.notes}`).join('\n') || 'None'}

## Invalid Aliases (Top 50)

${data.filter(r => r.invalidAliases.length > 0).slice(0, 50).map(r => 
  `- **${r.canonical}**: Remove \`${r.invalidAliases.join('`, `')}\``
).join('\n') || 'None'}

## Suggested Aliases (Top 50)

${data.filter(r => r.suggestedAliases.length > 0).slice(0, 50).map(r => 
  `- **${r.canonical}**: Add \`${r.suggestedAliases.join('`, `')}\``
).join('\n') || 'None'}

## Low Confidence Assessments

${data.filter(r => r.confidence === 'low').map(r => 
  `- **${r.canonical}**: ${r.notes}`
).join('\n') || 'None'}
`;

  fs.writeFileSync(REPORT_FILE, report);
  console.log(`\n📄 Report saved to: ${REPORT_FILE}`);
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
}

main().catch(console.error);
