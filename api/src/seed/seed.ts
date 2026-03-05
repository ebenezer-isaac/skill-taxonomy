import { config } from '../config.js';
import { createDriver, closeDriver, verifyConnectivity } from '../neo4j/driver.js';
import { loadTaxonomy } from './loader.js';
import { createIndexes, clearDatabase } from './indexes.js';
import { createSkillNodes, createIndustryNodes, createCategoryNodes } from './node-creator.js';
import { createRelationships } from './relationship-creator.js';

async function seed(): Promise<void> {
  const startTime = Date.now();
  console.log('🌱 Skill Taxonomy — Neo4j Seed');
  console.log('================================\n');

  console.log(`📂 Loading taxonomy from: ${config.taxonomyPath}`);
  const taxonomy = loadTaxonomy(config.taxonomyPath);
  const skillCount = Object.keys(taxonomy).length;
  console.log(`   ${skillCount} canonical skills loaded\n`);

  console.log(`🔌 Connecting to Neo4j at ${config.neo4jUri}`);
  const driver = createDriver(config.neo4jUri, config.neo4jUser, config.neo4jPassword);
  await verifyConnectivity(driver);
  console.log('   Connected\n');

  const shouldClear = process.argv.includes('--clear');
  if (shouldClear) {
    console.log('🗑  Clearing existing data...');
    await clearDatabase(driver);
    console.log('');
  }

  console.log('📐 Creating indexes and constraints...');
  await createIndexes(driver);
  console.log('');

  console.log('📦 Creating nodes...');
  await createSkillNodes(driver, taxonomy);
  await createIndustryNodes(driver, taxonomy);
  await createCategoryNodes(driver, taxonomy);
  console.log('');

  console.log('🔗 Creating relationships...');
  await createRelationships(driver, taxonomy);
  console.log('');

  await closeDriver();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Seed complete in ${elapsed}s`);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  closeDriver().finally(() => process.exit(1));
});
