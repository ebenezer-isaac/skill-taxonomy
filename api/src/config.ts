import * as fs from 'node:fs';
import * as path from 'node:path';

// Load .env file if present
const envPath = path.join(import.meta.dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

export const config = Object.freeze({
  port: parseInt(process.env.API_PORT ?? '4000', 10),
  neo4jUri: process.env.NEO4J_URI ?? 'bolt://localhost:7687',
  neo4jUser: process.env.NEO4J_USER ?? 'neo4j',
  neo4jPassword: process.env.NEO4J_PASSWORD ?? 'taxonomy',
  taxonomyPath: path.resolve(
    import.meta.dirname,
    process.env.TAXONOMY_PATH ?? '../../src/skill-taxonomy.json',
  ),
});
