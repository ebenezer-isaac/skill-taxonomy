/**
 * Promote high-frequency JD keyword misses to taxonomy candidates.
 *
 * Connects to the API's MongoDB, aggregates jdKeywordMisses collection,
 * and generates taxonomy additions for the most commonly missed keywords.
 *
 * Usage:
 *   tsx scripts/promote-misses.ts                          # dry run
 *   tsx scripts/promote-misses.ts --apply                  # write to taxonomy
 *   tsx scripts/promote-misses.ts --mongo-uri mongodb://...
 *   tsx scripts/promote-misses.ts --min-frequency 5        # minimum miss count (default 5)
 */
import { MongoClient } from 'mongodb';
import { loadTaxonomy, buildKnownTerms, reportAndApply, type CandidateEntry } from './common';

const MONGO_URI = process.argv.find((a) => a.startsWith('--mongo-uri='))?.split('=')[1]
  ?? process.env.MONGO_URI
  ?? 'mongodb://localhost:27017/llmconveyors';

const MIN_FREQUENCY = parseInt(
  process.argv.find((a) => a.startsWith('--min-frequency='))?.split('=')[1] ?? '5',
  10,
);

async function main(): Promise<void> {
  const taxonomy = loadTaxonomy();
  const known = buildKnownTerms(taxonomy);
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db();

    // Check collection exists
    const collections = await db.listCollections({ name: 'jdKeywordMisses' }).toArray();
    if (collections.length === 0) {
      console.log('jdKeywordMisses collection does not exist yet.');
      console.log('Run the API with TaxonomyService to start collecting miss data.');
      process.exit(0);
    }

    // Aggregate misses by keyword
    const pipeline = [
      {
        $group: {
          _id: '$keyword',
          count: { $sum: 1 },
          latestSnippet: { $last: '$jdSnippet' },
          latestJobTitle: { $last: '$jobTitle' },
        },
      },
      { $match: { count: { $gte: MIN_FREQUENCY } } },
      { $sort: { count: -1 as const } },
      { $limit: 200 },
    ];

    const results = await db.collection('jdKeywordMisses').aggregate(pipeline).toArray();

    console.log(`[promote-misses] Found ${results.length} keywords missed ${MIN_FREQUENCY}+ times`);

    // Filter out keywords already in taxonomy
    const candidates: CandidateEntry[] = results
      .filter((r) => !known.has(r._id.toLowerCase()))
      .map((r) => ({
        canonical: r._id.toLowerCase(),
        aliases: [],
        source: 'jd-miss-logger',
        category: `frequency: ${r.count}`,
      }));

    if (candidates.length > 0) {
      console.log('\nTop misses:');
      for (const c of candidates.slice(0, 20)) {
        const r = results.find((x) => x._id.toLowerCase() === c.canonical);
        console.log(`  ${r?.count ?? '?'}x  "${c.canonical}" — e.g., "${r?.latestSnippet?.slice(0, 80) ?? ''}"`);
      }
    }

    reportAndApply(candidates, 'jd-miss-promotion');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Miss promotion failed:', err);
  process.exit(1);
});
