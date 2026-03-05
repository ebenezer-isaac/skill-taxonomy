// ── Skill Lookups ──────────────────────────────────────────────

export const FIND_SKILL_BY_NAME = `
  MATCH (s:Skill {canonicalName: $name})
  RETURN s
`;

export const FIND_SKILL_BY_ALIAS = `
  MATCH (s:Skill)
  WHERE $alias IN s.aliases
  RETURN s
  LIMIT 1
`;

// ── Fuzzy Search ───────────────────────────────────────────────

export const SEARCH_SKILLS_FUZZY = `
  CALL db.index.fulltext.queryNodes('skill_search', $searchTerm)
  YIELD node, score
  RETURN node AS s, score
  ORDER BY score DESC
  LIMIT $limit
`;

// ── Filtered Listing ───────────────────────────────────────────

export const FILTER_SKILLS = `
  MATCH (s:Skill)
  WHERE ($ecosystem IS NULL OR s.ecosystem = $ecosystem)
    AND ($category IS NULL OR s.category = $category)
    AND ($skillType IS NULL OR s.skillType = $skillType)
    AND ($demandLevel IS NULL OR s.demandLevel = $demandLevel)
    AND ($trendDirection IS NULL OR s.trendDirection = $trendDirection)
    AND ($confidence IS NULL OR s.confidence = $confidence)
    AND ($senioritySignal IS NULL OR s.senioritySignal = $senioritySignal)
    AND ($isValidSkill IS NULL OR s.isValidSkill = $isValidSkill)
  RETURN s
  ORDER BY s.canonicalName
  SKIP $offset
  LIMIT $limit
`;

export const COUNT_SKILLS = `
  MATCH (s:Skill)
  WHERE ($ecosystem IS NULL OR s.ecosystem = $ecosystem)
    AND ($category IS NULL OR s.category = $category)
    AND ($skillType IS NULL OR s.skillType = $skillType)
    AND ($demandLevel IS NULL OR s.demandLevel = $demandLevel)
    AND ($trendDirection IS NULL OR s.trendDirection = $trendDirection)
    AND ($confidence IS NULL OR s.confidence = $confidence)
    AND ($senioritySignal IS NULL OR s.senioritySignal = $senioritySignal)
    AND ($isValidSkill IS NULL OR s.isValidSkill = $isValidSkill)
  RETURN count(s) AS total
`;

// ── Graph Traversal ────────────────────────────────────────────

export const BROADER_TERMS_N_LEVELS = `
  MATCH (s:Skill {canonicalName: $name})-[:BROADER_THAN*1..10]->(broader:Skill)
  WITH broader, min(length(
    shortestPath((s)-[:BROADER_THAN*]->(broader))
  )) AS depth
  WHERE depth <= $depth
  RETURN broader AS s, depth
  ORDER BY depth
`;

export const RELATED_SKILLS_N_HOPS = `
  MATCH path = (s:Skill {canonicalName: $name})-[:RELATED_TO|COMPLEMENTARY_WITH*1..5]-(related:Skill)
  WHERE related.canonicalName <> $name
  WITH DISTINCT related, min(length(path)) AS distance
  WHERE distance <= $hops
  RETURN related AS s, distance
  ORDER BY distance
  LIMIT $limit
`;

export const SHORTEST_PATH = `
  MATCH (a:Skill {canonicalName: $from}), (b:Skill {canonicalName: $to})
  MATCH path = shortestPath((a)-[:REQUIRES|BROADER_THAN|RELATED_TO|COMPLEMENTARY_WITH*..10]-(b))
  RETURN path
`;

export const LEARNING_PATH = `
  MATCH (a:Skill {canonicalName: $from}), (b:Skill {canonicalName: $to})
  MATCH path = shortestPath((a)-[:REQUIRES|BROADER_THAN|COMPLEMENTARY_WITH*..10]-(b))
  RETURN path
`;

// ── Relationship Resolvers (lazy) ──────────────────────────────

export const SKILL_BROADER_TERMS = `
  MATCH (s:Skill {canonicalName: $name})-[:BROADER_THAN]->(b:Skill)
  RETURN b AS s
`;

export const SKILL_RELATED = `
  MATCH (s:Skill {canonicalName: $name})-[:RELATED_TO]-(r:Skill)
  RETURN DISTINCT r AS s
  LIMIT $limit
`;

export const SKILL_COMPLEMENTARY = `
  MATCH (s:Skill {canonicalName: $name})-[:COMPLEMENTARY_WITH]-(c:Skill)
  RETURN DISTINCT c AS s
`;

export const SKILL_ALTERNATIVES = `
  MATCH (s:Skill {canonicalName: $name})-[:ALTERNATIVE_TO]-(a:Skill)
  RETURN DISTINCT a AS s
`;

export const SKILL_PREREQUISITES = `
  MATCH (s:Skill {canonicalName: $name})-[:REQUIRES]->(p:Skill)
  RETURN p AS s
`;

export const SKILL_INDUSTRIES = `
  MATCH (s:Skill {canonicalName: $name})-[:IN_INDUSTRY]->(i:Industry)
  RETURN i
`;

// ── Taxonomy Browsing ──────────────────────────────────────────

export const ALL_INDUSTRIES = `
  MATCH (i:Industry)
  RETURN i
  ORDER BY i.name
`;

export const ALL_CATEGORIES = `
  MATCH (c:Category)
  RETURN c
  ORDER BY c.name
`;

export const ALL_ECOSYSTEMS = `
  MATCH (s:Skill)
  WHERE s.ecosystem IS NOT NULL AND s.ecosystem <> ''
  RETURN DISTINCT s.ecosystem AS ecosystem
  ORDER BY ecosystem
`;

export const INDUSTRY_SKILLS = `
  MATCH (i:Industry {name: $name})<-[:IN_INDUSTRY]-(s:Skill)
  RETURN s
  ORDER BY s.canonicalName
  SKIP $offset
  LIMIT $limit
`;

export const CATEGORY_SKILLS = `
  MATCH (c:Category {name: $name})<-[:IN_CATEGORY]-(s:Skill)
  RETURN s
  ORDER BY s.canonicalName
  SKIP $offset
  LIMIT $limit
`;

// ── Stats ──────────────────────────────────────────────────────

export const TAXONOMY_STATS = `
  MATCH (s:Skill)
  WITH count(s) AS totalSkills
  OPTIONAL MATCH (i:Industry)
  WITH totalSkills, count(DISTINCT i) AS totalIndustries
  RETURN totalSkills, totalIndustries
`;

export const TOTAL_RELATIONSHIPS = `
  MATCH ()-[r]->()
  RETURN count(r) AS total
`;

export const ENRICHED_COUNT = `
  MATCH (s:Skill)
  WHERE s.confidence <> 'pending'
  RETURN count(s) AS total
`;

export const SKILL_TYPE_DISTRIBUTION = `
  MATCH (s:Skill)
  WHERE s.skillType IS NOT NULL AND s.skillType <> ''
  RETURN s.skillType AS key, count(s) AS count
  ORDER BY count DESC
`;

export const DEMAND_LEVEL_DISTRIBUTION = `
  MATCH (s:Skill)
  WHERE s.demandLevel IS NOT NULL AND s.demandLevel <> ''
  RETURN s.demandLevel AS key, count(s) AS count
  ORDER BY count DESC
`;

export const TREND_DISTRIBUTION = `
  MATCH (s:Skill)
  WHERE s.trendDirection IS NOT NULL AND s.trendDirection <> ''
  RETURN s.trendDirection AS key, count(s) AS count
  ORDER BY count DESC
`;

export const TOTAL_CATEGORIES = `
  MATCH (c:Category)
  RETURN count(c) AS total
`;
