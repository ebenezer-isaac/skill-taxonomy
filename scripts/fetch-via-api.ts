/**
 * Fetch skill data via public APIs — DOMAIN-AGNOSTIC, no filters.
 *
 * Uses:
 * - ESCO REST API — walks full taxonomy tree (~13k skills, all industries)
 * - Stack Exchange API — tags from 20 SE sites (tech, finance, law, HR, etc.)
 * - O*NET Content Model — all skills, knowledge, work styles, work activities,
 *   and cross-industry tools & technology
 *
 * Usage:
 *   tsx scripts/fetch-via-api.ts                      # fetch all
 *   tsx scripts/fetch-via-api.ts --source esco         # ESCO only
 *   tsx scripts/fetch-via-api.ts --source esco --quick  # tree names only (no altLabels)
 *   tsx scripts/fetch-via-api.ts --source stackexchange
 *   tsx scripts/fetch-via-api.ts --source onet
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const DATA_ROOT = path.join(__dirname, 'data');
const SOURCE_FILTER = process.argv.find(a => a.startsWith('--source='))?.split('=')[1];
const VERBOSE = process.argv.includes('--verbose');

// Rate limiter
class RateLimiter {
  private lastRequest = 0;
  constructor(private minIntervalMs: number) {}
  async wait(): Promise<void> {
    const elapsed = Date.now() - this.lastRequest;
    if (elapsed < this.minIntervalMs) {
      await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastRequest = Date.now();
  }
}

// ==================== ESCO API ====================

interface ESCOSearchResult {
  _embedded?: {
    results: Array<{
      uri: string;
      title: string;
      className: string;
    }>;
  };
  total: number;
}

interface ESCOSkillDetail {
  uri: string;
  preferredLabel: string | Record<string, string>;
  altLabels?: string[] | Record<string, string[]>;
  description?: string | Record<string, { literal: string; mimetype: string }>;
  skillType?: string;
  skillReusability?: string;
  broaderConcepts?: Array<{ uri: string; title: string }>;
}

/**
 * Extract English label from ESCO multilingual field.
 */
function extractEnglishLabel(field: string | Record<string, string> | undefined): string {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field['en'] ?? field['en-us'] ?? Object.values(field)[0] ?? '';
}

/**
 * Extract English description from ESCO multilingual field.
 */
function extractEnglishDescription(field: string | Record<string, { literal: string; mimetype: string }> | undefined): string {
  if (!field) return '';
  if (typeof field === 'string') return field;
  const enDesc = field['en'] ?? field['en-us'] ?? Object.values(field)[0];
  if (!enDesc) return '';
  return typeof enDesc === 'string' ? enDesc : enDesc.literal ?? '';
}

/**
 * Extract English altLabels from ESCO multilingual field.
 */
function extractEnglishAltLabels(field: string[] | Record<string, string[]> | undefined): string[] {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  return field['en'] ?? field['en-us'] ?? [];
}

/**
 * Fetch the ENTIRE ESCO skill taxonomy by walking the concept tree.
 *
 * Phase 1 — discover all skill URIs via taxonomy tree walk (fast, ~200 API calls)
 * Phase 2 — fetch individual skill details for altLabels (slow, ~13k calls)
 *           Use --quick to skip Phase 2 and use names from tree walk only.
 *
 * Both phases support checkpoint / resume.
 */
async function fetchESCOSkills(): Promise<void> {
  console.log('\n[ESCO] Fetching FULL skill taxonomy via tree walk...');
  console.log('  Downloads the entire ESCO skill classification (~13,000 skills).');
  console.log('  Use --quick to skip fetching altLabels (much faster).\n');

  const outputDir = path.join(DATA_ROOT, 'esco');
  fs.mkdirSync(outputDir, { recursive: true });

  const baseUrl = 'https://ec.europa.eu/esco/api';
  const rateLimiter = new RateLimiter(200); // 5 req/sec
  const QUICK = process.argv.includes('--quick');

  // Checkpoint paths
  const treeCP = path.join(outputDir, 'tree-checkpoint.json');
  const detailCP = path.join(outputDir, 'detail-checkpoint.json');

  /** Rate-limited GET helper */
  async function escoGet<T = unknown>(url: string): Promise<T> {
    await rateLimiter.wait();
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'skill-taxonomy/2.0' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json() as Promise<T>;
  }

  // ---- Phase 1: Walk taxonomy tree to discover all skill URIs ----
  interface SkillStub { uri: string; title: string; groupPath: string }
  const stubs = new Map<string, SkillStub>();
  const doneGroups = new Set<string>();
  let treeComplete = false;

  // Resume from checkpoint
  if (fs.existsSync(treeCP)) {
    const cp = JSON.parse(fs.readFileSync(treeCP, 'utf-8'));
    for (const s of cp.skills ?? []) stubs.set(s.uri, s);
    for (const g of cp.doneGroups ?? []) doneGroups.add(g);
    treeComplete = cp.treeComplete ?? false;
    console.log(treeComplete
      ? `  Tree already complete: ${stubs.size} skills discovered`
      : `  Resuming tree walk: ${stubs.size} skills, ${doneGroups.size} groups`);
  }

  if (!treeComplete) {
    console.log('  Phase 1: Walking ESCO skill taxonomy tree...');
    const SCHEME = 'http://data.europa.eu/esco/concept-scheme/skills';
    const scheme = await escoGet<Record<string, unknown>>(
      `${baseUrl}/resource/taxonomy?uri=${encodeURIComponent(SCHEME)}&language=en`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topConcepts = (
      scheme.hasTopConcept ?? (scheme._links as any)?.hasTopConcept ?? []
    ) as Array<{ uri: string; title: string }>;
    console.log(`  Found ${topConcepts.length} top-level skill groups\n`);

    let groupCount = doneGroups.size;

    const saveTreeCheckpoint = (): void => {
      fs.writeFileSync(treeCP, JSON.stringify({
        skills: Array.from(stubs.values()),
        doneGroups: Array.from(doneGroups),
        treeComplete: false,
        ts: new Date().toISOString(),
      }));
    };

    async function walkGroup(uri: string, depth: number, pathStr: string): Promise<void> {
      if (doneGroups.has(uri)) return;
      try {
        const concept = await escoGet<Record<string, unknown>>(
          `${baseUrl}/resource/concept?uri=${encodeURIComponent(uri)}&language=en`,
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const label = extractEnglishLabel(concept.preferredLabel as any);
        const curPath = pathStr ? `${pathStr} > ${label}` : label;
        doneGroups.add(uri);
        groupCount++;

        // Collect narrower skills (leaf skills under this group)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const narrowerSkills = (
          (concept._links as any)?.narrowerSkill ?? concept.narrowerSkill ?? []
        ) as Array<{ uri: string; title: string }>;

        if (narrowerSkills.length > 0) {
          const indent = '  '.repeat(Math.min(depth + 1, 6));
          console.log(`${indent}📁 ${label}: ${narrowerSkills.length} skills`);
          for (const s of narrowerSkills) {
            if (!stubs.has(s.uri)) {
              stubs.set(s.uri, { uri: s.uri, title: s.title ?? '', groupPath: curPath });
            }
          }
        } else if (VERBOSE) {
          const indent = '  '.repeat(Math.min(depth + 1, 6));
          console.log(`${indent}📁 ${label} (group only)`);
        }

        // Recurse into narrower concept groups
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const narrowerConcepts = (
          (concept._links as any)?.narrowerConcept ?? concept.narrowerConcept ?? []
        ) as Array<{ uri: string; title: string }>;

        for (const sub of narrowerConcepts) {
          await walkGroup(sub.uri, depth + 1, curPath);
        }

        // Checkpoint every 25 groups
        if (groupCount % 25 === 0) {
          saveTreeCheckpoint();
          console.log(`  💾 Checkpoint: ${groupCount} groups, ${stubs.size} skills`);
        }
      } catch (err) {
        console.log(`  ⚠️ Error on group ${uri}: ${err}`);
      }
    }

    for (const top of topConcepts) {
      console.log(`\n  🔍 Walking: ${top.title ?? top.uri}`);
      await walkGroup(top.uri, 0, '');
    }

    treeComplete = true;
    fs.writeFileSync(treeCP, JSON.stringify({
      skills: Array.from(stubs.values()),
      doneGroups: Array.from(doneGroups),
      treeComplete: true,
      ts: new Date().toISOString(),
    }));
    console.log(`\n  ✅ Tree complete: ${stubs.size} skill URIs from ${doneGroups.size} groups`);
  }

  // ---- Phase 2: Fetch individual skill details (altLabels, description) ----
  interface SkillRecord {
    uri: string;
    preferredLabel: string;
    altLabels: string[];
    description: string;
    skillType: string;
    reuseLevel: string;
  }
  const skills: SkillRecord[] = [];

  if (QUICK) {
    console.log('\n  Phase 2 (QUICK): Using names from tree walk — no altLabels.');
    for (const stub of stubs.values()) {
      if (stub.title) {
        skills.push({
          uri: stub.uri,
          preferredLabel: stub.title,
          altLabels: [],
          description: '',
          skillType: 'skill/competence',
          reuseLevel: '',
        });
      }
    }
  } else {
    console.log(`\n  Phase 2: Fetching details for ${stubs.size} skills (this may take a while)...`);
    console.log('  Use --quick to skip this. Supports resume via checkpoint.\n');

    const fetched = new Set<string>();
    if (fs.existsSync(detailCP)) {
      const cp = JSON.parse(fs.readFileSync(detailCP, 'utf-8'));
      for (const s of cp.skills ?? []) { skills.push(s); fetched.add(s.uri); }
      console.log(`  Resuming: ${skills.length} details already fetched`);
    }

    let count = 0;
    const remaining = stubs.size - fetched.size;

    for (const [uri, stub] of stubs) {
      if (fetched.has(uri)) continue;
      count++;

      if (count % 200 === 0) {
        console.log(`    ${count}/${remaining} details fetched...`);
        fs.writeFileSync(detailCP, JSON.stringify({ skills, ts: new Date().toISOString() }));
      }

      try {
        const detail = await escoGet<ESCOSkillDetail>(
          `${baseUrl}/resource/skill?uri=${encodeURIComponent(uri)}&language=en`,
        );
        const label = extractEnglishLabel(detail.preferredLabel);
        if (label) {
          skills.push({
            uri,
            preferredLabel: label,
            altLabels: extractEnglishAltLabels(detail.altLabels),
            description: extractEnglishDescription(detail.description),
            skillType: detail.skillType ?? 'skill/competence',
            reuseLevel: detail.skillReusability ?? 'transversal',
          });
        }
      } catch {
        // Fallback to stub title
        if (stub.title) {
          skills.push({
            uri,
            preferredLabel: stub.title,
            altLabels: [],
            description: '',
            skillType: 'skill/competence',
            reuseLevel: '',
          });
        }
      }
    }
  }

  // Save results
  const outputPath = path.join(outputDir, 'skills_api.json');
  fs.writeFileSync(outputPath, JSON.stringify(skills, null, 2));
  console.log(`\n[ESCO] ✅ Saved ${skills.length} skills to ${outputPath}`);

  // Clean up checkpoints on success
  for (const cp of [treeCP, detailCP]) {
    if (fs.existsSync(cp)) fs.unlinkSync(cp);
  }

  // CSV export
  const csvLines = ['conceptUri,preferredLabel,altLabels,skillType,reuseLevel,description'];
  for (const skill of skills) {
    const label = skill.preferredLabel ?? '';
    const alts = (skill.altLabels ?? []).join('\n');
    const desc = skill.description ?? '';
    csvLines.push([
      skill.uri,
      `"${label.replace(/"/g, '""')}"`,
      `"${alts.replace(/"/g, '""')}"`,
      skill.skillType ?? '',
      skill.reuseLevel ?? '',
      `"${desc.replace(/"/g, '""').substring(0, 200)}"`,
    ].join(','));
  }

  const csvPath = path.join(outputDir, 'skills_en.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  console.log(`[ESCO] ✅ Saved CSV to ${csvPath}`);
}

// ==================== Stack Exchange API ====================

interface StackExchangeTagsResponse {
  items: Array<{
    name: string;
    count: number;
    is_required: boolean;
    is_moderator_only: boolean;
    has_synonyms: boolean;
  }>;
  has_more: boolean;
  quota_max: number;
  quota_remaining: number;
}

/**
 * Fetch tags from MULTIPLE Stack Exchange sites — not just Stack Overflow.
 * This gives us tech tags (SO) plus professional, finance, legal, etc.
 */
const STACK_EXCHANGE_SITES = [
  { site: 'stackoverflow',          label: 'Stack Overflow',      pages: 10 }, // tech
  { site: 'serverfault',            label: 'Server Fault',        pages: 5 },  // sysadmin
  { site: 'superuser',              label: 'Super User',          pages: 3 },  // power-user tools
  { site: 'workplace',              label: 'Workplace',           pages: 5 },  // professional skills
  { site: 'money',                  label: 'Personal Finance',    pages: 3 },  // finance
  { site: 'law',                    label: 'Law',                 pages: 3 },  // legal
  { site: 'engineering',            label: 'Engineering',         pages: 3 },  // engineering
  { site: 'academia',               label: 'Academia',            pages: 3 },  // education/research
  { site: 'dba',                    label: 'DBA',                 pages: 3 },  // database admin
  { site: 'gis',                    label: 'GIS',                 pages: 3 },  // geospatial
  { site: 'stats',                  label: 'Cross Validated',     pages: 3 },  // statistics/ML
  { site: 'ux',                     label: 'UX',                  pages: 3 },  // design
  { site: 'pm',                     label: 'Project Management',  pages: 3 },  // PM
  { site: 'quant',                  label: 'Quantitative Finance', pages: 3 }, // quant finance
  { site: 'datascience',            label: 'Data Science',        pages: 3 },  // DS
  { site: 'devops',                 label: 'DevOps',              pages: 3 },  // devops
  { site: 'sqa',                    label: 'QA/Testing',          pages: 3 },  // QA
  { site: 'salesforce',             label: 'Salesforce',          pages: 3 },  // CRM
  { site: 'economics',              label: 'Economics',           pages: 3 },  // economics
  { site: 'health',                 label: 'Health',              pages: 3 },  // health
];

async function fetchStackExchangeTags(): Promise<void> {
  console.log('\n[StackExchange] Fetching tags from MULTIPLE Stack Exchange sites...');

  const outputDir = path.join(DATA_ROOT, 'stackoverflow');
  fs.mkdirSync(outputDir, { recursive: true });

  const rateLimiter = new RateLimiter(100); // 10 req/s max
  const baseUrl = 'https://api.stackexchange.com/2.3';

  const allTags: Array<{ name: string; count: number; site: string }> = [];

  for (const siteConfig of STACK_EXCHANGE_SITES) {
    console.log(`\n  📡 ${siteConfig.label} (${siteConfig.site})...`);
    let page = 1;
    let hasMore = true;
    let siteTags = 0;

    while (hasMore && page <= siteConfig.pages) {
      await rateLimiter.wait();

      try {
        const url = `${baseUrl}/tags?page=${page}&pagesize=100&order=desc&sort=popular&site=${siteConfig.site}`;
        const response = await fetch(url, {
          headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip' },
        });

        if (!response.ok) {
          console.log(`    ⚠️ API error: ${response.status}`);
          break;
        }

        const data = await response.json() as StackExchangeTagsResponse;

        for (const tag of data.items) {
          allTags.push({ name: tag.name, count: tag.count, site: siteConfig.site });
          siteTags++;
        }

        if (VERBOSE) {
          console.log(`    page ${page}: ${data.items.length} tags (quota: ${data.quota_remaining}/${data.quota_max})`);
        }

        hasMore = data.has_more;
        page++;

        if (data.quota_remaining < 30) {
          console.log('    ⚠️ Low quota, pausing SE fetches');
          hasMore = false;
        }
      } catch (error) {
        console.log(`    ⚠️ Error: ${error}`);
        break;
      }
    }

    console.log(`    ✅ ${siteTags} tags`);
  }

  // Save everything
  const tagsPath = path.join(outputDir, 'popular_tags.json');
  fs.writeFileSync(tagsPath, JSON.stringify(allTags, null, 2));
  console.log(`\n[StackExchange] ✅ Saved ${allTags.length} tags from ${STACK_EXCHANGE_SITES.length} sites to ${tagsPath}`);

  // Summary by site
  const bySite = new Map<string, number>();
  for (const t of allTags) bySite.set(t.site, (bySite.get(t.site) ?? 0) + 1);
  for (const [site, count] of [...bySite.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${count.toString().padStart(5)} ${site}`);
  }
}

// ==================== O*NET Content Model ====================

/**
 * Complete O*NET Content Model — ALL skills, knowledge, abilities,
 * work styles, and cross-industry tools.
 *
 * Source: https://www.onetcenter.org/content.html
 * These are universal across ALL 900+ O*NET occupations.
 */

type OnetItem = { name: string; category: string };

/** All 35 O*NET Basic + Cross-Functional Skills */
const ONET_SKILLS: OnetItem[] = [
  // Basic Skills
  { name: 'Active Learning', category: 'Basic Skill' },
  { name: 'Active Listening', category: 'Basic Skill' },
  { name: 'Critical Thinking', category: 'Basic Skill' },
  { name: 'Learning Strategies', category: 'Basic Skill' },
  { name: 'Mathematics', category: 'Basic Skill' },
  { name: 'Monitoring', category: 'Basic Skill' },
  { name: 'Reading Comprehension', category: 'Basic Skill' },
  { name: 'Science', category: 'Basic Skill' },
  { name: 'Speaking', category: 'Basic Skill' },
  { name: 'Writing', category: 'Basic Skill' },
  // Social Skills
  { name: 'Coordination', category: 'Social Skill' },
  { name: 'Instructing', category: 'Social Skill' },
  { name: 'Negotiation', category: 'Social Skill' },
  { name: 'Persuasion', category: 'Social Skill' },
  { name: 'Service Orientation', category: 'Social Skill' },
  { name: 'Social Perceptiveness', category: 'Social Skill' },
  // Complex Problem Solving
  { name: 'Complex Problem Solving', category: 'Problem Solving' },
  // Technical Skills
  { name: 'Equipment Maintenance', category: 'Technical Skill' },
  { name: 'Equipment Selection', category: 'Technical Skill' },
  { name: 'Installation', category: 'Technical Skill' },
  { name: 'Operation Monitoring', category: 'Technical Skill' },
  { name: 'Operation and Control', category: 'Technical Skill' },
  { name: 'Operations Analysis', category: 'Technical Skill' },
  { name: 'Programming', category: 'Technical Skill' },
  { name: 'Quality Control Analysis', category: 'Technical Skill' },
  { name: 'Repairing', category: 'Technical Skill' },
  { name: 'Technology Design', category: 'Technical Skill' },
  { name: 'Troubleshooting', category: 'Technical Skill' },
  // Systems Skills
  { name: 'Judgment and Decision Making', category: 'Systems Skill' },
  { name: 'Systems Analysis', category: 'Systems Skill' },
  { name: 'Systems Evaluation', category: 'Systems Skill' },
  // Resource Management Skills
  { name: 'Management of Financial Resources', category: 'Resource Management' },
  { name: 'Management of Material Resources', category: 'Resource Management' },
  { name: 'Management of Personnel Resources', category: 'Resource Management' },
  { name: 'Time Management', category: 'Resource Management' },
];

/** All 33 O*NET Knowledge Areas */
const ONET_KNOWLEDGE: OnetItem[] = [
  { name: 'Administration and Management', category: 'Knowledge - Business' },
  { name: 'Biology', category: 'Knowledge - Science' },
  { name: 'Building and Construction', category: 'Knowledge - Engineering' },
  { name: 'Chemistry', category: 'Knowledge - Science' },
  { name: 'Clerical', category: 'Knowledge - Business' },
  { name: 'Communications and Media', category: 'Knowledge - Arts/Humanities' },
  { name: 'Computers and Electronics', category: 'Knowledge - Technology' },
  { name: 'Customer and Personal Service', category: 'Knowledge - Business' },
  { name: 'Design', category: 'Knowledge - Arts/Humanities' },
  { name: 'Economics and Accounting', category: 'Knowledge - Business' },
  { name: 'Education and Training', category: 'Knowledge - Education' },
  { name: 'Engineering and Technology', category: 'Knowledge - Engineering' },
  { name: 'English Language', category: 'Knowledge - Arts/Humanities' },
  { name: 'Fine Arts', category: 'Knowledge - Arts/Humanities' },
  { name: 'Food Production', category: 'Knowledge - Manufacturing' },
  { name: 'Foreign Language', category: 'Knowledge - Arts/Humanities' },
  { name: 'Geography', category: 'Knowledge - Science' },
  { name: 'History and Archeology', category: 'Knowledge - Arts/Humanities' },
  { name: 'Law and Government', category: 'Knowledge - Law' },
  { name: 'Mathematics', category: 'Knowledge - Science' },
  { name: 'Mechanical', category: 'Knowledge - Engineering' },
  { name: 'Medicine and Dentistry', category: 'Knowledge - Health' },
  { name: 'Personnel and Human Resources', category: 'Knowledge - Business' },
  { name: 'Philosophy and Theology', category: 'Knowledge - Arts/Humanities' },
  { name: 'Physics', category: 'Knowledge - Science' },
  { name: 'Production and Processing', category: 'Knowledge - Manufacturing' },
  { name: 'Psychology', category: 'Knowledge - Science' },
  { name: 'Public Safety and Security', category: 'Knowledge - Law' },
  { name: 'Sales and Marketing', category: 'Knowledge - Business' },
  { name: 'Sociology and Anthropology', category: 'Knowledge - Science' },
  { name: 'Telecommunications', category: 'Knowledge - Technology' },
  { name: 'Therapy and Counseling', category: 'Knowledge - Health' },
  { name: 'Transportation', category: 'Knowledge - Transportation' },
];

/** O*NET Work Styles (soft-skill traits) */
const ONET_WORK_STYLES: OnetItem[] = [
  { name: 'Achievement/Effort', category: 'Work Style' },
  { name: 'Adaptability/Flexibility', category: 'Work Style' },
  { name: 'Analytical Thinking', category: 'Work Style' },
  { name: 'Attention to Detail', category: 'Work Style' },
  { name: 'Concern for Others', category: 'Work Style' },
  { name: 'Cooperation', category: 'Work Style' },
  { name: 'Dependability', category: 'Work Style' },
  { name: 'Independence', category: 'Work Style' },
  { name: 'Initiative', category: 'Work Style' },
  { name: 'Innovation', category: 'Work Style' },
  { name: 'Integrity', category: 'Work Style' },
  { name: 'Leadership', category: 'Work Style' },
  { name: 'Persistence', category: 'Work Style' },
  { name: 'Self-Control', category: 'Work Style' },
  { name: 'Social Orientation', category: 'Work Style' },
  { name: 'Stress Tolerance', category: 'Work Style' },
];

/** O*NET Work Activities (cross-industry competencies) */
const ONET_WORK_ACTIVITIES: OnetItem[] = [
  { name: 'Analyzing Data or Information', category: 'Work Activity - Information' },
  { name: 'Communicating with People Outside the Organization', category: 'Work Activity - Communication' },
  { name: 'Communicating with Supervisors, Peers, or Subordinates', category: 'Work Activity - Communication' },
  { name: 'Coaching and Developing Others', category: 'Work Activity - People' },
  { name: 'Controlling Machines and Processes', category: 'Work Activity - Things' },
  { name: 'Coordinating the Work and Activities of Others', category: 'Work Activity - People' },
  { name: 'Developing and Building Teams', category: 'Work Activity - People' },
  { name: 'Developing Objectives and Strategies', category: 'Work Activity - Mental' },
  { name: 'Documenting/Recording Information', category: 'Work Activity - Information' },
  { name: 'Establishing and Maintaining Interpersonal Relationships', category: 'Work Activity - Communication' },
  { name: 'Evaluating Information to Determine Compliance with Standards', category: 'Work Activity - Information' },
  { name: 'Getting Information', category: 'Work Activity - Information' },
  { name: 'Guiding, Directing, and Motivating Subordinates', category: 'Work Activity - People' },
  { name: 'Handling and Moving Objects', category: 'Work Activity - Things' },
  { name: 'Identifying Objects, Actions, and Events', category: 'Work Activity - Information' },
  { name: 'Inspecting Equipment, Structures, or Materials', category: 'Work Activity - Things' },
  { name: 'Interacting With Computers', category: 'Work Activity - Technology' },
  { name: 'Interpreting the Meaning of Information for Others', category: 'Work Activity - Communication' },
  { name: 'Judging the Qualities of Objects, Services, or People', category: 'Work Activity - Mental' },
  { name: 'Making Decisions and Solving Problems', category: 'Work Activity - Mental' },
  { name: 'Monitor Processes, Materials, or Surroundings', category: 'Work Activity - Information' },
  { name: 'Operating Vehicles, Mechanized Devices, or Equipment', category: 'Work Activity - Things' },
  { name: 'Organizing, Planning, and Prioritizing Work', category: 'Work Activity - Mental' },
  { name: 'Performing Administrative Activities', category: 'Work Activity - Business' },
  { name: 'Performing for or Working Directly with the Public', category: 'Work Activity - Communication' },
  { name: 'Performing General Physical Activities', category: 'Work Activity - Physical' },
  { name: 'Processing Information', category: 'Work Activity - Information' },
  { name: 'Provide Consultation and Advice to Others', category: 'Work Activity - Communication' },
  { name: 'Repairing and Maintaining Electronic Equipment', category: 'Work Activity - Things' },
  { name: 'Repairing and Maintaining Mechanical Equipment', category: 'Work Activity - Things' },
  { name: 'Resolving Conflicts and Negotiating with Others', category: 'Work Activity - Communication' },
  { name: 'Scheduling Work and Activities', category: 'Work Activity - Mental' },
  { name: 'Selling or Influencing Others', category: 'Work Activity - Communication' },
  { name: 'Staffing Organizational Units', category: 'Work Activity - People' },
  { name: 'Thinking Creatively', category: 'Work Activity - Mental' },
  { name: 'Training and Teaching Others', category: 'Work Activity - People' },
  { name: 'Updating and Using Relevant Knowledge', category: 'Work Activity - Information' },
];

/** Cross-industry tools & technology (not just IT) */
const ONET_CROSS_INDUSTRY_TOOLS: OnetItem[] = [
  // --- IT (keep the originals) ---
  { name: 'Python', category: 'Programming Language' },
  { name: 'Java', category: 'Programming Language' },
  { name: 'JavaScript', category: 'Programming Language' },
  { name: 'SQL', category: 'Database Language' },
  { name: 'Amazon Web Services (AWS)', category: 'Cloud Platform' },
  { name: 'Microsoft Azure', category: 'Cloud Platform' },
  { name: 'Google Cloud Platform', category: 'Cloud Platform' },
  { name: 'Docker', category: 'Containerization' },
  { name: 'Kubernetes', category: 'Container Orchestration' },
  { name: 'React', category: 'Frontend Framework' },
  { name: 'Node.js', category: 'Runtime' },
  { name: 'Git', category: 'Version Control' },
  { name: 'Salesforce', category: 'CRM' },
  { name: 'SAP', category: 'ERP' },
  { name: 'ServiceNow', category: 'ITSM' },

  // --- Office / Productivity ---
  { name: 'Microsoft Office', category: 'Productivity Suite' },
  { name: 'Microsoft Excel', category: 'Spreadsheet' },
  { name: 'Microsoft Word', category: 'Word Processing' },
  { name: 'Microsoft PowerPoint', category: 'Presentation' },
  { name: 'Microsoft Outlook', category: 'Email Client' },
  { name: 'Microsoft Teams', category: 'Collaboration' },
  { name: 'Google Workspace', category: 'Productivity Suite' },
  { name: 'Google Sheets', category: 'Spreadsheet' },
  { name: 'Slack', category: 'Collaboration' },
  { name: 'Zoom', category: 'Video Conferencing' },
  { name: 'SharePoint', category: 'Document Management' },

  // --- Healthcare ---
  { name: 'Epic Systems', category: 'Healthcare EHR' },
  { name: 'Cerner', category: 'Healthcare EHR' },
  { name: 'MEDITECH', category: 'Healthcare EHR' },
  { name: 'Allscripts', category: 'Healthcare EHR' },
  { name: 'McKesson', category: 'Healthcare/Pharma' },

  // --- Finance / Accounting ---
  { name: 'Bloomberg Terminal', category: 'Finance Platform' },
  { name: 'QuickBooks', category: 'Accounting Software' },
  { name: 'Sage', category: 'Accounting Software' },
  { name: 'Xero', category: 'Accounting Software' },
  { name: 'NetSuite', category: 'ERP/Accounting' },
  { name: 'FreshBooks', category: 'Accounting Software' },
  { name: 'ADP', category: 'Payroll/HR' },
  { name: 'Intuit TurboTax', category: 'Tax Software' },

  // --- HR ---
  { name: 'Workday', category: 'HCM Platform' },
  { name: 'BambooHR', category: 'HR Software' },
  { name: 'Greenhouse', category: 'Recruiting Software' },
  { name: 'Lever', category: 'Recruiting Software' },
  { name: 'iCIMS', category: 'Recruiting Software' },
  { name: 'UKG', category: 'HR/Workforce Management' },
  { name: 'Ceridian Dayforce', category: 'HCM Platform' },
  { name: 'Paychex', category: 'Payroll' },

  // --- Marketing ---
  { name: 'HubSpot', category: 'Marketing Platform' },
  { name: 'Mailchimp', category: 'Email Marketing' },
  { name: 'Google Ads', category: 'Digital Advertising' },
  { name: 'Google Analytics', category: 'Web Analytics' },
  { name: 'Meta Ads Manager', category: 'Digital Advertising' },
  { name: 'Marketo', category: 'Marketing Automation' },
  { name: 'Pardot', category: 'Marketing Automation' },
  { name: 'Hootsuite', category: 'Social Media Management' },
  { name: 'SEMrush', category: 'SEO Tool' },
  { name: 'Ahrefs', category: 'SEO Tool' },
  { name: 'Canva', category: 'Graphic Design' },
  { name: 'WordPress', category: 'CMS' },

  // --- Construction / Architecture / Engineering ---
  { name: 'AutoCAD', category: 'CAD Software' },
  { name: 'Revit', category: 'BIM Software' },
  { name: 'SolidWorks', category: 'CAD/CAE Software' },
  { name: 'CATIA', category: 'CAD/CAE Software' },
  { name: 'Autodesk Inventor', category: 'CAD Software' },
  { name: 'SketchUp', category: 'CAD Software' },
  { name: 'Rhino', category: 'CAD Software' },
  { name: 'Civil 3D', category: 'Civil Engineering Software' },
  { name: 'Primavera P6', category: 'Project Scheduling' },
  { name: 'Procore', category: 'Construction Management' },
  { name: 'Bluebeam', category: 'Construction Document' },
  { name: 'PlanGrid', category: 'Construction Management' },
  { name: 'AVEVA', category: 'Engineering Software' },

  // --- Manufacturing ---
  { name: 'Siemens NX', category: 'CAD/CAM' },
  { name: 'Mastercam', category: 'CAM Software' },
  { name: 'ANSYS', category: 'Simulation/CAE' },
  { name: 'MATLAB', category: 'Scientific Computing' },
  { name: 'LabVIEW', category: 'Test/Measurement' },
  { name: 'PLC Programming', category: 'Industrial Automation' },
  { name: 'SCADA', category: 'Industrial Control' },
  { name: 'Siemens TIA Portal', category: 'Industrial Automation' },
  { name: 'Allen-Bradley', category: 'Industrial Automation' },
  { name: 'Wonderware', category: 'Industrial Automation' },
  { name: 'Kepware', category: 'Industrial IoT' },

  // --- Legal ---
  { name: 'Westlaw', category: 'Legal Research' },
  { name: 'LexisNexis', category: 'Legal Research' },
  { name: 'Clio', category: 'Legal Practice Management' },
  { name: 'DocuSign', category: 'E-Signature' },
  { name: 'Relativity', category: 'E-Discovery' },
  { name: 'iManage', category: 'Legal Document Management' },

  // --- Education ---
  { name: 'Canvas LMS', category: 'Learning Management' },
  { name: 'Blackboard', category: 'Learning Management' },
  { name: 'Moodle', category: 'Learning Management' },
  { name: 'Google Classroom', category: 'Learning Management' },
  { name: 'Instructure', category: 'EdTech Platform' },

  // --- Real Estate / Property ---
  { name: 'MLS', category: 'Real Estate Platform' },
  { name: 'Yardi', category: 'Property Management' },
  { name: 'AppFolio', category: 'Property Management' },
  { name: 'CoStar', category: 'Real Estate Data' },
  { name: 'RealPage', category: 'Property Management' },

  // --- Transportation / Logistics ---
  { name: 'SAP TM', category: 'Transportation Management' },
  { name: 'Oracle Transportation Management', category: 'TMS' },
  { name: 'Manhattan Associates', category: 'Supply Chain Software' },
  { name: 'Blue Yonder', category: 'Supply Chain Software' },
  { name: 'Descartes', category: 'Logistics Software' },

  // --- Energy / Utilities ---
  { name: 'ETAP', category: 'Power Systems Analysis' },
  { name: 'PSS/E', category: 'Power Grid Simulation' },
  { name: 'OSIsoft PI', category: 'Process Data Management' },
  { name: 'Aspen HYSYS', category: 'Process Simulation' },
  { name: 'Petrel', category: 'Reservoir Modeling' },

  // --- GIS / Geospatial ---
  { name: 'ArcGIS', category: 'GIS Software' },
  { name: 'QGIS', category: 'GIS Software' },
  { name: 'Google Earth Pro', category: 'GIS Software' },

  // --- Agriculture ---
  { name: 'John Deere Operations Center', category: 'Precision Agriculture' },
  { name: 'Trimble Agriculture', category: 'Precision Agriculture' },
  { name: 'Climate FieldView', category: 'Precision Agriculture' },
  { name: 'Ag Leader', category: 'Precision Agriculture' },

  // --- Hospitality ---
  { name: 'Opera PMS', category: 'Hospitality PMS' },
  { name: 'Micros POS', category: 'Point of Sale' },
  { name: 'Toast POS', category: 'Restaurant POS' },
  { name: 'Square POS', category: 'Point of Sale' },
  { name: 'OpenTable', category: 'Reservation System' },

  // --- Media / Creative ---
  { name: 'Adobe Creative Suite', category: 'Creative Software' },
  { name: 'Adobe Photoshop', category: 'Image Editing' },
  { name: 'Adobe Premiere Pro', category: 'Video Editing' },
  { name: 'Final Cut Pro', category: 'Video Editing' },
  { name: 'DaVinci Resolve', category: 'Video Editing/Color' },
  { name: 'Pro Tools', category: 'Audio Production' },
  { name: 'Ableton Live', category: 'Audio Production' },
  { name: 'Figma', category: 'UI/UX Design' },
];

async function createONETData(): Promise<void> {
  console.log('\n[O*NET] Building FULL cross-industry skills dataset...');
  console.log('  Source: O*NET Content Model — Skills, Knowledge, Work Styles,');
  console.log('  Work Activities, and Cross-Industry Tools & Technology.\n');

  const outputDir = path.join(DATA_ROOT, 'onet');
  fs.mkdirSync(outputDir, { recursive: true });

  const allItems = [
    ...ONET_SKILLS,
    ...ONET_KNOWLEDGE,
    ...ONET_WORK_STYLES,
    ...ONET_WORK_ACTIVITIES,
    ...ONET_CROSS_INDUSTRY_TOOLS,
  ];

  // Save JSON
  const jsonPath = path.join(outputDir, 'hot_technologies.json');
  fs.writeFileSync(jsonPath, JSON.stringify(allItems, null, 2));

  // Summary by category prefix
  const byPrefix = new Map<string, number>();
  for (const item of allItems) {
    const prefix = item.category.split(' - ')[0] ?? item.category;
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }

  console.log('  Items by category:');
  for (const [cat, count] of [...byPrefix.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${count.toString().padStart(4)} ${cat}`);
  }

  console.log(`\n[O*NET] ✅ Saved ${allItems.length} items to ${jsonPath}`);
}

// ==================== Main ====================

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     SKILL TAXONOMY — CROSS-INDUSTRY API DATA FETCHER      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  if (!fs.existsSync(DATA_ROOT)) {
    fs.mkdirSync(DATA_ROOT, { recursive: true });
  }

  const tasks: Array<() => Promise<void>> = [];

  if (!SOURCE_FILTER || SOURCE_FILTER === 'esco') {
    tasks.push(fetchESCOSkills);
  }
  if (!SOURCE_FILTER || SOURCE_FILTER === 'stackoverflow' || SOURCE_FILTER === 'stackexchange') {
    tasks.push(fetchStackExchangeTags);
  }
  if (!SOURCE_FILTER || SOURCE_FILTER === 'onet') {
    tasks.push(createONETData);
  }

  for (const task of tasks) {
    try {
      await task();
    } catch (error) {
      console.log(`\n❌ Task failed: ${error}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('FETCH COMPLETE');
  console.log('='.repeat(60));
  console.log('\nTo merge data into taxonomy, run:');
  console.log('  pnpm merge:all --apply');
}

main().catch(console.error);
