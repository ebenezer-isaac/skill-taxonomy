/**
 * Master taxonomy merge script.
 *
 * Orchestrates the complete taxonomy expansion pipeline:
 * 1. Load base taxonomy
 * 2. Import from all configured sources (API-fetched data)
 * 3. Deduplicate and resolve conflicts
 * 4. Validate and save final taxonomy
 *
 * Sources:
 * - ESCO (European Skills/Competences) via API
 * - O*NET (US Department of Labor) hot technologies
 * - Stack Overflow popular tags via API
 * - Lightcast Open Skills API
 * - Industry Verticals (curated)
 *
 * Usage:
 *   tsx scripts/merge-all.ts                       # dry run
 *   tsx scripts/merge-all.ts --apply               # write final taxonomy
 *   tsx scripts/merge-all.ts --source esco,onet    # specific sources only
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  loadTaxonomy,
  saveTaxonomy,
  buildKnownTerms,
  mergeCandidates,
  normalize,
  shouldApply,
  type CandidateEntry,
} from './common';

const DATA_DIR = path.join(__dirname, 'data');

// CLI arguments
const SOURCES_ARG = process.argv.find((a) => a.startsWith('--source='))?.split('=')[1];
const ENABLED_SOURCES = SOURCES_ARG
  ? new Set(SOURCES_ARG.split(',').map((s) => s.trim().toLowerCase()))
  : null; // null = all sources

const VERBOSE = process.argv.includes('--verbose');

/** Source configuration */
interface SourceConfig {
  name: string;
  key: string;
  dataFile?: string;
  enabled: boolean;
  candidates: CandidateEntry[];
}

/** Statistics tracker */
interface MergeStats {
  sourceStats: Record<string, { candidates: number; added: number; aliasesExpanded: number }>;
  totalCandidates: number;
  totalAdded: number;
  totalAliasesExpanded: number;
  conflicts: number;
  finalCanonicals: number;
  finalAliases: number;
}

/** Load curated vertical skills from import-verticals-enhanced output */
function loadVerticalCandidates(): CandidateEntry[] {
  const jsonFile = path.join(DATA_DIR, 'verticals', 'candidates.json');

  if (!fs.existsSync(jsonFile)) {
    console.log('  [verticals] No data found. Run: pnpm import:verticals --apply');
    return [];
  }

  try {
    const content = fs.readFileSync(jsonFile, 'utf-8');
    return JSON.parse(content) as CandidateEntry[];
  } catch (error) {
    console.log(`  [verticals] Error loading data: ${error}`);
    return [];
  }
}

/** Load Lightcast mock data (for when API is unavailable) */
function loadLightcastCandidates(): CandidateEntry[] {
  const cacheFile = path.join(DATA_DIR, 'lightcast', 'skills-cache.json');

  if (fs.existsSync(cacheFile)) {
    try {
      const content = fs.readFileSync(cacheFile, 'utf-8');
      const cached = JSON.parse(content);
      return cached.skills.map((skill: { name: string; type?: { name: string }; category?: { name: string } }) => ({
        canonical: normalize(skill.name),
        aliases: [],
        source: 'lightcast' as const,
        category: [skill.type?.name, skill.category?.name].filter(Boolean).join('/'),
      }));
    } catch {
      // Fall through to mock data
    }
  }
  
  // Mock data if no cache
  const mockSkills = [
    'Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP',
    'React', 'Angular', 'Vue.js', 'Node.js', 'Django', 'Flask', 'Spring Boot',
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch',
    'Amazon Web Services', 'Microsoft Azure', 'Google Cloud Platform',
    'Kubernetes', 'Docker', 'Terraform', 'Ansible',
    'Machine Learning', 'Deep Learning', 'Natural Language Processing',
    'TensorFlow', 'PyTorch', 'Scikit-learn',
    'Project Management', 'Agile Methodology', 'Scrum',
    'Communication', 'Leadership', 'Problem Solving',
  ];
  
  return mockSkills.map((skill) => ({
    canonical: normalize(skill),
    aliases: [],
    source: 'lightcast' as const,
    category: 'mock-data',
  }));
}

/** Load ESCO skills from API-fetched data */
function loadESCOCandidates(): CandidateEntry[] {
  const jsonFile = path.join(DATA_DIR, 'esco', 'skills_api.json');
  
  if (!fs.existsSync(jsonFile)) {
    console.log('  [esco] No data found. Run: pnpm fetch:api --source=esco');
    return [];
  }
  
  try {
    const content = fs.readFileSync(jsonFile, 'utf-8');
    const skills = JSON.parse(content) as Array<{
      preferredLabel: string;
      altLabels: string[];
      skillType: string;
      reuseLevel: string;
    }>;
    
    return skills
      .filter(skill => skill.preferredLabel && skill.preferredLabel.length > 0)
      .map(skill => ({
        canonical: normalize(skill.preferredLabel),
        aliases: (skill.altLabels ?? []).map(normalize).filter(a => a.length > 0),
        source: 'esco' as const,
        category: skill.skillType ?? 'skill',
      }));
  } catch (error) {
    console.log(`  [esco] Error loading data: ${error}`);
    return [];
  }
}

/** Load O*NET hot technologies from API-fetched data */
function loadONETCandidates(): CandidateEntry[] {
  const jsonFile = path.join(DATA_DIR, 'onet', 'hot_technologies.json');
  const tsvFile = path.join(DATA_DIR, 'onet', 'Technology Skills.txt');
  
  // Try JSON first
  if (fs.existsSync(jsonFile)) {
    try {
      const content = fs.readFileSync(jsonFile, 'utf-8');
      const items = JSON.parse(content) as Array<{
        name: string;
        category: string;
        hotTechnology?: boolean;
        inDemand?: boolean;
      }>;

      return items.map(item => ({
        canonical: normalize(item.name),
        aliases: [],
        source: 'onet' as const,
        category: item.category,
      }));
    } catch {
      // Fall through to TSV
    }
  }
  
  // Try TSV file
  if (fs.existsSync(tsvFile)) {
    try {
      const content = fs.readFileSync(tsvFile, 'utf-8');
      const lines = content.split('\n').slice(1); // Skip header
      
      return lines
        .map((line): CandidateEntry | null => {
          const parts = line.split('\t');
          if (parts.length < 3) return null;
          const name = parts[2]?.trim();
          if (!name) return null;
          return {
            canonical: normalize(name),
            aliases: [] as string[],
            source: 'onet' as const,
            category: 'technology',
          };
        })
        .filter((c): c is CandidateEntry => c !== null);
    } catch {
      // Ignore
    }
  }
  
  console.log('  [onet] No data found. Run: pnpm fetch:api --source=onet');
  return [];
}

/** Load Stack Overflow popular tags from API-fetched data */
function loadStackOverflowCandidates(): CandidateEntry[] {
  const jsonFile = path.join(DATA_DIR, 'stackoverflow', 'popular_tags.json');
  
  if (!fs.existsSync(jsonFile)) {
    console.log('  [stackoverflow] No data found. Run: pnpm fetch:api --source=stackoverflow');
    return [];
  }
  
  try {
    const content = fs.readFileSync(jsonFile, 'utf-8');
    const tags = JSON.parse(content) as Array<{ name: string; count: number }>;
    
    // Filter to reasonable programming-related tags (exclude very generic ones)
    const genericTags = new Set([
      'string', 'list', 'function', 'class', 'object', 'array', 'arrays',
      'date', 'datetime', 'regex', 'loop', 'loops', 'if-statement',
      'sorting', 'file', 'json', 'xml', 'csv', 'image', 'forms',
      'api', 'http', 'post', 'get', 'ajax', 'rest', 'validation',
      'debugging', 'performance', 'optimization', 'algorithm',
      'unit-testing', 'testing', 'logging', 'exception', 'error-handling',
      'dictionary', 'dataframe', 'multithreading', 'asynchronous',
      'constructor', 'prototype', 'undefined', 'null', 'nan', 'void',
      'this', 'super', 'async', 'await', 'promise', 'callback',
    ]);
    
    return tags
      .filter(tag => !genericTags.has(tag.name.toLowerCase()) && tag.name.length > 1)
      .slice(0, 500) // Top 500 after filtering
      .map(tag => ({
        canonical: normalize(tag.name.replace(/-/g, ' ')),
        aliases: [normalize(tag.name)],
        source: 'stackoverflow' as const,
        category: 'popular-tag',
      }));
  } catch (error) {
    console.log(`  [stackoverflow] Error loading data: ${error}`);
    return [];
  }
}

/** Check if a source is enabled */
function isSourceEnabled(key: string): boolean {
  if (!ENABLED_SOURCES) return true;
  return ENABLED_SOURCES.has(key.toLowerCase());
}

/** Main merge function */
function runMerge(): MergeStats {
  console.log('[merge] Starting comprehensive taxonomy merge\n');
  
  // Initialize statistics
  const stats: MergeStats = {
    sourceStats: {},
    totalCandidates: 0,
    totalAdded: 0,
    totalAliasesExpanded: 0,
    conflicts: 0,
    finalCanonicals: 0,
    finalAliases: 0,
  };
  
  // Load base taxonomy
  const taxonomy = loadTaxonomy();
  const initialCanonicals = Object.keys(taxonomy).length;
  const initialAliases = Object.values(taxonomy).reduce((sum, entry) => sum + entry.aliases.length, 0);
  
  console.log(`[merge] Base taxonomy: ${initialCanonicals} canonicals, ${initialAliases} aliases\n`);
  
  // Configure sources
  const sources: SourceConfig[] = [
    {
      name: 'ESCO (European Skills)',
      key: 'esco',
      enabled: isSourceEnabled('esco'),
      candidates: loadESCOCandidates(),
    },
    {
      name: 'O*NET Hot Technologies',
      key: 'onet',
      enabled: isSourceEnabled('onet'),
      candidates: loadONETCandidates(),
    },
    {
      name: 'Stack Overflow Popular Tags',
      key: 'stackoverflow',
      enabled: isSourceEnabled('stackoverflow'),
      candidates: loadStackOverflowCandidates(),
    },
    {
      name: 'Industry Verticals',
      key: 'verticals',
      enabled: isSourceEnabled('verticals'),
      candidates: loadVerticalCandidates(),
    },
    {
      name: 'Lightcast Open Skills',
      key: 'lightcast',
      enabled: isSourceEnabled('lightcast'),
      candidates: loadLightcastCandidates(),
    },
  ];
  
  // Process each source
  for (const source of sources) {
    if (!source.enabled) {
      console.log(`[merge] Skipping ${source.name} (disabled)`);
      continue;
    }
    
    if (source.candidates.length === 0) {
      console.log(`[merge] Skipping ${source.name} (no candidates)`);
      continue;
    }
    
    console.log(`[merge] Processing ${source.name}: ${source.candidates.length} candidates`);
    
    const result = mergeCandidates(taxonomy, source.candidates);
    
    stats.sourceStats[source.key] = {
      candidates: source.candidates.length,
      added: result.added,
      aliasesExpanded: result.aliasesExpanded,
    };
    
    stats.totalCandidates += source.candidates.length;
    stats.totalAdded += result.added;
    stats.totalAliasesExpanded += result.aliasesExpanded;
    
    console.log(`  → Added: ${result.added} new entries, ${result.aliasesExpanded} aliases expanded`);
  }
  
  // Calculate final stats
  stats.finalCanonicals = Object.keys(taxonomy).length;
  stats.finalAliases = Object.values(taxonomy).reduce((sum, entry) => sum + entry.aliases.length, 0);
  
  // Save if applying
  if (shouldApply()) {
    saveTaxonomy(taxonomy);
    console.log(`\n[merge] Saved taxonomy with ${stats.finalCanonicals} canonicals, ${stats.finalAliases} aliases`);
  }
  
  return stats;
}

/** Print summary report */
function printSummary(stats: MergeStats): void {
  console.log('\n' + '='.repeat(60));
  console.log('TAXONOMY MERGE SUMMARY');
  console.log('='.repeat(60));
  
  console.log('\nBy Source:');
  for (const [key, data] of Object.entries(stats.sourceStats)) {
    console.log(`  ${key}:`);
    console.log(`    Candidates: ${data.candidates}`);
    console.log(`    Added: ${data.added}`);
    console.log(`    Aliases expanded: ${data.aliasesExpanded}`);
  }
  
  console.log('\nTotals:');
  console.log(`  Total candidates processed: ${stats.totalCandidates}`);
  console.log(`  New entries added: ${stats.totalAdded}`);
  console.log(`  Aliases expanded: ${stats.totalAliasesExpanded}`);
  console.log(`  Final canonicals: ${stats.finalCanonicals}`);
  console.log(`  Final aliases: ${stats.finalAliases}`);
  console.log(`  Total terms: ${stats.finalCanonicals + stats.finalAliases}`);
  
  console.log('\n' + '='.repeat(60));
  
  if (!shouldApply()) {
    console.log('\nDry run — use --apply to write changes');
  }
}

// Run
const stats = runMerge();
printSummary(stats);
