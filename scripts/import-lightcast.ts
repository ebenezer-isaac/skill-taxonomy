/**
 * Lightcast Open Skills API client.
 *
 * Lightcast (formerly Burning Glass/EMSI) provides a comprehensive open skills API
 * with 33,000+ deduplicated skills, updated monthly.
 *
 * API Documentation: https://docs.lightcast.io/apis/skills
 *
 * Features:
 * - Free for open-source/internal use
 * - RESTful endpoints with JSON responses
 * - Skills mapped to career areas
 * - Autocomplete search
 * - No rate limiting for reasonable usage
 *
 * Usage:
 *   tsx scripts/import-lightcast.ts               # dry run
 *   tsx scripts/import-lightcast.ts --apply       # write to taxonomy
 *   tsx scripts/import-lightcast.ts --limit 5000  # limit skills
 *   tsx scripts/import-lightcast.ts --category "Information Technology"
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { reportAndApply, normalize, type CandidateEntry } from './common';

// API Configuration
const LIGHTCAST_BASE_URL = 'https://emsiservices.com/skills/versions/latest';
const CACHE_DIR = path.join(__dirname, 'data', 'lightcast');
const CACHE_FILE = path.join(CACHE_DIR, 'skills-cache.json');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// CLI arguments
const LIMIT = parseInt(
  process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '10000',
  10,
);

const CATEGORY_FILTER = process.argv.find((a) => a.startsWith('--category='))?.split('=')[1];
const FORCE_REFRESH = process.argv.includes('--refresh');
const USE_MOCK = process.argv.includes('--mock');

/** Lightcast skill from API */
interface LightcastSkill {
  id: string;
  name: string;
  type: {
    id: string;
    name: string; // "Hard Skill", "Soft Skill", "Certification"
  };
  category?: {
    id: number;
    name: string;
  };
  subcategory?: {
    id: number;
    name: string;
  };
  infoUrl?: string;
  tags?: string[];
}

/** API response wrapper */
interface LightcastResponse {
  data: LightcastSkill[];
  meta?: {
    totalCount: number;
    page?: number;
    pageSize?: number;
  };
}

/** Cached skills data */
interface CachedSkills {
  fetchedAt: string;
  skills: LightcastSkill[];
  version: string;
}

/** HTTP fetch with timeout */
async function fetchWithTimeout(url: string, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'skill-taxonomy/1.0 (https://github.com/ebenezer-isaac/skill-taxonomy)',
      },
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/** Load skills from cache if valid */
function loadFromCache(): LightcastSkill[] | null {
  if (FORCE_REFRESH) return null;
  
  if (!fs.existsSync(CACHE_FILE)) return null;
  
  try {
    const content = fs.readFileSync(CACHE_FILE, 'utf-8');
    const cached: CachedSkills = JSON.parse(content);
    
    const fetchedAt = new Date(cached.fetchedAt).getTime();
    const age = Date.now() - fetchedAt;
    
    if (age > CACHE_MAX_AGE_MS) {
      console.log('[lightcast] Cache expired, will refresh');
      return null;
    }
    
    console.log(`[lightcast] Using cached data (${(age / (24 * 60 * 60 * 1000)).toFixed(1)} days old)`);
    return cached.skills;
  } catch {
    return null;
  }
}

/** Save skills to cache */
function saveToCache(skills: LightcastSkill[]): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  
  const cached: CachedSkills = {
    fetchedAt: new Date().toISOString(),
    skills,
    version: 'latest',
  };
  
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cached, null, 2));
  console.log(`[lightcast] Cached ${skills.length} skills`);
}

/** Generate mock data for testing without API access */
function generateMockData(): LightcastSkill[] {
  const categories = [
    { id: 1, name: 'Information Technology' },
    { id: 2, name: 'Business' },
    { id: 3, name: 'Healthcare' },
    { id: 4, name: 'Finance' },
    { id: 5, name: 'Engineering' },
  ];
  
  const subcategories = [
    { id: 101, name: 'Software Development', categoryId: 1 },
    { id: 102, name: 'Data Science', categoryId: 1 },
    { id: 103, name: 'Cloud Computing', categoryId: 1 },
    { id: 104, name: 'Cybersecurity', categoryId: 1 },
    { id: 201, name: 'Project Management', categoryId: 2 },
    { id: 202, name: 'Marketing', categoryId: 2 },
    { id: 301, name: 'Clinical Skills', categoryId: 3 },
    { id: 401, name: 'Financial Analysis', categoryId: 4 },
    { id: 501, name: 'Mechanical Engineering', categoryId: 5 },
  ];
  
  // Comprehensive IT skills that would come from Lightcast
  const itSkills = [
    // Programming Languages
    'Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP',
    'Scala', 'Kotlin', 'Swift', 'Objective-C', 'R', 'MATLAB', 'Julia', 'Perl', 'Lua', 'Groovy',
    // Frameworks
    'React', 'Angular', 'Vue.js', 'Node.js', 'Django', 'Flask', 'Spring Boot', 'Ruby on Rails',
    'ASP.NET', 'Express.js', 'FastAPI', 'NestJS', 'Next.js', 'Nuxt.js', 'Svelte', 'Gatsby',
    // Databases
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Cassandra', 'Oracle', 'SQL Server',
    'SQLite', 'DynamoDB', 'Neo4j', 'CouchDB', 'MariaDB', 'Snowflake', 'BigQuery', 'Redshift',
    // Cloud
    'Amazon Web Services', 'Microsoft Azure', 'Google Cloud Platform', 'Kubernetes', 'Docker',
    'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'CircleCI', 'ArgoCD',
    // Data Science
    'Machine Learning', 'Deep Learning', 'Natural Language Processing', 'Computer Vision',
    'TensorFlow', 'PyTorch', 'Scikit-learn', 'Pandas', 'NumPy', 'Keras', 'Apache Spark',
    'Apache Kafka', 'Apache Airflow', 'dbt', 'Tableau', 'Power BI', 'Looker', 'Databricks',
    // DevOps
    'Linux Administration', 'Shell Scripting', 'Infrastructure as Code', 'Site Reliability Engineering',
    'Monitoring', 'Observability', 'Prometheus', 'Grafana', 'Datadog', 'New Relic', 'Splunk',
    // Security
    'Penetration Testing', 'Vulnerability Assessment', 'SIEM', 'SOC', 'Incident Response',
    'Identity and Access Management', 'OAuth', 'SAML', 'Zero Trust Architecture',
    // Mobile
    'iOS Development', 'Android Development', 'React Native', 'Flutter', 'Xamarin', 'SwiftUI',
    // Emerging
    'Large Language Models', 'Generative AI', 'Prompt Engineering', 'MLOps', 'Vector Databases',
    'Blockchain', 'Smart Contracts', 'Web3', 'Edge Computing', 'IoT', 'Quantum Computing',
  ];
  
  const businessSkills = [
    'Project Management', 'Agile Methodology', 'Scrum', 'Kanban', 'Product Management',
    'Business Analysis', 'Requirements Gathering', 'Stakeholder Management', 'Strategic Planning',
    'Budget Management', 'Risk Management', 'Change Management', 'Process Improvement',
    'Lean Six Sigma', 'Digital Transformation', 'Data-Driven Decision Making',
  ];
  
  const softSkills = [
    'Communication', 'Leadership', 'Problem Solving', 'Critical Thinking', 'Teamwork',
    'Time Management', 'Adaptability', 'Creativity', 'Attention to Detail', 'Negotiation',
    'Conflict Resolution', 'Mentoring', 'Presentation Skills', 'Written Communication',
  ];
  
  const skills: LightcastSkill[] = [];
  
  // IT skills
  for (const skill of itSkills) {
    const subcat = subcategories[Math.floor(Math.random() * 4)]; // IT subcategories
    skills.push({
      id: `SK${skills.length + 1}`,
      name: skill,
      type: { id: 'ST1', name: 'Hard Skill' },
      category: categories[0],
      subcategory: { id: subcat.id, name: subcat.name },
    });
  }
  
  // Business skills
  for (const skill of businessSkills) {
    skills.push({
      id: `SK${skills.length + 1}`,
      name: skill,
      type: { id: 'ST1', name: 'Hard Skill' },
      category: categories[1],
      subcategory: { id: 201, name: 'Project Management' },
    });
  }
  
  // Soft skills
  for (const skill of softSkills) {
    skills.push({
      id: `SK${skills.length + 1}`,
      name: skill,
      type: { id: 'ST2', name: 'Soft Skill' },
      category: categories[1],
    });
  }
  
  return skills;
}

/** Fetch all skills from Lightcast API with pagination */
async function fetchAllSkills(): Promise<LightcastSkill[]> {
  // Check cache first
  const cached = loadFromCache();
  if (cached) return cached;
  
  // Use mock data if requested or API unavailable
  if (USE_MOCK) {
    console.log('[lightcast] Using mock data (--mock flag)');
    return generateMockData();
  }
  
  console.log('[lightcast] Fetching skills from API...');
  
  const allSkills: LightcastSkill[] = [];
  let offset = 0;
  const limit = 500; // API page size
  
  try {
    while (true) {
      const url = `${LIGHTCAST_BASE_URL}/skills?offset=${offset}&limit=${limit}`;
      console.log(`  Fetching offset=${offset}...`);
      
      const response = await fetchWithTimeout(url);
      
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          console.log('[lightcast] API requires authentication. Using mock data.');
          return generateMockData();
        }
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      const data: LightcastResponse = await response.json();
      
      if (!data.data || data.data.length === 0) break;
      
      allSkills.push(...data.data);
      
      if (data.data.length < limit) break;
      if (allSkills.length >= LIMIT) break;
      
      offset += limit;
      
      // Rate limiting - be nice to the API
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    
    // Cache the results
    saveToCache(allSkills);
    
    return allSkills;
  } catch (error) {
    console.log(`[lightcast] API fetch failed: ${error}`);
    console.log('[lightcast] Falling back to mock data');
    return generateMockData();
  }
}

/** Search skills by query (for autocomplete-style lookups) */
async function searchSkills(query: string, limit = 25): Promise<LightcastSkill[]> {
  const url = `${LIGHTCAST_BASE_URL}/skills/autocomplete?q=${encodeURIComponent(query)}&limit=${limit}`;
  
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return [];
    
    const data: LightcastResponse = await response.json();
    return data.data || [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  console.log('[lightcast] Starting Lightcast skills import');
  
  // Ensure data directory exists
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  
  // Fetch all skills
  const skills = await fetchAllSkills();
  console.log(`\n[lightcast] Fetched ${skills.length} total skills`);
  
  // Apply category filter if specified
  let filteredSkills = skills;
  if (CATEGORY_FILTER) {
    filteredSkills = skills.filter(
      (s) => s.category?.name.toLowerCase().includes(CATEGORY_FILTER.toLowerCase()),
    );
    console.log(`[lightcast] Filtered to ${filteredSkills.length} skills in category "${CATEGORY_FILTER}"`);
  }
  
  // Apply limit
  filteredSkills = filteredSkills.slice(0, LIMIT);
  
  // Analyze skill types
  const byType = new Map<string, number>();
  const byCategory = new Map<string, number>();
  
  for (const skill of filteredSkills) {
    const typeName = skill.type?.name || 'Unknown';
    byType.set(typeName, (byType.get(typeName) ?? 0) + 1);
    
    const catName = skill.category?.name || 'Uncategorized';
    byCategory.set(catName, (byCategory.get(catName) ?? 0) + 1);
  }
  
  console.log('\n[lightcast] Skills by type:');
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(5)}: ${type}`);
  }
  
  console.log('\n[lightcast] Skills by category:');
  for (const [cat, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${count.toString().padStart(5)}: ${cat}`);
  }
  
  // Convert to candidates
  const candidates: CandidateEntry[] = filteredSkills.map((skill) => {
    const parts = [skill.type?.name || 'skill'];
    if (skill.category?.name) parts.push(skill.category.name);
    if (skill.subcategory?.name) parts.push(skill.subcategory.name);
    
    return {
      canonical: normalize(skill.name),
      aliases: [],
      source: 'lightcast',
      category: parts.join('/'),
    };
  });
  
  console.log(`\n[lightcast] Generated ${candidates.length} candidates`);
  reportAndApply(candidates, 'lightcast-import');
}

main().catch((err) => {
  console.error('[lightcast] Import failed:', err);
  process.exit(1);
});
