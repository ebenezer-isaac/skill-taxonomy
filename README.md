# skill-taxonomy

[![npm version](https://img.shields.io/npm/v/skill-taxonomy.svg)](https://www.npmjs.com/package/skill-taxonomy)
[![npm downloads](https://img.shields.io/npm/dm/skill-taxonomy.svg)](https://www.npmjs.com/package/skill-taxonomy)
[![license](https://img.shields.io/npm/l/skill-taxonomy.svg)](https://github.com/ebenezer-isaac/skill-taxonomy/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![tests](https://img.shields.io/badge/tests-92%20passing-brightgreen.svg)](#testing)

The largest open-source skill taxonomy for resume parsing, ATS scoring, and talent analytics. **14,774 canonical skills**, **175K+ aliases**, and a built-in **Aho-Corasick automaton** that finds every skill mention in a single O(n) pass.

## Why this exists

Every ATS, job board, and HR-tech product needs to match skills from resumes and job descriptions. Most teams end up with a hand-maintained list of 200 skills and a pile of regexes. This package gives you:

- A **production-grade taxonomy** built from ESCO, O\*NET, Lightcast, LinkedIn, and StackOverflow
- An **Aho-Corasick automaton** that replaces thousands of regex patterns with one linear-time scan
- **30+ metadata fields** per skill: industry tags, demand level, trend direction, prerequisites, certifications, and more
- Full **TypeScript types** with strict mode

## At a glance

| Metric | Count |
|--------|-------|
| Canonical skills | 14,774 |
| Aliases | ~175,000+ |
| Industries | ~2,100+ |
| Categories | ~7,600+ |
| Metadata fields per skill | 30+ |
| Aho-Corasick search complexity | O(text length) |

## Install

```bash
npm install skill-taxonomy
```

## Quick start

### Extract skills from text (recommended)

```typescript
import { taxonomy, buildTaxonomyAutomaton } from 'skill-taxonomy';

// Build the automaton once at startup (~150ms for 14K+ patterns)
const automaton = buildTaxonomyAutomaton(taxonomy);

// Extract all skills from any text — resumes, job descriptions, profiles
const skills = automaton.extractSkills(
  'Senior Python developer with 5 years of experience in React, ' +
  'AWS Lambda, and CI/CD pipelines. Proficient in k8s and Docker.'
);

console.log(skills);
// Set { 'python', 'react', 'aws lambda', 'ci/cd', 'kubernetes', 'docker' }
// Note: "k8s" was resolved to its canonical form "kubernetes"
```

### Count skill occurrences

```typescript
const counts = automaton.countOccurrences(resumeText);
// Map { 'python' => 4, 'react' => 2, 'docker' => 1 }
```

### Get detailed match positions

```typescript
const matches = automaton.search('Python and Django developer');
// [
//   { pattern: 'python', canonical: 'python', position: 0, length: 6 },
//   { pattern: 'django', canonical: 'django', position: 11, length: 6 }
// ]
```

### Single-term lookup (no automaton needed)

```typescript
import { AhoCorasickAutomaton } from 'skill-taxonomy';

// Quick check if a specific skill appears in text
AhoCorasickAutomaton.containsTerm('experienced Python developer', 'python');
// true — case-insensitive, word-boundary-aware

AhoCorasickAutomaton.containsTerm('pythonic code style', 'python');
// false — "python" is a substring of "pythonic", not a word boundary match
```

### Browse the taxonomy

```typescript
import {
  taxonomy,
  skillTaxonomyMap,
  buildReverseLookup,
  buildCanonicalSet,
  getStats,
} from 'skill-taxonomy';

// Flat view: canonical to aliases[]
console.log(taxonomy['python']); // ["py", "python3", "python 3", ...]

// Full metadata view
const python = skillTaxonomyMap['python'];
console.log(python.category);       // "programming language"
console.log(python.industries);     // ["technology", "finance", ...]
console.log(python.demandLevel);    // "high"
console.log(python.trendDirection); // "growing"

// Reverse lookup: alias to canonical
const lookup = buildReverseLookup(taxonomy);
console.log(lookup.get('k8s'));     // "kubernetes"
console.log(lookup.get('reactjs')); // "react"

// Stats
console.log(getStats(taxonomy));
// { canonicals: 14774, aliases: 175000+, total: 190000+ }
```

## API Reference

### Aho-Corasick Automaton

| Export | Description |
|--------|-------------|
| `buildTaxonomyAutomaton(t)` | One-call factory: taxonomy in, ready automaton out |
| `buildAutomaton(reverseLookup)` | Build automaton from a pre-computed reverse lookup map |
| `new AhoCorasickAutomaton(patterns)` | Build automaton from any `Map<pattern, canonical>` |

#### Instance methods

| Method | Returns | Description |
|--------|---------|-------------|
| `search(text)` | `AhoCorasickMatch[]` | All matches with position, pattern, and canonical |
| `extractSkills(text)` | `Set<string>` | Unique canonical skill names found |
| `countOccurrences(text)` | `Map<string, number>` | Frequency count per canonical |
| `size` | `number` | Number of patterns in the automaton |

#### Static methods (no automaton needed)

| Method | Description |
|--------|-------------|
| `AhoCorasickAutomaton.containsTerm(text, term)` | Word-boundary-aware term check (case-insensitive) |
| `AhoCorasickAutomaton.containsTermLower(text, term)` | Same, but expects pre-lowercased inputs (hot path) |
| `AhoCorasickAutomaton.countTerm(text, term)` | Count term occurrences with word boundaries |
| `AhoCorasickAutomaton.countTermLower(text, term)` | Same, pre-lowercased inputs |

### Taxonomy Data

| Export | Type | Description |
|--------|------|-------------|
| `taxonomy` | `SkillTaxonomy` | Frozen `Record<canonical, aliases[]>` |
| `skillTaxonomyMap` | `SkillTaxonomyMap` | Full `Record<canonical, SkillEntry>` with 30+ metadata fields |
| `buildReverseLookup(t)` | `Map<string, string>` | Every alias and canonical (lowercased) to its canonical |
| `buildCanonicalSet(t)` | `Set<string>` | All lowercase canonical names |
| `getStats(t)` | `TaxonomyStats` | Counts of canonicals, aliases, and total |

## How the Aho-Corasick automaton works

The [Aho-Corasick algorithm](https://en.wikipedia.org/wiki/Aho%E2%80%93Corasick_algorithm) is a multi-pattern string matching algorithm that finds all occurrences of a set of patterns in a text in a single pass:

1. **Build a trie** from all 175K+ patterns (aliases + canonicals)
2. **Compute failure links** via BFS — when a partial match fails, the automaton falls back to the longest matching suffix
3. **Scan the text once** — O(text_length), regardless of how many patterns exist
4. **Enforce word boundaries** — matches are only reported at `\b` boundaries, preventing false positives like "java" inside "javascript"

This replaces what would otherwise require 50K+ individual regex compilations.

### Performance characteristics

| Operation | Complexity | Typical time |
|-----------|-----------|--------------|
| Build automaton (14K patterns) | O(patterns x avg_length) | ~150ms |
| Search text | O(text_length + matches) | <10ms for 10KB |
| `containsTerm` (single term) | O(text_length) | <1ms |

## SkillEntry fields

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

## TypeScript types

```typescript
import type {
  SkillEntry,
  SkillTaxonomyMap,
  SkillTaxonomy,
  TaxonomyStats,
  AhoCorasickMatch,
} from 'skill-taxonomy';
```

## Data pipeline

The taxonomy is built through a multi-stage ingestion and validation pipeline:

```
ESCO API  --+
O*NET       |
StackOverflow+---> merge all ---> deduplicate ---> validate:llm ---> skill-taxonomy.json
Lightcast   |
LinkedIn    |
Verticals --+
```

### Pipeline scripts

All scripts use `--apply` flag for dry run by default.

```bash
pnpm run fetch:api             # ESCO skills via API
pnpm run import:lightcast      # Lightcast/EMSI skills
pnpm run import:linkedin       # LinkedIn skills
pnpm run import:verticals      # Healthcare, finance, legal, etc.
pnpm run merge:all             # Combine all imported skills
pnpm run deduplicate           # Remove duplicates, merge aliases
pnpm run validate:llm          # Process with Gemini Flash (requires GEMINI_API_KEY)
pnpm run validate              # Check for orphans, missing fields, etc.
```

## GraphQL API

The taxonomy can be queried through a Neo4j-backed GraphQL API with graph traversals, fuzzy search, and filtering. See [api/README.md](api/README.md) for setup and usage.

## Testing

92 tests across 2 test suites:

```bash
pnpm test       # Run all tests
pnpm test:watch # Watch mode
```

**Aho-Corasick test coverage** (79 tests):
- Construction and basic properties
- Single/multi-pattern matching
- Alias-to-canonical deduplication
- Word boundary enforcement (adversarial)
- Unicode and special characters (adversarial)
- Overlapping patterns and failure links
- Static helper methods
- Security: input bombs and malicious patterns
- Real taxonomy integration

## Development

```bash
pnpm install     # Install dependencies
pnpm build       # Compile TypeScript
pnpm test        # Run tests
pnpm test:watch  # Watch mode
```

## Project structure

```
src/
  index.ts                     # Main exports + buildTaxonomyAutomaton convenience factory
  aho-corasick.ts              # Aho-Corasick automaton (pure TypeScript, zero dependencies)
  skill-taxonomy.json          # The canonical taxonomy data (14,774 skills)
  types/
    taxonomy.types.ts          # SkillEntry, SkillTaxonomyMap, SkillTaxonomy types
    index.ts                   # Type barrel export

scripts/                       # Data ingestion pipeline (not published to npm)
api/                           # Neo4j + GraphQL API (see api/README.md)
tests/                         # Vitest test suites
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding skills to the taxonomy.

## Community

This package is extracted from [LLM Conveyors](https://llmconveyors.com), an AI-powered career toolkit that uses this taxonomy for ATS resume scoring, job matching, and skill gap analysis. We open-sourced the taxonomy and matching engine so the broader HR-tech and developer community can build on the same foundation.

If you're building something with this package, we'd love to hear about it — open an issue or start a discussion!

## License

MIT
