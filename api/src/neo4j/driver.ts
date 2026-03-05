import neo4j, { type Driver } from 'neo4j-driver';

let driverInstance: Driver | null = null;

export function createDriver(uri: string, user: string, password: string): Driver {
  driverInstance = neo4j.driver(uri, neo4j.auth.basic(user, password));
  return driverInstance;
}

export function getDriver(): Driver {
  if (!driverInstance) throw new Error('Neo4j driver not initialized — call createDriver() first');
  return driverInstance;
}

export async function closeDriver(): Promise<void> {
  if (driverInstance) {
    await driverInstance.close();
    driverInstance = null;
  }
}

export async function verifyConnectivity(driver: Driver): Promise<void> {
  const session = driver.session({ defaultAccessMode: 'READ' });
  try {
    await session.run('RETURN 1');
  } finally {
    await session.close();
  }
}
