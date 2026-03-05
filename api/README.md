# Skill Taxonomy GraphQL API

A Neo4j-backed GraphQL API for querying the skill taxonomy with graph traversals, fuzzy search, and filtering.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/)

## Quick start

### 1. Start Neo4j

```bash
cd api
docker compose up -d neo4j
```

Wait for the healthcheck to pass (~15s):

```bash
docker compose ps   # should show "healthy"
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

Create `api/.env`:

```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=taxonomy_dev_password
API_PORT=4000
```

### 4. Seed the database

```bash
pnpm seed
```

This reads `src/skill-taxonomy.json` and populates Neo4j with:
- 14,774 Skill nodes (all metadata as properties)
- ~2,100 Industry nodes + relationships
- ~7,600 Category nodes + relationships
- ~166,000 skill-to-skill relationships (broader, related, complementary, etc.)

Seeding takes ~30-40 seconds.

### 5. Start the API

```bash
pnpm dev
```

The GraphQL API starts at `http://localhost:4000`. Open it in a browser for Apollo Sandbox.

## Example queries

### Exact skill lookup

```graphql
query {
  skill(canonicalName: "python") {
    canonicalName
    description
    category
    ecosystem
    demandLevel
    trendDirection
    aliases
    industries { name }
    broaderTerms { canonicalName }
    relatedSkills(limit: 5) { canonicalName }
  }
}
```

### Reverse alias lookup

```graphql
query {
  skillByAlias(alias: "k8s") {
    canonicalName
    description
    category
  }
}
```

### Fuzzy search

```graphql
query {
  searchSkills(query: "machine learn", limit: 10) {
    score
    skill {
      canonicalName
      category
      demandLevel
    }
  }
}
```

### Filtered listing

```graphql
query {
  skills(
    filter: { ecosystem: "javascript", demandLevel: "high" }
    limit: 10
  ) {
    canonicalName
    trendDirection
    commonJobTitles
  }
}
```

### Graph traversal — broader terms

```graphql
query {
  broaderTerms(canonicalName: "react", depth: 2) {
    canonicalName
    category
  }
}
```

### Learning path (prerequisite chain)

```graphql
query {
  learningPath(from: "html", to: "react") {
    skills { canonicalName }
    relationships
    length
  }
}
```

### Shortest path between skills

```graphql
query {
  shortestPath(from: "python", to: "kubernetes") {
    skills { canonicalName }
    relationships
    length
  }
}
```

### Taxonomy statistics

```graphql
query {
  stats {
    totalSkills
    totalIndustries
    totalCategories
    totalRelationships
    processedSkills
    skillTypeDistribution { key count }
    demandLevelDistribution { key count }
    trendDistribution { key count }
  }
}
```

### Browse by industry

```graphql
query {
  industries {
    name
    skills(limit: 5) {
      canonicalName
      demandLevel
    }
  }
}
```

## curl examples

```bash
# Skill lookup
curl -s http://localhost:4000 \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ skill(canonicalName: \"python\") { canonicalName description category demandLevel } }"}'

# Fuzzy search
curl -s http://localhost:4000 \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ searchSkills(query: \"kubernetes\", limit: 5) { score skill { canonicalName } } }"}'

# Stats
curl -s http://localhost:4000 \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ stats { totalSkills totalIndustries totalCategories totalRelationships } }"}'
```

## Docker Compose (full stack)

To run both Neo4j and the API in containers:

```bash
docker compose up -d
```

This starts:
- **Neo4j** on ports 7474 (browser) and 7687 (bolt)
- **API** on port 4000

Note: You still need to seed after Neo4j is healthy:

```bash
pnpm seed
```

## Neo4j schema

### Nodes

| Label | Count | Key Property |
|-------|-------|-------------|
| `:Skill` | 14,774 | `canonicalName` (unique) |
| `:Industry` | ~2,100 | `name` (unique) |
| `:Category` | ~7,600 | `name` (unique) |

### Relationships

| Type | Meaning |
|------|---------|
| `BROADER_THAN` | Skill has a broader parent concept |
| `RELATED_TO` | Bidirectional association |
| `COMPLEMENTARY_WITH` | Commonly paired together |
| `ALTERNATIVE_TO` | Substitutable/competing |
| `REQUIRES` | Prerequisite dependency |
| `IN_INDUSTRY` | Skill belongs to industry |
| `IN_CATEGORY` | Skill belongs to category |
| `IN_PARENT_CATEGORY` | Skill belongs to parent category |

### Unresolved references

~70-75% of relationship targets in the taxonomy are free-text labels that don't match a canonical skill name. These are stored as list properties on the Skill node (`unresolvedBroaderTerms`, `unresolvedRelatedSkills`, etc.) and exposed in the GraphQL schema for transparency.

## Project structure

```
api/
  docker-compose.yml           # Neo4j + API containers
  Dockerfile                   # Multi-stage API build
  package.json
  tsconfig.json
  .env.example
  src/
    index.ts                   # Apollo Server bootstrap
    config.ts                  # Environment configuration
    schema/
      typeDefs.ts              # GraphQL SDL
    resolvers/
      skill.resolvers.ts       # Skill lookup, listing, filtering
      search.resolvers.ts      # Fuzzy search via fulltext index
      traversal.resolvers.ts   # Paths, hops, learning paths
      taxonomy.resolvers.ts    # Stats, industries, categories
    neo4j/
      driver.ts                # Driver singleton + lifecycle
      queries.ts               # Named Cypher query constants
      mapper.ts                # Neo4j Record to GraphQL DTO
    types/
      index.ts                 # API-layer TypeScript types
    seed/
      seed.ts                  # Seed orchestrator
      loader.ts                # Reads taxonomy JSON
      node-creator.ts          # Batch Skill/Industry/Category nodes
      relationship-creator.ts  # Batch relationships with resolution
      indexes.ts               # Constraints + indexes
```

## Scripts

```bash
pnpm seed        # Seed Neo4j from skill-taxonomy.json
pnpm dev         # Start API in dev mode (watch)
pnpm build       # Compile TypeScript
pnpm start       # Start compiled API
pnpm typecheck   # Type check without emitting
```
