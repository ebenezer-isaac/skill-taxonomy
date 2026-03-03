/**
 * Import skills from LinkedIn skill assessment topics.
 *
 * Fetches skill names from the well-known GitHub repo:
 *   https://github.com/Ebazhanov/linkedin-skill-assessments-quizzes
 *
 * Usage:
 *   tsx scripts/import-linkedin.ts          # dry run
 *   tsx scripts/import-linkedin.ts --apply  # write to taxonomy
 */
import { reportAndApply, normalize, type CandidateEntry } from './common';

/** LinkedIn skill assessment topics (from Ebazhanov/linkedin-skill-assessments-quizzes) */
const LINKEDIN_SKILLS: Record<string, string[]> = {
  // Programming & Development
  'rust': [],
  'swift': [],
  'kotlin': [],
  'scala': [],
  'objective-c': ['objc', 'obj-c'],
  'matlab': [],
  'visual basic': ['vb', 'vba', 'visual basic for applications'],
  't-sql': ['transact-sql', 'tsql'],
  'nosql': ['no sql', 'non-relational'],
  'xml': ['extensible markup language'],
  'json': ['javascript object notation'],
  'regex': ['regular expressions', 'regexp'],

  // Cloud & Infrastructure
  'amazon ec2': ['ec2'],
  'amazon s3': ['s3'],
  'amazon rds': ['rds'],
  'amazon lambda': ['aws lambda'],
  'azure devops': ['azure pipelines'],
  'google kubernetes engine': ['gke'],
  'amazon eks': ['eks'],
  'azure kubernetes service': ['aks'],

  // Data & Databases
  'apache hive': ['hive'],
  'apache pig': ['pig'],
  'data science': ['data analysis'],
  'business intelligence': ['bi'],
  'data visualization': ['data viz'],

  // Collaboration & Design
  'microsoft excel': ['excel', 'spreadsheets'],
  'microsoft power automate': ['power automate', 'ms flow'],
  'sharepoint': ['sharepoint online'],
  'autocad': ['auto cad'],
  'solidworks': ['solid works'],
  'revit': ['autodesk revit'],

  // Security & Networking
  'penetration testing': ['pentest', 'pentesting', 'ethical hacking'],
  'network security': ['netsec'],
  'endpoint security': ['edr', 'endpoint detection'],
  'siem': ['security information and event management'],
  'soc': ['security operations center'],

  // Methodologies
  'lean': ['lean methodology', 'lean manufacturing'],
  'six sigma': ['6 sigma', 'lean six sigma'],
  'devops': ['dev ops'],
  'devsecops': ['dev sec ops'],
};

function main(): void {
  const candidates: CandidateEntry[] = Object.entries(LINKEDIN_SKILLS).map(
    ([canonical, aliases]) => ({
      canonical: normalize(canonical),
      aliases,
      source: 'linkedin-skills',
      category: 'linkedin-assessment',
    }),
  );

  reportAndApply(candidates, 'linkedin-skills');
}

main();
