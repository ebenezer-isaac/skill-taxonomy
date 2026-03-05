import { skillResolvers } from './skill.resolvers.js';
import { searchResolvers } from './search.resolvers.js';
import { traversalResolvers } from './traversal.resolvers.js';
import { taxonomyResolvers } from './taxonomy.resolvers.js';

/** Merge all resolver maps into a single object for Apollo Server */
export const resolvers = {
  Query: {
    ...skillResolvers.Query,
    ...searchResolvers.Query,
    ...traversalResolvers.Query,
    ...taxonomyResolvers.Query,
  },
  Skill: {
    ...skillResolvers.Skill,
  },
  Industry: {
    ...taxonomyResolvers.Industry,
  },
  Category: {
    ...taxonomyResolvers.Category,
  },
};
