/**
 * Import technology skills from O*NET (US Department of Labor).
 *
 * O*NET distributes tab-delimited files. Download from:
 *   https://www.onetcenter.org/database.html
 *
 * Place the extracted files in: scripts/data/onet/
 *   - Technology Skills.txt
 *   - Tools & Technology.txt (optional)
 *
 * Usage:
 *   tsx scripts/import-onet.ts          # dry run
 *   tsx scripts/import-onet.ts --apply  # write to taxonomy
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { reportAndApply, normalize, type CandidateEntry } from './common';

const DATA_DIR = path.join(__dirname, 'data', 'onet');
const TECH_SKILLS_FILE = path.join(DATA_DIR, 'Technology Skills.txt');

function parseTSV(filePath: string): Array<Record<string, string>> {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t').map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split('\t');
    if (fields.length < headers.length) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = fields[j]?.trim() ?? '';
    }
    rows.push(row);
  }

  return rows;
}

function main(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created ${DATA_DIR}`);
    console.log('Download O*NET database from https://www.onetcenter.org/database.html');
    console.log('Extract and place "Technology Skills.txt" in scripts/data/onet/');
    process.exit(0);
  }

  if (!fs.existsSync(TECH_SKILLS_FILE)) {
    console.log(`File not found: ${TECH_SKILLS_FILE}`);
    console.log('Download O*NET database from https://www.onetcenter.org/database.html');
    console.log('Extract and place "Technology Skills.txt" in scripts/data/onet/');
    process.exit(0);
  }

  const rows = parseTSV(TECH_SKILLS_FILE);
  console.log(`[onet] Parsed ${rows.length} rows from Technology Skills.txt`);

  // Group by example (technology name) and count occurrences across occupations
  const skillCounts = new Map<string, number>();
  for (const row of rows) {
    const example = row['Example'] ?? row['Commodity Title'] ?? '';
    if (example.trim() === '') continue;
    const normalized = normalize(example);
    skillCounts.set(normalized, (skillCounts.get(normalized) ?? 0) + 1);
  }

  // Sort by frequency, take top entries
  const sorted = [...skillCounts.entries()].sort((a, b) => b[1] - a[1]);

  const candidates: CandidateEntry[] = sorted.map(([skill]) => ({
    canonical: skill,
    aliases: [],
    source: 'onet-import',
    category: 'technology-skills',
  }));

  reportAndApply(candidates, 'onet-import');
}

main();
