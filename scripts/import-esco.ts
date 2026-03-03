/**
 * Import skills from ESCO (European Skills, Competences, Qualifications and Occupations).
 *
 * Reads from MongoDB (assumes ESCO is seeded via infra/esco/seed.sh) and extracts
 * the most commonly referenced skills across occupations.
 *
 * Usage:
 *   tsx scripts/import-esco.ts                          # dry run
 *   tsx scripts/import-esco.ts --apply                  # write to taxonomy
 *   tsx scripts/import-esco.ts --mongo-uri mongodb://... # custom connection
 *   tsx scripts/import-esco.ts --limit 500              # top N skills (default 500)
 */
import { MongoClient } from 'mongodb';
import { reportAndApply, normalize, type CandidateEntry } from './common';

const MONGO_URI = process.argv.find((a) => a.startsWith('--mongo-uri='))?.split('=')[1]
  ?? process.env.MONGO_URI
  ?? 'mongodb://localhost:27017/llmconveyors';

const LIMIT = parseInt(
  process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '500',
  10,
);

async function main(): Promise<void> {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();

    // Check if ESCO collections exist
    const collections = await db.listCollections().toArray();
    const collNames = new Set(collections.map((c) => c.name));
    if (!collNames.has('escoSkills') || !collNames.has('escoOccupationSkills')) {
      console.error('ESCO collections not found. Run infra/esco/seed.sh first.');
      process.exit(1);
    }

    // Aggregate: count how many occupations reference each skill
    const pipeline = [
      { $group: { _id: '$skillUri', occupationCount: { $sum: 1 } } },
      { $sort: { occupationCount: -1 as const } },
      { $limit: LIMIT },
      {
        $lookup: {
          from: 'escoSkills',
          localField: '_id',
          foreignField: '_id',
          as: 'skill',
        },
      },
      { $unwind: '$skill' },
      {
        $project: {
          preferredLabel: '$skill.preferredLabel',
          altLabels: '$skill.altLabels',
          skillType: '$skill.skillType',
          reuseLevel: '$skill.reuseLevel',
          occupationCount: 1,
        },
      },
    ];

    const results = await db.collection('escoOccupationSkills').aggregate(pipeline).toArray();

    const candidates: CandidateEntry[] = results
      .filter((r) => r.preferredLabel && typeof r.preferredLabel === 'string')
      .map((r) => ({
        canonical: normalize(r.preferredLabel),
        aliases: Array.isArray(r.altLabels)
          ? r.altLabels.filter((a: unknown) => typeof a === 'string' && a.trim() !== '')
          : [],
        source: 'esco-bridge',
        category: `${r.skillType ?? 'unknown'} / ${r.reuseLevel ?? 'unknown'}`,
      }));

    console.log(`[esco] Fetched ${results.length} skills from MongoDB (top ${LIMIT} by occupation count)`);
    reportAndApply(candidates, 'esco-bridge');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('ESCO import failed:', err);
  process.exit(1);
});
