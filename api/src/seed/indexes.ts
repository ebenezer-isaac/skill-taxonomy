import type { Driver } from 'neo4j-driver';

const CONSTRAINTS = [
  'CREATE CONSTRAINT skill_canonical IF NOT EXISTS FOR (s:Skill) REQUIRE s.canonicalName IS UNIQUE',
  'CREATE CONSTRAINT industry_name IF NOT EXISTS FOR (i:Industry) REQUIRE i.name IS UNIQUE',
  'CREATE CONSTRAINT category_name IF NOT EXISTS FOR (c:Category) REQUIRE c.name IS UNIQUE',
];

const INDEXES = [
  'CREATE INDEX skill_type IF NOT EXISTS FOR (s:Skill) ON (s.skillType)',
  'CREATE INDEX skill_ecosystem IF NOT EXISTS FOR (s:Skill) ON (s.ecosystem)',
  'CREATE INDEX skill_demand IF NOT EXISTS FOR (s:Skill) ON (s.demandLevel)',
  'CREATE INDEX skill_trend IF NOT EXISTS FOR (s:Skill) ON (s.trendDirection)',
  'CREATE INDEX skill_category IF NOT EXISTS FOR (s:Skill) ON (s.category)',
  'CREATE INDEX skill_confidence IF NOT EXISTS FOR (s:Skill) ON (s.confidence)',
  'CREATE INDEX skill_seniority IF NOT EXISTS FOR (s:Skill) ON (s.senioritySignal)',
];

const FULLTEXT_INDEX = `
  CREATE FULLTEXT INDEX skill_search IF NOT EXISTS
  FOR (s:Skill) ON EACH [s.canonicalName]
`;

export async function createIndexes(driver: Driver): Promise<void> {
  const session = driver.session();
  try {
    for (const stmt of [...CONSTRAINTS, ...INDEXES]) {
      await session.run(stmt);
    }
    await session.run(FULLTEXT_INDEX);
    console.log(`   Created ${CONSTRAINTS.length} constraints, ${INDEXES.length + 1} indexes`);
  } finally {
    await session.close();
  }
}

export async function clearDatabase(driver: Driver): Promise<void> {
  const session = driver.session();
  try {
    await session.run('MATCH (n) DETACH DELETE n');
    console.log('   Cleared all nodes and relationships');
  } finally {
    await session.close();
  }
}
