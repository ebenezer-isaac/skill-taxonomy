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
const GEMINI_MODEL = 'gemini-3.0-flash-preview';
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

/** Validation result for a single skill */
interface SkillValidation {
  canonical: string;
  aliases: string[];
  timestamp: string;
  
  // LLM assessment
  isValidSkill: boolean;
  confidence: 'high' | 'medium' | 'low';
  category: 'programming-language' | 'framework' | 'library' | 'tool' | 'platform' | 
            'database' | 'cloud' | 'methodology' | 'soft-skill' | 'domain-knowledge' | 
            'certification' | 'other' | 'invalid';
  
  // Alias analysis
  validAliases: string[];
  invalidAliases: string[];
  suggestedAliases: string[];
  
  // Recommendations
  shouldRemove: boolean;
  shouldMergeWith?: string;
  notes: string;
  
  // Raw response for debugging
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

/** Call Gemini API */
async function callGemini(prompt: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1, // Low temperature for consistent analysis
        maxOutputTokens: 1024,
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
  
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

/** Build validation prompt for a skill */
function buildPrompt(canonical: string, aliases: string[]): string {
  return `You are validating a skill taxonomy for an ATS (Applicant Tracking System) that matches job descriptions to resumes.

Analyze this skill entry:
- Canonical name: "${canonical}"
- Aliases: ${JSON.stringify(aliases)}

Respond in this exact JSON format (no markdown, just raw JSON):
{
  "isValidSkill": true/false,
  "confidence": "high" | "medium" | "low",
  "category": "programming-language" | "framework" | "library" | "tool" | "platform" | "database" | "cloud" | "methodology" | "soft-skill" | "domain-knowledge" | "certification" | "other" | "invalid",
  "validAliases": ["list of aliases that are correct synonyms/variants"],
  "invalidAliases": ["list of aliases that should NOT map to this skill"],
  "suggestedAliases": ["2-5 common aliases that are MISSING"],
  "shouldRemove": true/false,
  "shouldMergeWith": "canonical name if this should merge with another skill, or null",
  "notes": "Brief explanation of your assessment"
}

Rules:
1. A valid skill is something that appears on tech job descriptions or resumes
2. Aliases must be TRUE synonyms or common variants (e.g., "js" for "javascript")
3. Do NOT include related-but-different skills as aliases (e.g., "react" is not an alias for "javascript")
4. Be conservative with suggestedAliases - only obvious ones
5. shouldRemove = true only if this isn't a real skill/technology
6. Check for common abbreviations, version variants (v2, 3.x), and common misspellings`;
}

/** Parse LLM response into structured result */
function parseResponse(
  canonical: string, 
  aliases: string[], 
  rawResponse: string
): SkillValidation {
  const timestamp = new Date().toISOString();
  
  // Default result for parse failures
  const defaultResult: SkillValidation = {
    canonical,
    aliases,
    timestamp,
    isValidSkill: true,
    confidence: 'low',
    category: 'other',
    validAliases: aliases,
    invalidAliases: [],
    suggestedAliases: [],
    shouldRemove: false,
    notes: 'Failed to parse LLM response',
    rawResponse,
  };

  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = rawResponse.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr) as {
      isValidSkill?: boolean;
      confidence?: string;
      category?: string;
      validAliases?: string[];
      invalidAliases?: string[];
      suggestedAliases?: string[];
      shouldRemove?: boolean;
      shouldMergeWith?: string | null;
      notes?: string;
    };

    return {
      canonical,
      aliases,
      timestamp,
      isValidSkill: parsed.isValidSkill ?? true,
      confidence: (parsed.confidence as 'high' | 'medium' | 'low') ?? 'medium',
      category: (parsed.category as SkillValidation['category']) ?? 'other',
      validAliases: parsed.validAliases ?? aliases,
      invalidAliases: parsed.invalidAliases ?? [],
      suggestedAliases: parsed.suggestedAliases ?? [],
      shouldRemove: parsed.shouldRemove ?? false,
      shouldMergeWith: parsed.shouldMergeWith ?? undefined,
      notes: parsed.notes ?? '',
      rawResponse,
    };
  } catch {
    console.warn(`  ⚠ Failed to parse response for "${canonical}"`);
    return defaultResult;
  }
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

    const response = await callGemini(prompt);
    const result = parseResponse(entry[0], entry[1], response);
    
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
      const response = await callGemini(prompt);
      const result = parseResponse(canonical, aliases, response);
      
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
      console.error(`   ❌ Error: ${error}`);
      
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
