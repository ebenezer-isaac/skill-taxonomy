import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { config } from './config.js';
import { typeDefs } from './schema/index.js';
import { resolvers } from './resolvers/index.js';
import { createDriver, closeDriver, verifyConnectivity } from './neo4j/driver.js';
import type { GraphContext } from './types/index.js';

async function main(): Promise<void> {
  console.log('🚀 Skill Taxonomy GraphQL API');
  console.log('==============================\n');

  console.log(`🔌 Connecting to Neo4j at ${config.neo4jUri}`);
  const driver = createDriver(config.neo4jUri, config.neo4jUser, config.neo4jPassword);
  await verifyConnectivity(driver);
  console.log('   Connected\n');

  const server = new ApolloServer<GraphContext>({ typeDefs, resolvers });

  const { url } = await startStandaloneServer(server, {
    listen: { port: config.port },
    context: async (): Promise<GraphContext> => ({ driver }),
  });

  console.log(`📡 GraphQL API ready at ${url}`);

  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    await server.stop();
    await closeDriver();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('❌ Failed to start:', err);
  closeDriver().finally(() => process.exit(1));
});
