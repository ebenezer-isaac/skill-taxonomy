/**
 * Import skills from Stack Overflow Developer Survey.
 *
 * Download the survey data from: https://survey.stackoverflow.co/
 * Place the CSV in: scripts/data/stackoverflow/survey_results_public.csv
 *
 * Parses technology columns and extracts the most commonly used technologies.
 *
 * Usage:
 *   tsx scripts/import-stackoverflow.ts          # dry run
 *   tsx scripts/import-stackoverflow.ts --apply  # write to taxonomy
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { reportAndApply, normalize, type CandidateEntry } from './common';

const DATA_DIR = path.join(__dirname, 'data', 'stackoverflow');
const SURVEY_FILE = path.join(DATA_DIR, 'survey_results_public.csv');

/** Technology-related columns in the SO survey (semicolon-delimited multi-value) */
const TECH_COLUMNS = [
  'LanguageHaveWorkedWith',
  'DatabaseHaveWorkedWith',
  'PlatformHaveWorkedWith',
  'WebframeHaveWorkedWith',
  'MiscTechHaveWorkedWith',
  'ToolsTechHaveWorkedWith',
  'NEWCollabToolsHaveWorkedWith',
  'LanguageWantToWorkWith',
  'DatabaseWantToWorkWith',
  'PlatformWantToWorkWith',
  'WebframeWantToWorkWith',
];

function main(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(SURVEY_FILE)) {
    console.log(`File not found: ${SURVEY_FILE}`);
    console.log('Download from https://survey.stackoverflow.co/');
    console.log('Place survey_results_public.csv in scripts/data/stackoverflow/');
    process.exit(0);
  }

  // Simple CSV parsing (no external deps) — works for SO survey format
  const content = fs.readFileSync(SURVEY_FILE, 'utf-8');
  const lines = content.split('\n');
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));

  // Find indices for tech columns
  const colIndices: number[] = [];
  for (const col of TECH_COLUMNS) {
    const idx = headers.indexOf(col);
    if (idx !== -1) colIndices.push(idx);
  }

  if (colIndices.length === 0) {
    console.log('No technology columns found in survey CSV.');
    console.log(`Expected columns: ${TECH_COLUMNS.join(', ')}`);
    console.log(`Found headers: ${headers.slice(0, 20).join(', ')}...`);
    process.exit(1);
  }

  console.log(`[stackoverflow] Found ${colIndices.length} technology columns`);

  // Count technology mentions
  const techCounts = new Map<string, number>();
  let respondents = 0;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    respondents++;

    // Simple field splitting (handles quoted fields with commas inside)
    const fields = lines[i].match(/("([^"]*)"|[^,]*)/g) ?? [];

    for (const idx of colIndices) {
      const value = fields[idx]?.replace(/^"|"$/g, '') ?? '';
      if (value === '' || value === 'NA') continue;

      // SO survey uses semicolons to separate multiple values
      const techs = value.split(';');
      for (const tech of techs) {
        const normalized = normalize(tech);
        if (normalized !== '' && normalized.length > 1) {
          techCounts.set(normalized, (techCounts.get(normalized) ?? 0) + 1);
        }
      }
    }
  }

  console.log(`[stackoverflow] Parsed ${respondents} respondents`);

  // Sort by frequency, filter low-frequency noise
  const minMentions = Math.max(10, respondents * 0.005); // at least 0.5% of respondents
  const sorted = [...techCounts.entries()]
    .filter(([, count]) => count >= minMentions)
    .sort((a, b) => b[1] - a[1]);

  const candidates: CandidateEntry[] = sorted.map(([tech, count]) => ({
    canonical: tech,
    aliases: [],
    source: 'stackoverflow-survey',
    category: `usage: ${((count / respondents) * 100).toFixed(1)}%`,
  }));

  reportAndApply(candidates, 'stackoverflow-survey');
}

main();
