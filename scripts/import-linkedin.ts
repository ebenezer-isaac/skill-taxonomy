/**
 * Import skills from LinkedIn skill assessment topics + cross-industry professional skills.
 *
 * Original source: https://github.com/Ebazhanov/linkedin-skill-assessments-quizzes
 * Expanded with comprehensive cross-industry professional skills.
 *
 * Usage:
 *   tsx scripts/import-linkedin.ts          # dry run
 *   tsx scripts/import-linkedin.ts --apply  # write to taxonomy
 */
import { reportAndApply, normalize, type CandidateEntry } from './common';

/** LinkedIn skill assessment topics + cross-industry professional skills */
const LINKEDIN_SKILLS: Record<string, string[]> = {
  // ===================== PROGRAMMING & DEVELOPMENT =====================
  'rust': [],
  'swift': [],
  'kotlin': [],
  'scala': [],
  'objective-c': ['objc', 'obj-c'],
  'visual basic': ['vb', 'vba', 'visual basic for applications'],
  't-sql': ['transact-sql', 'tsql'],
  'nosql': ['no sql', 'non-relational'],
  'xml': ['extensible markup language'],
  'json': ['javascript object notation'],
  'regex': ['regular expressions', 'regexp'],

  // ===================== CLOUD & INFRASTRUCTURE =====================
  'amazon ec2': ['ec2'],
  'amazon s3': ['s3'],
  'amazon rds': ['rds'],
  'amazon lambda': ['aws lambda'],
  'azure devops': ['azure pipelines'],
  'google kubernetes engine': ['gke'],
  'amazon eks': ['eks'],
  'azure kubernetes service': ['aks'],

  // ===================== DATA & DATABASES =====================
  'data science': ['data analysis'],
  'business intelligence': ['bi'],
  'data visualization': ['data viz'],
  'apache hive': ['hive'],
  'apache pig': ['pig'],

  // ===================== COLLABORATION & DESIGN =====================
  'microsoft excel': ['excel', 'spreadsheets'],
  'microsoft power automate': ['power automate', 'ms flow'],
  'sharepoint': ['sharepoint online'],
  'autocad': ['auto cad'],
  'solidworks': ['solid works'],
  'revit': ['autodesk revit'],

  // ===================== SECURITY & NETWORKING =====================
  'penetration testing': ['pentest', 'pentesting', 'ethical hacking'],
  'network security': ['netsec'],
  'endpoint security': ['edr', 'endpoint detection'],
  'siem': ['security information and event management'],
  'soc': ['security operations center'],

  // ===================== METHODOLOGIES =====================
  'lean': ['lean methodology', 'lean manufacturing'],
  'six sigma': ['6 sigma', 'lean six sigma'],
  'devops': ['dev ops'],
  'devsecops': ['dev sec ops'],

  // ===================== ACCOUNTING & FINANCE =====================
  'financial analysis': ['financial modeling', 'financial planning'],
  'bookkeeping': ['double-entry bookkeeping'],
  'accounts payable': ['ap', 'a/p'],
  'accounts receivable': ['ar', 'a/r'],
  'general ledger': ['gl', 'g/l'],
  'gaap': ['generally accepted accounting principles'],
  'ifrs': ['international financial reporting standards'],
  'tax preparation': ['tax filing', 'income tax'],
  'payroll processing': ['payroll administration'],
  'auditing': ['internal audit', 'external audit'],
  'cost accounting': ['managerial accounting'],
  'forensic accounting': ['fraud examination'],
  'financial reporting': ['financial statements'],
  'budget planning': ['budgeting', 'budget management'],
  'cash flow management': ['cash management'],
  'treasury management': ['corporate treasury'],
  'credit analysis': ['credit assessment'],
  'investment analysis': ['equity research'],
  'portfolio management': ['asset management', 'wealth management'],
  'actuarial science': ['actuarial analysis'],
  'underwriting': ['insurance underwriting', 'loan underwriting'],

  // ===================== HUMAN RESOURCES =====================
  'talent acquisition': ['recruiting', 'recruitment'],
  'employee onboarding': ['new hire orientation'],
  'performance management': ['performance reviews', 'performance appraisal'],
  'compensation and benefits': ['comp and ben', 'total rewards'],
  'labor relations': ['employee relations', 'industrial relations'],
  'organizational development': ['od', 'org development'],
  'succession planning': ['talent pipeline'],
  'workforce planning': ['headcount planning'],
  'diversity and inclusion': ['dei', 'd&i', 'diversity equity inclusion'],
  'employee engagement': ['engagement surveys'],
  'learning and development': ['l&d', 'training and development'],
  'hris': ['human resource information system'],
  'benefits administration': ['benefits management'],
  'conflict resolution': ['mediation', 'dispute resolution'],
  'employee retention': ['retention strategies'],

  // ===================== MARKETING =====================
  'seo': ['search engine optimization'],
  'sem': ['search engine marketing', 'paid search'],
  'content marketing': ['content strategy'],
  'social media marketing': ['smm', 'social marketing'],
  'email marketing': ['email campaigns', 'drip campaigns'],
  'brand management': ['branding', 'brand strategy'],
  'market research': ['market analysis', 'consumer research'],
  'product marketing': ['go-to-market', 'gtm strategy'],
  'demand generation': ['demand gen', 'lead generation'],
  'conversion rate optimization': ['cro'],
  'marketing analytics': ['marketing metrics'],
  'public relations': ['pr', 'media relations'],
  'copywriting': ['content writing', 'ad copy'],
  'affiliate marketing': ['partner marketing'],
  'influencer marketing': ['creator marketing'],
  'event marketing': ['event planning', 'trade shows'],

  // ===================== SALES =====================
  'sales management': ['sales leadership'],
  'account management': ['key account management', 'kam'],
  'business development': ['biz dev', 'bd'],
  'inside sales': ['sdr', 'sales development'],
  'enterprise sales': ['strategic sales'],
  'solution selling': ['consultative selling'],
  'crm management': ['crm administration'],
  'sales forecasting': ['pipeline management'],
  'territory management': ['territory planning'],
  'proposal writing': ['rfp response', 'bid management'],
  'contract negotiation': ['deal negotiation'],
  'customer success': ['customer success management', 'csm'],
  'customer retention': ['churn prevention'],
  'upselling': ['cross-selling'],

  // ===================== OPERATIONS & SUPPLY CHAIN =====================
  'supply chain management': ['scm', 'supply chain'],
  'inventory management': ['stock control', 'inventory control'],
  'logistics': ['logistics management'],
  'procurement': ['sourcing', 'purchasing'],
  'vendor management': ['supplier management'],
  'warehouse management': ['warehousing', 'wms'],
  'demand forecasting': ['demand planning'],
  'quality management': ['quality assurance', 'tqm'],
  'process improvement': ['process optimization', 'bpi'],
  'operations management': ['business operations'],
  'fleet management': ['transportation management'],
  'import/export': ['international trade', 'customs'],
  'order fulfillment': ['order processing'],

  // ===================== EDUCATION =====================
  'curriculum development': ['curriculum design', 'course design'],
  'instructional design': ['learning design', 'ld'],
  'classroom management': ['student management'],
  'educational assessment': ['student assessment', 'testing'],
  'special education': ['sped', 'inclusive education'],
  'e-learning': ['online learning', 'distance learning'],
  'academic advising': ['student counseling'],
  'research methodology': ['research methods'],
  'grant writing': ['research grants', 'funding proposals'],
  'academic publishing': ['scholarly writing', 'peer review'],
  'tutoring': ['academic tutoring'],
  'adult education': ['continuing education', 'professional development'],

  // ===================== HEALTHCARE =====================
  'patient care': ['clinical care', 'bedside care'],
  'medical coding': ['icd coding', 'cpt coding'],
  'medical billing': ['healthcare billing', 'revenue cycle'],
  'clinical research': ['clinical trials'],
  'nursing': ['registered nursing', 'rn'],
  'pharmacy': ['pharmacology', 'medication management'],
  'mental health': ['behavioral health'],
  'physical therapy': ['physiotherapy', 'pt'],
  'occupational therapy': ['ot'],
  'speech therapy': ['speech-language pathology', 'slp'],
  'health informatics': ['healthcare informatics'],
  'telemedicine': ['telehealth', 'virtual care'],
  'infection control': ['infection prevention'],
  'case management': ['care coordination'],
  'medical terminology': ['clinical terminology'],

  // ===================== CONSTRUCTION =====================
  'construction management': ['site management'],
  'building codes': ['code compliance', 'building regulations'],
  'blueprint reading': ['plan reading', 'technical drawings'],
  'cost estimation': ['construction estimating', 'quantity surveying'],
  'project scheduling': ['construction scheduling', 'cpm'],
  'safety management': ['osha compliance', 'construction safety'],
  'building information modeling': ['bim'],
  'structural analysis': ['structural engineering'],
  'hvac': ['heating ventilation air conditioning'],
  'plumbing': ['plumbing systems'],
  'electrical systems': ['electrical engineering', 'wiring'],
  'concrete': ['concrete technology', 'concrete work'],
  'welding': ['welding technology'],
  'heavy equipment operation': ['equipment operation'],

  // ===================== LEGAL =====================
  'legal research': ['case law research'],
  'contract law': ['contract drafting'],
  'litigation': ['civil litigation'],
  'corporate law': ['business law', 'commercial law'],
  'intellectual property': ['ip law', 'patent law'],
  'employment law': ['labor law'],
  'real estate law': ['property law'],
  'regulatory compliance': ['compliance management'],
  'legal writing': ['legal drafting'],
  'paralegal': ['legal assistant'],
  'immigration law': ['visa processing'],
  'criminal law': ['criminal defense'],
  'family law': ['divorce law'],
  'tax law': ['tax compliance'],
  'environmental law': ['environmental compliance'],

  // ===================== REAL ESTATE =====================
  'property management': ['real estate management'],
  'real estate appraisal': ['property valuation'],
  'leasing': ['lease administration', 'lease management'],
  'commercial real estate': ['cre'],
  'residential real estate': ['home sales'],
  'real estate investment': ['reit', 'real estate investing'],
  'property inspection': ['home inspection'],
  'title search': ['title examination'],
  'zoning': ['land use planning'],

  // ===================== GOVERNMENT & PUBLIC ADMIN =====================
  'public policy': ['policy analysis'],
  'government relations': ['lobbying', 'advocacy'],
  'public administration': ['government administration'],
  'urban planning': ['city planning', 'town planning'],
  'emergency management': ['disaster management', 'fema'],
  'law enforcement': ['policing', 'criminal justice'],
  'military': ['defense', 'armed forces'],
  'diplomacy': ['foreign affairs', 'international relations'],

  // ===================== HOSPITALITY & TOURISM =====================
  'hotel management': ['hospitality management'],
  'food and beverage': ['f&b', 'food service'],
  'event management': ['event coordination', 'event planning'],
  'travel management': ['corporate travel'],
  'revenue management': ['yield management'],
  'guest services': ['concierge', 'front desk'],

  // ===================== MANUFACTURING =====================
  'lean manufacturing': ['lean production'],
  'iso 9001': ['quality management system', 'qms'],
  'cnc machining': ['cnc programming', 'cnc operation'],
  'cad/cam': ['computer-aided design', 'computer-aided manufacturing'],
  'injection molding': ['plastic molding'],
  'process engineering': ['manufacturing engineering'],
  'production planning': ['production scheduling'],
  'industrial engineering': ['ie'],
  'maintenance management': ['preventive maintenance', 'cmms'],

  // ===================== AGRICULTURE =====================
  'agronomy': ['crop science'],
  'precision agriculture': ['precision farming'],
  'soil science': ['soil management'],
  'irrigation': ['irrigation management'],
  'livestock management': ['animal husbandry'],
  'food safety': ['haccp', 'food hygiene'],
  'sustainable agriculture': ['organic farming'],

  // ===================== ENERGY =====================
  'renewable energy': ['clean energy', 'green energy'],
  'solar energy': ['photovoltaic', 'solar power'],
  'wind energy': ['wind power', 'wind turbines'],
  'oil and gas': ['petroleum', 'upstream oil & gas'],
  'power grid': ['electrical grid', 'grid management'],
  'energy efficiency': ['energy conservation'],
  'nuclear energy': ['nuclear power'],

  // ===================== TRANSPORTATION =====================
  'fleet management': ['vehicle management'],
  'route optimization': ['route planning'],
  'freight management': ['freight forwarding'],
  'air traffic control': ['atc'],
  'maritime': ['shipping', 'marine operations'],
  'rail operations': ['railway operations'],

  // ===================== UNIVERSAL PROFESSIONAL SKILLS =====================
  'communication': ['verbal communication', 'written communication'],
  'presentation skills': ['public speaking'],
  'leadership': ['team leadership', 'people management'],
  'problem solving': ['analytical skills'],
  'teamwork': ['collaboration', 'team building'],
  'strategic planning': ['strategic thinking'],
  'change management': ['organizational change'],
  'stakeholder management': ['stakeholder engagement'],
  'cross-functional collaboration': ['cross-team collaboration'],
  'decision making': ['judgment'],
  'emotional intelligence': ['eq', 'emotional quotient'],
  'cultural competence': ['cross-cultural communication'],
  'critical thinking': [],
  'creativity': ['creative thinking', 'innovation'],
  'adaptability': ['flexibility', 'resilience'],
  'mentoring': ['coaching', 'professional mentoring'],
  'networking': ['professional networking'],
  'remote work': ['virtual collaboration', 'distributed teams'],
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
