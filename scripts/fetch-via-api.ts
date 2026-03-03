/**
 * Fetch skill data via public APIs (no bulk downloads required).
 * 
 * Uses:
 * - ESCO REST API for European skills classification
 * - Stack Exchange API for technology tags with usage counts
 * - Curated O*NET hot technology list
 * 
 * Usage:
 *   tsx scripts/fetch-via-api.ts              # fetch all
 *   tsx scripts/fetch-via-api.ts --source esco
 *   tsx scripts/fetch-via-api.ts --source stackoverflow  
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

async function fetchESCOSkills(): Promise<void> {
  console.log('\n[ESCO] Fetching skills via REST API...');
  
  const outputDir = path.join(DATA_ROOT, 'esco');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const baseUrl = 'https://ec.europa.eu/esco/api';
  const rateLimiter = new RateLimiter(200); // 5 requests per second
  
  const skills: Array<{
    uri: string;
    preferredLabel: string;
    altLabels: string[];
    description: string;
    skillType: string;
    reuseLevel: string;
  }> = [];
  
  // First, search for IT-related skills
  const searchTerms = [
    'programming', 'software', 'database', 'network', 'cloud',
    'data analysis', 'machine learning', 'artificial intelligence',
    'web development', 'mobile development', 'devops', 'security',
    'agile', 'javascript', 'python', 'java', 'sql',
  ];
  
  const seenUris = new Set<string>();
  
  for (const term of searchTerms) {
    console.log(`  Searching: "${term}"...`);
    await rateLimiter.wait();
    
    try {
      const searchUrl = `${baseUrl}/search?text=${encodeURIComponent(term)}&type=skill&language=en&full=false&offset=0&limit=100`;
      
      const response = await fetch(searchUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'skill-taxonomy/2.0',
        },
      });
      
      if (!response.ok) {
        console.log(`    ⚠️ Search failed: ${response.status}`);
        continue;
      }
      
      const data = await response.json() as ESCOSearchResult;
      const results = data._embedded?.results ?? [];
      
      console.log(`    Found ${results.length} results (total: ${data.total})`);
      
      // Fetch details for each skill
      for (const result of results) {
        if (seenUris.has(result.uri)) continue;
        seenUris.add(result.uri);
        
        await rateLimiter.wait();
        
        try {
          const detailUrl = `${baseUrl}/resource/skill?uri=${encodeURIComponent(result.uri)}&language=en`;
          const detailResponse = await fetch(detailUrl, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'skill-taxonomy/2.0',
            },
          });
          
          if (detailResponse.ok) {
            const detail = await detailResponse.json() as ESCOSkillDetail;
            const label = extractEnglishLabel(detail.preferredLabel);
            
            // Skip if no English label
            if (!label) continue;
            
            skills.push({
              uri: detail.uri,
              preferredLabel: label,
              altLabels: extractEnglishAltLabels(detail.altLabels),
              description: extractEnglishDescription(detail.description),
              skillType: detail.skillType ?? 'skill/competence',
              reuseLevel: detail.skillReusability ?? 'transversal',
            });
          }
        } catch {
          // Skip individual skill errors
        }
      }
      
      // Safety limit
      if (skills.length > 1000) {
        console.log('  Hit safety limit at 1000 skills');
        break;
      }
    } catch (error) {
      console.log(`    ⚠️ Search error: ${error}`);
    }
  }
  
  // Save results
  const outputPath = path.join(outputDir, 'skills_api.json');
  fs.writeFileSync(outputPath, JSON.stringify(skills, null, 2));
  console.log(`\n[ESCO] ✅ Saved ${skills.length} skills to ${outputPath}`);
  
  // Also create a CSV-like format for compatibility
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

async function fetchStackOverflowTags(): Promise<void> {
  console.log('\n[StackOverflow] Fetching popular tags via API...');
  
  const outputDir = path.join(DATA_ROOT, 'stackoverflow');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const rateLimiter = new RateLimiter(100); // 10 requests per second max
  const baseUrl = 'https://api.stackexchange.com/2.3';
  
  const allTags: Array<{ name: string; count: number }> = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore && page <= 10) { // Fetch first 1000 tags
    await rateLimiter.wait();
    console.log(`  Fetching page ${page}...`);
    
    try {
      const url = `${baseUrl}/tags?page=${page}&pagesize=100&order=desc&sort=popular&site=stackoverflow`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
        },
      });
      
      if (!response.ok) {
        console.log(`    ⚠️ API error: ${response.status}`);
        break;
      }
      
      const data = await response.json() as StackExchangeTagsResponse;
      
      for (const tag of data.items) {
        allTags.push({
          name: tag.name,
          count: tag.count,
        });
      }
      
      console.log(`    Got ${data.items.length} tags (quota: ${data.quota_remaining}/${data.quota_max})`);
      
      hasMore = data.has_more;
      page++;
      
      // Stop if quota is low
      if (data.quota_remaining < 50) {
        console.log('    ⚠️ Low quota, stopping');
        break;
      }
    } catch (error) {
      console.log(`    ⚠️ Error: ${error}`);
      break;
    }
  }
  
  // Save raw tags
  const tagsPath = path.join(outputDir, 'popular_tags.json');
  fs.writeFileSync(tagsPath, JSON.stringify(allTags, null, 2));
  console.log(`\n[StackOverflow] ✅ Saved ${allTags.length} tags to ${tagsPath}`);
  
  // Create a pseudo-survey format for compatibility with import script
  // Format: tag name as "HaveWorkedWith" with count as popularity
  const surveyLines = ['ResponseId,LanguageHaveWorkedWith,DatabaseHaveWorkedWith,PlatformHaveWorkedWith,WebframeHaveWorkedWith,MiscTechHaveWorkedWith'];
  
  // Group tags into categories
  const languages = allTags.filter(t => 
    /^(javascript|python|java|c#|c\+\+|php|typescript|ruby|go|rust|swift|kotlin|scala|r|perl|lua|dart|clojure|elixir|haskell|erlang|f#|ocaml|groovy|matlab|julia|fortran|cobol|vba|shell|bash|powershell)$/.test(t.name)
  );
  const databases = allTags.filter(t =>
    /^(sql|mysql|postgresql|mongodb|sqlite|oracle|sql-server|redis|elasticsearch|neo4j|cassandra|dynamodb|firebase|couchdb|mariadb)$/.test(t.name)  
  );
  const platforms = allTags.filter(t =>
    /^(aws|azure|google-cloud|docker|kubernetes|linux|windows|android|ios|heroku|netlify|vercel)$/.test(t.name)
  );
  const frameworks = allTags.filter(t =>
    /^(react|angular|vue\.js|node\.js|express|django|flask|spring|\.net|laravel|rails|next\.js|nuxt\.js|svelte|ember\.js|jquery)$/.test(t.name)
  );
  
  surveyLines.push([
    '1',
    languages.map(t => t.name).join(';'),
    databases.map(t => t.name).join(';'),
    platforms.map(t => t.name).join(';'),
    frameworks.map(t => t.name).join(';'),
    allTags.slice(0, 50).map(t => t.name).join(';'),
  ].join(','));
  
  const csvPath = path.join(outputDir, 'survey_results_public.csv');
  fs.writeFileSync(csvPath, surveyLines.join('\n'));
  console.log(`[StackOverflow] ✅ Created survey-compatible CSV at ${csvPath}`);
}

// ==================== O*NET Hot Technologies ====================

/**
 * Curated list of O*NET "Hot Technologies" - technologies that are
 * frequently cited as requirements in job postings.
 * Source: https://www.onetcenter.org/dictionary/28.0/excel/hot_technology.html
 */
const ONET_HOT_TECHNOLOGIES = [
  // Programming Languages
  { name: 'Python', category: 'Programming Language', hotTechnology: true, inDemand: true },
  { name: 'Java', category: 'Programming Language', hotTechnology: true, inDemand: true },
  { name: 'JavaScript', category: 'Programming Language', hotTechnology: true, inDemand: true },
  { name: 'C++', category: 'Programming Language', hotTechnology: true, inDemand: true },
  { name: 'C#', category: 'Programming Language', hotTechnology: true, inDemand: true },
  { name: 'SQL', category: 'Database Language', hotTechnology: true, inDemand: true },
  { name: 'TypeScript', category: 'Programming Language', hotTechnology: true, inDemand: true },
  { name: 'Go', category: 'Programming Language', hotTechnology: true, inDemand: true },
  { name: 'Rust', category: 'Programming Language', hotTechnology: true, inDemand: true },
  { name: 'R', category: 'Programming Language', hotTechnology: true, inDemand: true },
  { name: 'Scala', category: 'Programming Language', hotTechnology: false, inDemand: true },
  { name: 'Kotlin', category: 'Programming Language', hotTechnology: true, inDemand: true },
  { name: 'Swift', category: 'Programming Language', hotTechnology: true, inDemand: true },
  
  // Cloud & Infrastructure
  { name: 'Amazon Web Services (AWS)', category: 'Cloud Platform', hotTechnology: true, inDemand: true },
  { name: 'Microsoft Azure', category: 'Cloud Platform', hotTechnology: true, inDemand: true },
  { name: 'Google Cloud Platform', category: 'Cloud Platform', hotTechnology: true, inDemand: true },
  { name: 'Docker', category: 'Containerization', hotTechnology: true, inDemand: true },
  { name: 'Kubernetes', category: 'Container Orchestration', hotTechnology: true, inDemand: true },
  { name: 'Terraform', category: 'Infrastructure as Code', hotTechnology: true, inDemand: true },
  { name: 'Ansible', category: 'Configuration Management', hotTechnology: true, inDemand: true },
  { name: 'Jenkins', category: 'CI/CD', hotTechnology: true, inDemand: true },
  { name: 'Git', category: 'Version Control', hotTechnology: true, inDemand: true },
  { name: 'GitHub', category: 'Development Platform', hotTechnology: true, inDemand: true },
  { name: 'GitLab', category: 'Development Platform', hotTechnology: true, inDemand: true },
  
  // Databases
  { name: 'MySQL', category: 'RDBMS', hotTechnology: true, inDemand: true },
  { name: 'PostgreSQL', category: 'RDBMS', hotTechnology: true, inDemand: true },
  { name: 'MongoDB', category: 'NoSQL Database', hotTechnology: true, inDemand: true },
  { name: 'Microsoft SQL Server', category: 'RDBMS', hotTechnology: true, inDemand: true },
  { name: 'Oracle Database', category: 'RDBMS', hotTechnology: true, inDemand: true },
  { name: 'Redis', category: 'In-Memory Database', hotTechnology: true, inDemand: true },
  { name: 'Elasticsearch', category: 'Search Engine', hotTechnology: true, inDemand: true },
  { name: 'Apache Kafka', category: 'Message Queue', hotTechnology: true, inDemand: true },
  { name: 'Cassandra', category: 'NoSQL Database', hotTechnology: false, inDemand: true },
  
  // Web Frameworks
  { name: 'React', category: 'Frontend Framework', hotTechnology: true, inDemand: true },
  { name: 'Angular', category: 'Frontend Framework', hotTechnology: true, inDemand: true },
  { name: 'Vue.js', category: 'Frontend Framework', hotTechnology: true, inDemand: true },
  { name: 'Node.js', category: 'Runtime', hotTechnology: true, inDemand: true },
  { name: 'Django', category: 'Web Framework', hotTechnology: true, inDemand: true },
  { name: 'Spring Boot', category: 'Web Framework', hotTechnology: true, inDemand: true },
  { name: '.NET Core', category: 'Framework', hotTechnology: true, inDemand: true },
  { name: 'Express.js', category: 'Web Framework', hotTechnology: true, inDemand: true },
  { name: 'Flask', category: 'Web Framework', hotTechnology: true, inDemand: true },
  { name: 'FastAPI', category: 'Web Framework', hotTechnology: true, inDemand: true },
  { name: 'Next.js', category: 'Web Framework', hotTechnology: true, inDemand: true },
  
  // Data & ML
  { name: 'TensorFlow', category: 'ML Framework', hotTechnology: true, inDemand: true },
  { name: 'PyTorch', category: 'ML Framework', hotTechnology: true, inDemand: true },
  { name: 'Apache Spark', category: 'Big Data', hotTechnology: true, inDemand: true },
  { name: 'Hadoop', category: 'Big Data', hotTechnology: false, inDemand: true },
  { name: 'Tableau', category: 'BI Tool', hotTechnology: true, inDemand: true },
  { name: 'Power BI', category: 'BI Tool', hotTechnology: true, inDemand: true },
  { name: 'Pandas', category: 'Data Library', hotTechnology: true, inDemand: true },
  { name: 'Scikit-learn', category: 'ML Library', hotTechnology: true, inDemand: true },
  { name: 'Apache Airflow', category: 'Workflow Orchestration', hotTechnology: true, inDemand: true },
  { name: 'Snowflake', category: 'Data Warehouse', hotTechnology: true, inDemand: true },
  { name: 'Databricks', category: 'Data Platform', hotTechnology: true, inDemand: true },
  
  // Security
  { name: 'OWASP', category: 'Security Standards', hotTechnology: true, inDemand: true },
  { name: 'OAuth', category: 'Authentication', hotTechnology: true, inDemand: true },
  { name: 'JWT', category: 'Authentication', hotTechnology: true, inDemand: true },
  { name: 'SSL/TLS', category: 'Security Protocol', hotTechnology: true, inDemand: true },
  
  // Mobile
  { name: 'React Native', category: 'Mobile Framework', hotTechnology: true, inDemand: true },
  { name: 'Flutter', category: 'Mobile Framework', hotTechnology: true, inDemand: true },
  { name: 'iOS Development', category: 'Mobile Development', hotTechnology: true, inDemand: true },
  { name: 'Android Development', category: 'Mobile Development', hotTechnology: true, inDemand: true },
  
  // Business Software
  { name: 'Salesforce', category: 'CRM', hotTechnology: true, inDemand: true },
  { name: 'SAP', category: 'ERP', hotTechnology: true, inDemand: true },
  { name: 'ServiceNow', category: 'ITSM', hotTechnology: true, inDemand: true },
  { name: 'Jira', category: 'Project Management', hotTechnology: true, inDemand: true },
  { name: 'Confluence', category: 'Documentation', hotTechnology: true, inDemand: true },
];

async function createONETData(): Promise<void> {
  console.log('\n[O*NET] Creating hot technologies dataset...');
  
  const outputDir = path.join(DATA_ROOT, 'onet');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Create Technology Skills.txt format
  const techSkillsLines = ['O*NET-SOC Code\tTitle\tExample\tCommodity Code\tHot Technology\tIn Demand'];
  
  for (const tech of ONET_HOT_TECHNOLOGIES) {
    // O*NET uses occupation codes, we'll use generic codes
    techSkillsLines.push([
      '15-1252.00', // Software Developers code
      'Software Developer',
      tech.name,
      '',
      tech.hotTechnology ? 'Y' : 'N',
      tech.inDemand ? 'Y' : 'N',
    ].join('\t'));
  }
  
  const techPath = path.join(outputDir, 'Technology Skills.txt');
  fs.writeFileSync(techPath, techSkillsLines.join('\n'));
  console.log(`[O*NET] ✅ Created ${techPath}`);
  
  // Create empty placeholder files for other required files
  const placeholderFiles = [
    'Tools & Technology.txt',
    'Abilities.txt',
    'Skills.txt',
  ];
  
  for (const filename of placeholderFiles) {
    const filePath = path.join(outputDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '# Placeholder - manual download required for full data\n');
      console.log(`[O*NET] Created placeholder: ${filename}`);
    }
  }
  
  // Save JSON version
  const jsonPath = path.join(outputDir, 'hot_technologies.json');
  fs.writeFileSync(jsonPath, JSON.stringify(ONET_HOT_TECHNOLOGIES, null, 2));
  console.log(`[O*NET] ✅ Saved ${ONET_HOT_TECHNOLOGIES.length} hot technologies to ${jsonPath}`);
}

// ==================== Main ====================

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         SKILL TAXONOMY API DATA FETCHER                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  if (!fs.existsSync(DATA_ROOT)) {
    fs.mkdirSync(DATA_ROOT, { recursive: true });
  }
  
  const tasks: Array<() => Promise<void>> = [];
  
  if (!SOURCE_FILTER || SOURCE_FILTER === 'esco') {
    tasks.push(fetchESCOSkills);
  }
  if (!SOURCE_FILTER || SOURCE_FILTER === 'stackoverflow') {
    tasks.push(fetchStackOverflowTags);
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
  console.log('\nTo import the data, run:');
  console.log('  pnpm import:esco:enhanced');
  console.log('  pnpm import:onet:enhanced');
  console.log('  pnpm import:survey:enhanced');
}

main().catch(console.error);
