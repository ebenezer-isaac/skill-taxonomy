# skill taxonomy

The world's largest open source skill taxonomy for ATS resume scoring. 14,774 canonical skills with 175K+ aliases, hierarchical relationships, and 30+ metadata fields per skill.

## What's in the box

| Metric | Count |
|--------|-------|
| Canonical skills | 14,774 |
| Aliases | ~175,000+ |
| Industries | ~2,100+ |
| Categories | ~7,600+ |
| Metadata fields per skill | 30+ |

Each skill entry includes aliases, broader terms, related skills, prerequisites, complementary skills, alternative skills, certifications, industry tags, job titles, trend direction, demand level, ecosystem, skill type, and more.

## Install

```bash
npm install skill-taxonomy
```

## Quick start

```typescript
import {
  taxonomy,
  skillTaxonomyMap,
  buildReverseLookup,
  buildCanonicalSet,
  getStats,
} from 'skill-taxonomy';

// Flat view: canonical to aliases[] (for O(1) keyword matching)
console.log(taxonomy['python']); // ["py", "python3", "python 3", ...]

// Full metadata view: canonical to SkillEntry
const python = skillTaxonomyMap['python'];
console.log(python.category);          // "programming language"
console.log(python.industries);        // ["technology", "finance", ...]
console.log(python.broaderTerms);      // ["general purpose programming", ...]
console.log(python.demandLevel);       // "high"
console.log(python.trendDirection);    // "growing"

// Reverse lookup: alias to canonical
const lookup = buildReverseLookup(taxonomy);
console.log(lookup.get('k8s'));        // "kubernetes"
console.log(lookup.get('reactjs'));    // "react"

// Stats
console.log(getStats(taxonomy));
// { canonicals: 14774, aliases: 175000+, total: 190000+ }
```

## TypeScript types

```typescript
import type {
  SkillEntry,
  SkillTaxonomyMap,
  SkillTaxonomy,
  TaxonomyStats,
} from 'skill-taxonomy';
```

### SkillEntry fields

| Field | Type | Description |
|-------|------|-------------|
| `aliases` | `string[]` | Synonyms, abbreviations, misspellings, versions |
| `category` | `string` | Skill category (e.g. "programming language", "cloud platform") |
| `description` | `string` | One sentence description |
| `industries` | `string[]` | Industries that commonly require this skill |
| `senioritySignal` | `string` | Career level this skill signals |
| `broaderTerms` | `string[]` | Parent concepts for cross matching |
| `relatedSkills` | `string[]` | Related but distinct skills |
| `isValidSkill` | `boolean` | Whether this is a valid real world skill |
| `confidence` | `string` | LLM confidence: "high", "medium", "low", "pending" |
| `sources` | `string[]` | Data provenance (esco, onet, stackoverflow, etc.) |
| `skillType` | `string` | Classification: tool, framework, language, methodology |
| `trendDirection` | `string` | Market trajectory: emerging, growing, stable, declining |
| `demandLevel` | `string` | Job market demand: high, medium, low, niche |
| `commonJobTitles` | `string[]` | Job titles that require this skill |
| `prerequisites` | `string[]` | Skills needed before learning this one |
| `complementarySkills` | `string[]` | Commonly paired skills |
| `certifications` | `string[]` | Relevant professional certifications |
| `parentCategory` | `string` | Hierarchical parent for taxonomy tree |
| `isRegionSpecific` | `string \| null` | Region if geographically specific |
| `ecosystem` | `string` | Technology ecosystem (e.g. "javascript", "aws") |
| `alternativeSkills` | `string[]` | Competing/substitutable skills |
| `learningDifficulty` | `string` | Difficulty level to learn |
| `typicalExperienceYears` | `string` | Typical resume experience range |
| `salaryImpact` | `string` | Compensation impact |
| `automationRisk` | `string` | Risk of being automated |
| `communitySize` | `string` | Practitioner community size |
| `isOpenSource` | `boolean \| null` | Open source status |
| `keywords` | `string[]` | Cross cutting discovery tags |
| `emergingYear` | `number \| null` | Year introduced |

## Data pipeline

The taxonomy is built through a multi stage ingestion and validation pipeline:

```
ESCO API  ──┐
O*NET       │
StackOverflow├──→ merge all ──→ deduplicate ──→ validate:llm ──→ skill-taxonomy.json
Lightcast   │
LinkedIn    │
Verticals ──┘
```

### Pipeline scripts

All scripts use `--apply` flag for dry run by default.

```bash
# 1. Fetch skills from external APIs
pnpm run fetch:api             # ESCO skills via API

# 2. Import from local data sources
pnpm run import:lightcast      # Lightcast/EMSI skills
pnpm run import:linkedin       # LinkedIn skills

# 3. Import industry specific verticals
pnpm run import:verticals      # Healthcare, finance, legal, etc.

# 4. Merge all sources into taxonomy
pnpm run merge:all             # Combine all imported skills

# 5. Deduplicate
pnpm run deduplicate           # Remove duplicates, merge aliases

# 6. LLM validation and metadata generation
pnpm run validate:llm          # Process with Gemini Flash (requires GEMINI_API_KEY)
pnpm run validate:llm -- --apply  # Apply structural changes (remove/merge/rename)

# 7. Structural validation
pnpm run validate              # Check for orphans, missing fields, etc.
```

### Environment variables

Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your-gemini-api-key
```

## GraphQL API

The taxonomy can be queried through a Neo4j backed GraphQL API with graph traversals, fuzzy search, and filtering. See [api/README.md](api/README.md) for setup and usage.

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build

# Watch tests
pnpm test:watch
```

## Project structure

```
src/
  index.ts                     # Main exports: taxonomy, skillTaxonomyMap, utilities
  skill-taxonomy.json          # The canonical taxonomy data (14,774 skills)
  types/
    taxonomy.types.ts          # SkillEntry, SkillTaxonomyMap, SkillTaxonomy types
    index.ts                   # Type barrel export

scripts/
  common.ts                    # Shared utilities: load/save taxonomy, merge candidates
  validate-with-llm.ts         # LLM validation pipeline (Gemini Flash)
  validate.ts                  # Structural validation checks
  deduplicate-taxonomy.ts      # Deduplication engine
  merge-all.ts                 # Multi source merger
  fetch-via-api.ts             # ESCO API fetcher
  import-lightcast.ts          # Lightcast importer
  import-linkedin.ts           # LinkedIn importer
  import-verticals-enhanced.ts # Industry vertical importer

api/                           # Neo4j + GraphQL API (see api/README.md)
```

## License

MIT
