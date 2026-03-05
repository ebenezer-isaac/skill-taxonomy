/**
 * Validates skill-taxonomy.json for structural integrity.
 *
 * Checks:
 * 1. Valid JSON with correct shape (Record<string, SkillEntry>)
 * 2. No duplicate aliases across different canonical entries
 * 3. No empty canonical names
 * 4. No alias that matches another canonical name (would shadow it)
 * 5. All strings are trimmed and lowercase-normalizable
 * 6. No duplicate aliases within the same entry
 * 7. Required fields present and correctly typed on every entry
 *
 * Usage: tsx scripts/validate.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const TAXONOMY_PATH = path.join(__dirname, '..', 'src', 'skill-taxonomy.json');

interface ValidationError {
  readonly level: 'error' | 'warn';
  readonly message: string;
}

/** Fields that must exist in the raw JSON (original schema). */
const REQUIRED_STRING_FIELDS = [
  'category', 'description', 'senioritySignal', 'skillType',
  'trendDirection', 'demandLevel', 'parentCategory',
] as const;

const REQUIRED_ARRAY_FIELDS = [
  'aliases', 'industries', 'broaderTerms', 'relatedSkills',
  'sources', 'commonJobTitles', 'prerequisites',
  'complementarySkills', 'certifications',
] as const;

/**
 * Fields added later and backfilled at runtime by loadTaxonomy().
 * Validated only when present — absence is fine (defaults applied on load).
 */
const BACKFILL_STRING_FIELDS = [
  'ecosystem', 'learningDifficulty', 'typicalExperienceYears',
  'salaryImpact', 'automationRisk', 'communitySize',
] as const;

const BACKFILL_ARRAY_FIELDS = ['alternativeSkills', 'keywords'] as const;

function validate(): readonly ValidationError[] {
  const errors: ValidationError[] = [];
  const raw = fs.readFileSync(TAXONOMY_PATH, 'utf-8');

  let taxonomy: Record<string, unknown>;
  try {
    taxonomy = JSON.parse(raw);
  } catch {
    errors.push({ level: 'error', message: 'Invalid JSON' });
    return errors;
  }

  if (typeof taxonomy !== 'object' || taxonomy === null || Array.isArray(taxonomy)) {
    errors.push({ level: 'error', message: 'Taxonomy must be a plain object' });
    return errors;
  }

  const canonicalSet = new Set<string>();
  const aliasOwnership = new Map<string, string>();

  for (const [canonical, value] of Object.entries(taxonomy)) {
    if (canonical.trim() === '') {
      errors.push({ level: 'error', message: 'Empty canonical name found' });
      continue;
    }

    if (canonical !== canonical.toLowerCase().trim()) {
      errors.push({
        level: 'warn',
        message: `Canonical "${canonical}" should be lowercase and trimmed → "${canonical.toLowerCase().trim()}"`,
      });
    }

    const normalizedCanonical = canonical.toLowerCase().trim();
    if (canonicalSet.has(normalizedCanonical)) {
      errors.push({ level: 'error', message: `Duplicate canonical: "${canonical}"` });
    }
    canonicalSet.add(normalizedCanonical);

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push({ level: 'error', message: `"${canonical}": entry must be an object (SkillEntry)` });
      continue;
    }

    const entry = value as Record<string, unknown>;

    // Validate required string fields
    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof entry[field] !== 'string') {
        errors.push({ level: 'error', message: `"${canonical}": "${field}" must be a string, got ${typeof entry[field]}` });
      }
    }

    // Validate required array fields
    for (const field of REQUIRED_ARRAY_FIELDS) {
      if (!Array.isArray(entry[field])) {
        errors.push({ level: 'error', message: `"${canonical}": "${field}" must be an array` });
      }
    }

    // Validate boolean fields
    if (typeof entry.isValidSkill !== 'boolean') {
      errors.push({ level: 'error', message: `"${canonical}": "isValidSkill" must be boolean` });
    }

    // Validate confidence enum
    const validConfidence = ['high', 'medium', 'low', 'pending'];
    if (typeof entry.confidence !== 'string' || !validConfidence.includes(entry.confidence)) {
      errors.push({ level: 'error', message: `"${canonical}": "confidence" must be one of ${validConfidence.join(', ')}` });
    }

    // Validate nullable fields (only error if present but wrong type)
    if (entry.isRegionSpecific !== undefined && entry.isRegionSpecific !== null && typeof entry.isRegionSpecific !== 'string') {
      errors.push({ level: 'error', message: `"${canonical}": "isRegionSpecific" must be string | null` });
    }
    if (entry.isOpenSource !== undefined && entry.isOpenSource !== null && typeof entry.isOpenSource !== 'boolean') {
      errors.push({ level: 'error', message: `"${canonical}": "isOpenSource" must be boolean | null` });
    }
    if (entry.emergingYear !== undefined && entry.emergingYear !== null && typeof entry.emergingYear !== 'number') {
      errors.push({ level: 'error', message: `"${canonical}": "emergingYear" must be number | null` });
    }

    // Validate backfill fields (warn if present but wrong type)
    for (const field of BACKFILL_STRING_FIELDS) {
      if (entry[field] !== undefined && typeof entry[field] !== 'string') {
        errors.push({ level: 'warn', message: `"${canonical}": "${field}" should be a string if present` });
      }
    }
    for (const field of BACKFILL_ARRAY_FIELDS) {
      if (entry[field] !== undefined && !Array.isArray(entry[field])) {
        errors.push({ level: 'warn', message: `"${canonical}": "${field}" should be an array if present` });
      }
    }

    // Validate aliases (cross-entry checks)
    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    const seenInEntry = new Set<string>();

    for (const alias of aliases) {
      if (typeof alias !== 'string') {
        errors.push({ level: 'error', message: `"${canonical}": alias must be a string, got ${typeof alias}` });
        continue;
      }

      const normalizedAlias = alias.toLowerCase().trim();

      if (normalizedAlias === '') {
        errors.push({ level: 'error', message: `"${canonical}": empty alias found` });
        continue;
      }

      if (seenInEntry.has(normalizedAlias)) {
        errors.push({ level: 'warn', message: `"${canonical}": duplicate alias "${alias}" within same entry` });
      }
      seenInEntry.add(normalizedAlias);

      if (canonicalSet.has(normalizedAlias) && normalizedAlias !== normalizedCanonical) {
        errors.push({
          level: 'warn',
          message: `"${canonical}": alias "${alias}" shadows canonical "${normalizedAlias}"`,
        });
      }

      const owner = aliasOwnership.get(normalizedAlias);
      if (owner !== undefined && owner !== normalizedCanonical) {
        errors.push({
          level: 'error',
          message: `Duplicate alias "${alias}" — claimed by both "${owner}" and "${canonical}"`,
        });
      }
      aliasOwnership.set(normalizedAlias, normalizedCanonical);
    }
  }

  return errors;
}

// Run
const errors = validate();
const errorCount = errors.filter((e) => e.level === 'error').length;
const warnCount = errors.filter((e) => e.level === 'warn').length;

for (const e of errors) {
  const prefix = e.level === 'error' ? 'ERROR' : 'WARN';
  console.log(`${prefix} ${e.message}`);
}

console.log(`\nValidation complete: ${errorCount} errors, ${warnCount} warnings`);

if (errorCount > 0) {
  process.exit(1);
}
