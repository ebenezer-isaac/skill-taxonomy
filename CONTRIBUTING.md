# Contributing to @llmconveyors/skill-taxonomy

Thanks for helping build a better skill taxonomy! This file explains how to add skills, fix aliases, and submit your contribution.

## How to Add a Skill

1. Fork this repo
2. Edit `src/skill-taxonomy.json`
3. Run `pnpm validate` to check your changes
4. Submit a PR

### Format

```json
{
  "canonical name": ["alias1", "alias2", "alias3"]
}
```

**Rules:**
- **Canonical name** = the most commonly used, industry-standard name (lowercase, trimmed)
- **Aliases** = abbreviations, alternative spellings, version names, or common misspellings found in job descriptions
- Aliases must be **unique across the entire file** — no alias can appear under two different canonicals
- Empty alias arrays `[]` are allowed (but PRs to fill them are welcome!)

### Examples

Good:
```json
"adobe experience manager": ["aem", "aem sites", "aem cloud", "cq5", "adobe cq"]
```

Bad:
```json
"AEM": ["Adobe Experience Manager"]  // canonical should be the full name, not the acronym
```

### What to Include as Aliases

- Abbreviations: `kubernetes` → `k8s`
- Common suffixes/prefixes: `react` → `reactjs`, `react.js`
- Version names: `python` → `python3`, `python2`
- Alternative spellings: `c#` → `csharp`, `c sharp`
- Product sub-variants: `adobe experience manager` → `aem sites`, `aem cloud`, `aem forms`

### What NOT to Include as Aliases

- Completely unrelated terms
- Aliases that are themselves canonical entries (e.g., don't add "python" as an alias of "django")
- Marketing names that nobody uses in JDs
- Overly specific version numbers (e.g., "react 18.2.0")

## How to Run Validation

```bash
pnpm install
pnpm validate    # checks JSON structure, duplicates, and formatting
pnpm test        # runs the full test suite
```

## Import Scripts

We have automated import scripts that pull from external sources. These generate additions that are reviewed before merging:

| Script | Source | Command |
|--------|--------|---------|
| ESCO EU Taxonomy | 13K+ European skills database | `pnpm import:esco` |
| O*NET | US Dept of Labor tech skills | `pnpm import:onet` |
| Stack Overflow Survey | Annual developer survey | `pnpm import:survey` |
| LinkedIn Skills | LinkedIn skill assessments | `pnpm import:linkedin` |
| Industry Verticals | Curated domain-specific lists | `pnpm import:verticals` |
| Alias Expansion | ESCO altLabels for existing entries | `pnpm expand:aliases` |

All scripts default to **dry run** (print suggestions only). Use `--apply` to write changes.

## PR Checklist

- [ ] `pnpm validate` passes with 0 errors
- [ ] `pnpm test` passes
- [ ] No duplicate aliases across entries
- [ ] Canonical names are lowercase and trimmed
- [ ] Aliases are commonly found in real job descriptions
