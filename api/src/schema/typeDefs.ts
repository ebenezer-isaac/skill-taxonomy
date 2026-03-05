export const typeDefs = `#graphql
  type Skill {
    canonicalName: String!
    description: String
    aliases: [String!]!
    category: String
    parentCategory: String
    skillType: String
    ecosystem: String
    senioritySignal: String
    trendDirection: String
    demandLevel: String
    confidence: String
    isValidSkill: Boolean!
    isOpenSource: Boolean
    isRegionSpecific: String
    learningDifficulty: String
    typicalExperienceYears: String
    salaryImpact: String
    automationRisk: String
    communitySize: String
    emergingYear: Int
    sources: [String!]!
    keywords: [String!]!
    commonJobTitles: [String!]!
    certifications: [String!]!

    # Graph traversals (resolved lazily from Neo4j relationships)
    broaderTerms: [Skill!]!
    relatedSkills(limit: Int = 20): [Skill!]!
    complementarySkills: [Skill!]!
    alternativeSkills: [Skill!]!
    prerequisites: [Skill!]!
    industries: [Industry!]!

    # Unresolved free-text references (targets not matching a canonical skill)
    unresolvedBroaderTerms: [String!]!
    unresolvedRelatedSkills: [String!]!
    unresolvedPrerequisites: [String!]!
    unresolvedComplementarySkills: [String!]!
  }

  type Industry {
    name: String!
    skills(limit: Int = 50, offset: Int = 0): [Skill!]!
  }

  type Category {
    name: String!
    skills(limit: Int = 50, offset: Int = 0): [Skill!]!
  }

  type SearchResult {
    skill: Skill!
    score: Float!
  }

  type PathResult {
    skills: [Skill!]!
    relationships: [String!]!
    length: Int!
  }

  type KeyCount {
    key: String!
    count: Int!
  }

  type TaxonomyStats {
    totalSkills: Int!
    totalIndustries: Int!
    totalCategories: Int!
    totalRelationships: Int!
    enrichedSkills: Int!
    skillTypeDistribution: [KeyCount!]!
    demandLevelDistribution: [KeyCount!]!
    trendDistribution: [KeyCount!]!
  }

  input SkillFilter {
    ecosystem: String
    category: String
    skillType: String
    demandLevel: String
    trendDirection: String
    confidence: String
    senioritySignal: String
    isValidSkill: Boolean
  }

  type Query {
    """Exact lookup by canonical name"""
    skill(canonicalName: String!): Skill

    """Reverse lookup: find the skill that owns this alias"""
    skillByAlias(alias: String!): Skill

    """Filtered and paginated skill listing"""
    skills(filter: SkillFilter, limit: Int = 25, offset: Int = 0): [Skill!]!

    """Count skills matching a filter"""
    skillCount(filter: SkillFilter): Int!

    """Fuzzy search across canonical names, aliases, and keywords"""
    searchSkills(query: String!, limit: Int = 20): [SearchResult!]!

    """Walk broader-term hierarchy up N levels"""
    broaderTerms(canonicalName: String!, depth: Int = 1): [Skill!]!

    """Discover related skills within N hops"""
    relatedSkills(canonicalName: String!, hops: Int = 1, limit: Int = 20): [Skill!]!

    """Find the prerequisite-based learning path between two skills"""
    learningPath(from: String!, to: String!): PathResult

    """Find the shortest path between two skills via any relationship"""
    shortestPath(from: String!, to: String!): PathResult

    """List all industries"""
    industries: [Industry!]!

    """List all categories"""
    categories: [Category!]!

    """List all unique ecosystems"""
    ecosystems: [String!]!

    """Taxonomy-wide statistics"""
    stats: TaxonomyStats!
  }
`;
