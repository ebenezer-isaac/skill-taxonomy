/**
 * Expand aliases for existing taxonomy entries using ESCO altLabels.
 *
 * Connects to MongoDB, looks up each taxonomy entry in ESCO skills,
 * and adds any altLabels that aren't already present.
 *
 * Usage:
 *   tsx scripts/expand-aliases.ts                          # dry run
 *   tsx scripts/expand-aliases.ts --apply                  # write to taxonomy
 *   tsx scripts/expand-aliases.ts --mongo-uri mongodb://...
 */
import { MongoClient } from 'mongodb';
import { loadTaxonomy, reportAndApply, normalize, type CandidateEntry } from './common';

const MONGO_URI = process.argv.find((a) => a.startsWith('--mongo-uri='))?.split('=')[1]
  ?? process.env.MONGO_URI
  ?? 'mongodb://localhost:27017/llmconveyors';

async function main(): Promise<void> {
  const taxonomy = loadTaxonomy();
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db();
    const escoSkills = db.collection('escoSkills');

    // Check collection exists
    const count = await escoSkills.countDocuments();
    if (count === 0) {
      console.error('escoSkills collection is empty. Run infra/esco/seed.sh first.');
      process.exit(1);
    }

    const candidates: CandidateEntry[] = [];

    for (const [canonical, existingAliases] of Object.entries(taxonomy)) {
      // Search ESCO for this skill
      const results = await escoSkills
        .find({ $text: { $search: canonical } }, { score: { $meta: 'textScore' } } as any)
        .sort({ score: { $meta: 'textScore' } } as any)
        .limit(3)
        .toArray();

      if (results.length === 0) continue;

      // Take the best match — must have a reasonable text score
      const best = results[0] as any;
      if (!best.preferredLabel) continue;

      // Check it's actually a match (not just a vaguely similar term)
      const normalizedBest = normalize(best.preferredLabel);
      const normalizedCanonical = normalize(canonical);
      if (
        normalizedBest !== normalizedCanonical &&
        !normalizedBest.includes(normalizedCanonical) &&
        !normalizedCanonical.includes(normalizedBest)
      ) {
        continue; // Not a close enough match
      }

      const altLabels: string[] = Array.isArray(best.altLabels) ? best.altLabels : [];
      const existingSet = new Set(existingAliases.map((a) => a.toLowerCase()));
      const newAliases = altLabels.filter(
        (label: string) => typeof label === 'string' && label.trim() !== '' && !existingSet.has(label.toLowerCase()),
      );

      if (newAliases.length > 0) {
        candidates.push({
          canonical,
          aliases: newAliases,
          source: 'alias-expansion',
          category: 'esco-altLabels',
        });
      }
    }

    console.log(`[expand-aliases] Scanned ${Object.keys(taxonomy).length} entries against ESCO`);
    reportAndApply(candidates, 'alias-expansion');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Alias expansion failed:', err);
  process.exit(1);
});
