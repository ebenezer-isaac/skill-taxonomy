/**
 * Validates skill-taxonomy.json for structural integrity.
 *
 * Checks:
 * 1. Valid JSON with correct shape (Record<string, string[]>)
 * 2. No duplicate aliases across different canonical entries
 * 3. No empty canonical names
 * 4. No alias that matches another canonical name (would shadow it)
 * 5. All strings are trimmed and lowercase-normalizable
 * 6. No duplicate aliases within the same entry
 *
 * Usage: tsx scripts/validate.ts [--fix]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const TAXONOMY_PATH = path.join(__dirname, '..', 'src', 'skill-taxonomy.json');

interface ValidationError {
  readonly level: 'error' | 'warn';
  readonly message: string;
}

function validate(): readonly ValidationError[] {
  const errors: ValidationError[] = [];
  const raw = fs.readFileSync(TAXONOMY_PATH, 'utf-8');

  let taxonomy: Record<string, string[]>;
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
  const aliasOwnership = new Map<string, string>(); // alias → owning canonical

  for (const [canonical, aliases] of Object.entries(taxonomy)) {
    // Check empty canonical
    if (canonical.trim() === '') {
      errors.push({ level: 'error', message: 'Empty canonical name found' });
      continue;
    }

    // Check canonical is lowercase-trimmed
    if (canonical !== canonical.toLowerCase().trim()) {
      errors.push({
        level: 'warn',
        message: `Canonical "${canonical}" should be lowercase and trimmed → "${canonical.toLowerCase().trim()}"`,
      });
    }

    // Check duplicate canonical
    const normalizedCanonical = canonical.toLowerCase().trim();
    if (canonicalSet.has(normalizedCanonical)) {
      errors.push({ level: 'error', message: `Duplicate canonical: "${canonical}"` });
    }
    canonicalSet.add(normalizedCanonical);

    // Check aliases is an array
    if (!Array.isArray(aliases)) {
      errors.push({ level: 'error', message: `"${canonical}": aliases must be an array` });
      continue;
    }

    const seenInEntry = new Set<string>();

    for (const alias of aliases) {
      if (typeof alias !== 'string') {
        errors.push({ level: 'error', message: `"${canonical}": alias must be a string, got ${typeof alias}` });
        continue;
      }

      const normalizedAlias = alias.toLowerCase().trim();

      // Check empty alias
      if (normalizedAlias === '') {
        errors.push({ level: 'error', message: `"${canonical}": empty alias found` });
        continue;
      }

      // Check duplicate within same entry
      if (seenInEntry.has(normalizedAlias)) {
        errors.push({ level: 'warn', message: `"${canonical}": duplicate alias "${alias}" within same entry` });
      }
      seenInEntry.add(normalizedAlias);

      // Check alias shadows another canonical
      if (canonicalSet.has(normalizedAlias) && normalizedAlias !== normalizedCanonical) {
        errors.push({
          level: 'warn',
          message: `"${canonical}": alias "${alias}" shadows canonical "${normalizedAlias}"`,
        });
      }

      // Check alias claimed by another canonical
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
  const prefix = e.level === 'error' ? '❌' : '⚠️';
  console.log(`${prefix} ${e.message}`);
}

console.log(`\nValidation complete: ${errorCount} errors, ${warnCount} warnings`);

if (errorCount > 0) {
  process.exit(1);
}
