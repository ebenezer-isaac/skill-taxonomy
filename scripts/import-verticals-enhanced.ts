/**
 * Comprehensive industry vertical skill imports.
 *
 * Curated, domain-specific skills that are common in specific industries
 * but often missing from general-purpose tech taxonomies.
 *
 * Verticals:
 * - Financial Services & FinTech
 * - Healthcare & Life Sciences
 * - Data & Analytics
 * - UI/UX Design
 * - DevOps & Platform Engineering
 * - Game Development
 * - Cybersecurity
 * - Blockchain & Web3
 * - IoT & Embedded Systems
 * - AI & Machine Learning
 * - E-commerce & Retail
 * - Media & Entertainment
 * - Legal & Compliance
 * - Supply Chain & Logistics
 *
 * Usage:
 *   tsx scripts/import-verticals-enhanced.ts          # dry run
 *   tsx scripts/import-verticals-enhanced.ts --apply  # write to taxonomy
 *   tsx scripts/import-verticals-enhanced.ts --vertical finance
 */
import { reportAndApply, type CandidateEntry } from './common';

const VERTICAL_FILTER = process.argv.find((a) => a.startsWith('--vertical='))?.split('=')[1];

/** Skill entry with aliases */
type SkillDef = readonly [canonical: string, ...aliases: string[]];

/** Vertical definition */
interface VerticalDefinition {
  readonly name: string;
  readonly description: string;
  readonly skills: readonly SkillDef[];
}

const VERTICALS: Record<string, VerticalDefinition> = {
  finance: {
    name: 'Financial Services & FinTech',
    description: 'Banking, trading, payments, and financial technology',
    skills: [
      // Trading & Markets
      ['bloomberg terminal', 'bloomberg', 'bbg', 'bloomberg api'],
      ['reuters eikon', 'eikon', 'refinitiv eikon'],
      ['kdb+', 'kdb', 'kx', 'kdb/q', 'q language'],
      ['fix protocol', 'fix', 'financial information exchange', 'fix api', 'quickfix'],
      ['algorithmic trading', 'algo trading', 'automated trading', 'systematic trading'],
      ['high-frequency trading', 'hft', 'low-latency trading'],
      ['market making', 'market maker'],
      ['order management system', 'oms', 'trading oms'],
      ['execution management system', 'ems'],
      ['smart order routing', 'sor'],
      
      // Quantitative Finance
      ['quantitative analysis', 'quant', 'quantitative finance', 'quant finance'],
      ['financial modeling', 'financial models'],
      ['monte carlo simulation', 'monte carlo methods'],
      ['black-scholes', 'black scholes model', 'options pricing'],
      ['value at risk', 'var', 'market risk'],
      ['risk management', 'risk analysis', 'risk assessment', 'enterprise risk'],
      ['credit risk', 'credit risk modeling'],
      ['portfolio optimization', 'portfolio management', 'asset allocation'],
      ['derivatives pricing', 'derivatives', 'exotic options'],
      ['fixed income', 'bonds', 'fixed income trading'],
      
      // Banking & Payments
      ['swift messaging', 'swift mt', 'swift mx', 'iso 20022', 'swift network'],
      ['payment processing', 'payment gateway', 'payments', 'payment systems'],
      ['core banking', 'core banking system', 'cbs'],
      ['open banking', 'psd2', 'open banking api'],
      ['real-time payments', 'instant payments', 'faster payments'],
      ['card processing', 'card payments', 'emv', 'chip and pin'],
      ['ach', 'automated clearing house'],
      ['wire transfer', 'wire transfers', 'fedwire'],
      
      // FinTech Platforms
      ['stripe', 'stripe api', 'stripe payments', 'stripe connect'],
      ['plaid', 'plaid api', 'plaid link'],
      ['square', 'square api', 'square payments'],
      ['adyen', 'adyen api'],
      ['braintree', 'braintree api'],
      ['finicity', 'finicity api'],
      ['yodlee', 'yodlee api'],
      ['dwolla', 'dwolla api'],
      
      // Compliance & Regulation
      ['kyc', 'know your customer', 'kyc/aml'],
      ['aml', 'anti-money laundering', 'aml compliance'],
      ['regulatory compliance', 'compliance', 'finreg', 'financial regulations'],
      ['sox compliance', 'sarbanes-oxley', 'sox'],
      ['mifid ii', 'mifid', 'markets in financial instruments directive'],
      ['dodd-frank', 'dodd frank act'],
      ['basel iii', 'basel', 'basel compliance'],
      ['gdpr', 'data protection', 'privacy compliance'],
      ['pci dss', 'pci compliance', 'payment card industry'],
      ['sanctions screening', 'ofac', 'sanctions compliance'],
    ],
  },

  healthcare: {
    name: 'Healthcare & Life Sciences',
    description: 'Medical systems, clinical data, pharma, and healthcare IT',
    skills: [
      // Interoperability Standards
      ['hl7', 'health level 7', 'hl7 v2', 'hl7 v3'],
      ['fhir', 'fast healthcare interoperability resources', 'hl7 fhir', 'fhir api'],
      ['cda', 'clinical document architecture', 'c-cda'],
      ['dicom', 'digital imaging and communications in medicine', 'dicom viewer'],
      ['icd-10', 'icd coding', 'icd-10-cm', 'icd-11'],
      ['snomed ct', 'snomed', 'systematized nomenclature of medicine'],
      ['loinc', 'logical observation identifiers names and codes'],
      ['cpt codes', 'cpt', 'current procedural terminology'],
      ['ndc', 'national drug code'],
      ['rxnorm', 'rx norm'],
      
      // Healthcare Systems
      ['ehr', 'electronic health records', 'emr', 'electronic medical records'],
      ['epic systems', 'epic ehr', 'epic', 'epic mychart'],
      ['cerner', 'oracle cerner', 'cerner millennium'],
      ['allscripts', 'allscripts ehr'],
      ['meditech', 'meditech expanse'],
      ['athenahealth', 'athena health'],
      ['nextgen', 'nextgen healthcare'],
      ['practice management', 'pm system'],
      ['laboratory information system', 'lis', 'lab information system'],
      ['radiology information system', 'ris'],
      ['pacs', 'picture archiving and communication system'],
      
      // Clinical & Research
      ['clinical trials', 'clinical research', 'clinical data management', 'ctms'],
      ['clinical decision support', 'cds', 'cdss'],
      ['adverse event reporting', 'pharmacovigilance', 'drug safety'],
      ['regulatory submissions', 'fda submissions', 'ectd'],
      ['good clinical practice', 'gcp', 'ich gcp'],
      ['electronic data capture', 'edc', 'medidata', 'veeva vault'],
      ['biostatistics', 'clinical biostatistics'],
      ['medical imaging', 'radiology', 'imaging analysis'],
      ['genomics', 'bioinformatics', 'genomic analysis'],
      ['proteomics', 'protein analysis'],
      
      // Compliance & Privacy
      ['hipaa', 'hipaa compliance', 'health insurance portability'],
      ['hitech', 'hitech act'],
      ['phi', 'protected health information', 'pii/phi'],
      ['meaningful use', 'promoting interoperability'],
      ['21 cfr part 11', 'electronic records', 'electronic signatures'],
      ['gxp', 'gmp', 'glp', 'good manufacturing practice'],
      
      // Medical Devices
      ['medical devices', 'medtech', 'medical device software'],
      ['fda 510k', '510k clearance', 'premarket notification'],
      ['pma', 'premarket approval'],
      ['udi', 'unique device identification'],
      ['iso 13485', 'medical device quality'],
      ['iec 62304', 'medical device software lifecycle'],
    ],
  },

  'data-analytics': {
    name: 'Data & Analytics',
    description: 'Data engineering, analytics, business intelligence, and data science',
    skills: [
      // Data Warehousing
      ['data warehouse', 'data warehousing', 'dwh', 'enterprise data warehouse'],
      ['dimensional modeling', 'star schema', 'kimball methodology'],
      ['snowflake schema', 'normalized schema'],
      ['data vault', 'data vault 2.0', 'dan linstedt'],
      ['slowly changing dimensions', 'scd', 'scd type 2'],
      ['fact table', 'fact tables', 'factless fact'],
      ['dimension table', 'dimension tables', 'conformed dimensions'],
      
      // Data Platforms
      ['snowflake', 'snowflake data cloud', 'snowpark'],
      ['databricks', 'databricks lakehouse', 'delta lake'],
      ['bigquery', 'google bigquery', 'bq'],
      ['redshift', 'amazon redshift', 'redshift spectrum'],
      ['synapse analytics', 'azure synapse', 'synapse'],
      ['teradata', 'teradata vantage'],
      ['vertica', 'micro focus vertica'],
      ['clickhouse', 'click house'],
      ['dremio', 'dremio data lake'],
      ['firebolt', 'firebolt db'],
      
      // Data Transformation
      ['dbt', 'data build tool', 'dbt core', 'dbt cloud'],
      ['etl', 'extract transform load', 'elt'],
      ['data pipeline', 'data pipelines', 'pipeline orchestration'],
      ['apache airflow', 'airflow', 'airflow dag'],
      ['prefect', 'prefect orchestration'],
      ['dagster', 'dagster io'],
      ['mage', 'mage ai'],
      ['fivetran', 'fivetran connector'],
      ['airbyte', 'airbyte sync'],
      ['stitch', 'stitch data'],
      ['talend', 'talend etl'],
      ['informatica', 'informatica powercenter'],
      ['matillion', 'matillion etl'],
      
      // Business Intelligence
      ['tableau', 'tableau desktop', 'tableau server', 'tableau online'],
      ['power bi', 'powerbi', 'microsoft power bi', 'power bi desktop'],
      ['looker', 'looker studio', 'google looker', 'lookml'],
      ['metabase', 'metabase bi'],
      ['apache superset', 'superset'],
      ['sisense', 'sisense bi'],
      ['qlik', 'qlik sense', 'qlikview'],
      ['mode analytics', 'mode'],
      ['thoughtspot', 'thoughtspot bi'],
      ['domo', 'domo bi'],
      
      // Data Governance
      ['data governance', 'data stewardship', 'data ownership'],
      ['data quality', 'dq', 'data quality management'],
      ['data catalog', 'data discovery', 'data cataloging'],
      ['data lineage', 'lineage tracking'],
      ['metadata management', 'metadata', 'technical metadata'],
      ['master data management', 'mdm', 'master data'],
      ['great expectations', 'ge', 'data validation'],
      ['monte carlo', 'monte carlo data', 'data observability'],
      ['atlan', 'atlan catalog'],
      ['collibra', 'collibra governance'],
      ['alation', 'alation catalog'],
      ['datahub', 'linkedin datahub'],
      
      // Analytics Concepts
      ['olap', 'online analytical processing', 'olap cube'],
      ['oltp', 'online transaction processing'],
      ['data lake', 'data lakehouse', 'lakehouse architecture'],
      ['data mesh', 'data mesh architecture', 'domain-driven data'],
      ['data fabric', 'data fabric architecture'],
      ['real-time analytics', 'streaming analytics'],
      ['self-service analytics', 'self-service bi'],
    ],
  },

  design: {
    name: 'UI/UX Design',
    description: 'User interface, user experience, product design, and research',
    skills: [
      // Design Tools
      ['figma', 'figma design', 'figma prototype', 'figjam'],
      ['sketch', 'sketch app', 'sketch design'],
      ['adobe xd', 'xd', 'experience design'],
      ['framer', 'framer motion', 'framer web'],
      ['webflow', 'webflow design'],
      ['principle', 'principle app', 'principle animation'],
      ['invision', 'invision app', 'invision studio'],
      ['zeplin', 'zeplin handoff'],
      ['abstract', 'abstract design'],
      ['avocode', 'avocode design'],
      ['miro', 'miro board', 'miro whiteboard'],
      ['figjam', 'fig jam'],
      
      // Adobe Suite
      ['adobe creative suite', 'adobe cc', 'creative cloud'],
      ['adobe illustrator', 'illustrator', 'ai'],
      ['adobe photoshop', 'photoshop', 'ps'],
      ['adobe after effects', 'after effects', 'ae'],
      ['adobe premiere', 'premiere pro', 'premiere'],
      ['adobe indesign', 'indesign', 'id'],
      ['adobe lightroom', 'lightroom', 'lr'],
      ['adobe animate', 'animate', 'flash'],
      
      // Design Disciplines
      ['user experience', 'ux', 'ux design'],
      ['user interface', 'ui', 'ui design'],
      ['interaction design', 'ixd', 'interaction designer'],
      ['visual design', 'visual designer'],
      ['product design', 'product designer'],
      ['service design', 'service designer'],
      ['experience design', 'xd'],
      ['motion design', 'animation design', 'micro-interactions'],
      ['information architecture', 'ia', 'content strategy'],
      
      // Research & Strategy
      ['user research', 'ux research', 'usability testing'],
      ['usability testing', 'usability studies', 'user testing'],
      ['a/b testing', 'ab testing', 'split testing'],
      ['heuristic evaluation', 'heuristic analysis'],
      ['card sorting', 'card sort'],
      ['tree testing', 'tree test'],
      ['persona development', 'user personas', 'personas'],
      ['customer journey mapping', 'journey map', 'user journey'],
      ['design thinking', 'design sprint', 'human-centered design', 'hcd'],
      ['jobs to be done', 'jtbd', 'outcome-driven innovation'],
      
      // Design Systems
      ['design systems', 'component library', 'pattern library'],
      ['atomic design', 'atomic design system'],
      ['style guide', 'brand guidelines', 'design guidelines'],
      ['design tokens', 'design token'],
      ['component documentation', 'storybook', 'design documentation'],
      
      // Prototyping
      ['prototyping', 'rapid prototyping', 'wireframing'],
      ['low-fidelity prototype', 'lo-fi', 'low fidelity'],
      ['high-fidelity prototype', 'hi-fi', 'high fidelity'],
      ['interactive prototype', 'clickable prototype'],
      ['responsive design', 'responsive web design', 'rwd'],
      ['mobile-first design', 'mobile first'],
      
      // Accessibility
      ['accessibility', 'a11y', 'web accessibility'],
      ['wcag', 'wcag 2.1', 'web content accessibility guidelines'],
      ['aria', 'wai-aria', 'accessible rich internet applications'],
      ['screen reader', 'screen reader testing', 'voiceover', 'nvda'],
      ['inclusive design', 'universal design'],
    ],
  },

  'devops-platform': {
    name: 'DevOps & Platform Engineering',
    description: 'Infrastructure, CI/CD, observability, and developer platforms',
    skills: [
      // Container Orchestration
      ['kubernetes', 'k8s', 'kube', 'container orchestration'],
      ['helm', 'helm charts', 'helm package'],
      ['kustomize', 'kustomization'],
      ['openshift', 'red hat openshift', 'ocp'],
      ['rancher', 'rancher kubernetes'],
      ['k3s', 'lightweight kubernetes'],
      ['kind', 'kubernetes in docker'],
      ['minikube', 'mini kube'],
      ['eks', 'amazon eks', 'elastic kubernetes service'],
      ['aks', 'azure kubernetes service'],
      ['gke', 'google kubernetes engine'],
      
      // Service Mesh & Networking
      ['istio', 'istio service mesh'],
      ['envoy proxy', 'envoy'],
      ['linkerd', 'linkerd service mesh'],
      ['consul', 'hashicorp consul', 'consul connect'],
      ['nginx', 'nginx ingress', 'nginx proxy'],
      ['traefik', 'traefik proxy'],
      ['haproxy', 'ha proxy', 'load balancer'],
      ['kong', 'kong gateway', 'kong api gateway'],
      
      // GitOps & CD
      ['argocd', 'argo cd', 'argo', 'gitops'],
      ['flux', 'fluxcd', 'flux cd'],
      ['spinnaker', 'spinnaker cd'],
      ['tekton', 'tekton pipelines'],
      ['gitops', 'git ops'],
      
      // Infrastructure as Code
      ['terraform', 'hashicorp terraform', 'tf'],
      ['pulumi', 'pulumi iac'],
      ['ansible', 'ansible playbook', 'ansible automation'],
      ['chef', 'chef infra'],
      ['puppet', 'puppet enterprise'],
      ['saltstack', 'salt', 'salt master'],
      ['crossplane', 'crossplane kubernetes'],
      ['cloudformation', 'aws cloudformation', 'cfn'],
      ['arm templates', 'azure resource manager'],
      ['bicep', 'azure bicep'],
      ['cdk', 'aws cdk', 'cloud development kit'],
      ['cdktf', 'cdk for terraform'],
      
      // CI/CD
      ['jenkins', 'jenkins pipeline', 'jenkinsfile'],
      ['github actions', 'gh actions', 'github workflows'],
      ['gitlab ci', 'gitlab ci/cd', 'gitlab pipelines'],
      ['circleci', 'circle ci'],
      ['travis ci', 'travisci'],
      ['azure devops', 'azure pipelines'],
      ['buildkite', 'buildkite ci'],
      ['drone ci', 'drone'],
      ['concourse', 'concourse ci'],
      
      // Observability
      ['prometheus', 'prometheus monitoring'],
      ['grafana', 'grafana dashboards', 'grafana loki'],
      ['datadog', 'datadog apm', 'dd'],
      ['new relic', 'newrelic', 'new relic apm'],
      ['splunk', 'splunk enterprise', 'splunk cloud'],
      ['elastic stack', 'elk stack', 'elasticsearch logstash kibana'],
      ['jaeger', 'jaeger tracing'],
      ['zipkin', 'zipkin tracing'],
      ['opentelemetry', 'otel', 'opentelemetry collector'],
      ['loki', 'grafana loki'],
      ['tempo', 'grafana tempo'],
      ['mimir', 'grafana mimir'],
      
      // Platform Engineering
      ['platform engineering', 'internal developer platform', 'idp'],
      ['backstage', 'spotify backstage', 'backstage.io'],
      ['port', 'port.io', 'port internal developer portal'],
      ['kratix', 'kratix platform'],
      ['humanitec', 'humanitec platform'],
      
      // Reliability
      ['site reliability engineering', 'sre', 'site reliability'],
      ['chaos engineering', 'chaos monkey', 'litmus chaos', 'chaos mesh'],
      ['incident management', 'incident response', 'on-call'],
      ['pagerduty', 'pager duty'],
      ['opsgenie', 'ops genie'],
      ['victorops', 'victor ops'],
      ['statuspage', 'status page'],
      ['runbook', 'runbooks', 'runbook automation'],
      ['postmortem', 'blameless postmortem', 'incident review'],
      ['error budget', 'error budgets', 'slo'],
      ['service level objective', 'slo', 'sli', 'sla'],
      
      // Deployment Strategies
      ['blue-green deployment', 'blue green', 'blue/green'],
      ['canary deployment', 'canary release', 'progressive delivery'],
      ['rolling deployment', 'rolling update'],
      ['feature flags', 'feature toggles', 'launchdarkly', 'split.io'],
      ['dark launch', 'dark launching'],
      ['a/b deployment', 'ab deployment'],
      
      // Secrets & Security
      ['vault', 'hashicorp vault', 'secrets management'],
      ['external secrets', 'external secrets operator'],
      ['sealed secrets', 'bitnami sealed secrets'],
      ['sops', 'mozilla sops'],
      ['cert-manager', 'cert manager', 'certificate management'],
    ],
  },

  'game-development': {
    name: 'Game Development',
    description: 'Game engines, graphics, audio, and game design',
    skills: [
      // Game Engines
      ['unity', 'unity3d', 'unity engine', 'unity game engine'],
      ['unreal engine', 'ue5', 'ue4', 'unreal', 'blueprints'],
      ['godot', 'godot engine', 'gdscript'],
      ['cryengine', 'cry engine'],
      ['source engine', 'source 2'],
      ['gamemaker', 'game maker', 'gms2'],
      ['rpg maker', 'rpgmaker'],
      ['construct', 'construct 3'],
      ['phaser', 'phaser.js', 'phaser 3'],
      ['defold', 'defold engine'],
      
      // Graphics APIs
      ['opengl', 'open gl', 'opengl es'],
      ['vulkan', 'vulkan api'],
      ['directx', 'direct3d', 'dx12', 'dx11'],
      ['metal', 'apple metal'],
      ['webgl', 'web gl', 'webgl2'],
      ['webgpu', 'web gpu'],
      
      // Shaders
      ['shader programming', 'shaders', 'shader development'],
      ['glsl', 'opengl shading language'],
      ['hlsl', 'high-level shading language'],
      ['shader graph', 'visual shaders'],
      ['compute shaders', 'compute shader'],
      ['ray tracing', 'rtx', 'dxr'],
      
      // Game Systems
      ['game design', 'game mechanics', 'gameplay design'],
      ['level design', 'level designer', 'world building'],
      ['procedural generation', 'pcg', 'procedural content'],
      ['physics engine', 'game physics', 'rigidbody'],
      ['collision detection', 'collision system'],
      ['pathfinding', 'a* algorithm', 'navigation mesh', 'navmesh'],
      ['ai behavior', 'game ai', 'behavior tree', 'fsm'],
      ['animation system', 'skeletal animation', 'animation blending'],
      ['particle system', 'particle effects', 'vfx'],
      
      // Audio
      ['game audio', 'audio programming'],
      ['fmod', 'fmod studio'],
      ['wwise', 'audiokinetic wwise'],
      ['spatial audio', '3d audio', 'binaural audio'],
      
      // Multiplayer
      ['multiplayer networking', 'game networking', 'netcode'],
      ['photon', 'photon pun', 'photon fusion'],
      ['mirror networking', 'mirror'],
      ['fishnet', 'fish-networking'],
      ['steamworks', 'steam api', 'steam sdk'],
      ['playfab', 'azure playfab'],
      ['gamesparks', 'game sparks'],
      ['nakama', 'heroic labs nakama'],
    ],
  },

  cybersecurity: {
    name: 'Cybersecurity',
    description: 'Security operations, penetration testing, and compliance',
    skills: [
      // Security Operations
      ['siem', 'security information and event management'],
      ['soc', 'security operations center'],
      ['soar', 'security orchestration automation response'],
      ['edr', 'endpoint detection and response', 'endpoint security'],
      ['xdr', 'extended detection and response'],
      ['mdr', 'managed detection and response'],
      ['threat detection', 'threat hunting', 'threat intelligence'],
      ['incident response', 'ir', 'security incident'],
      ['digital forensics', 'forensic analysis', 'dfir'],
      ['malware analysis', 'reverse engineering', 'malware reverse'],
      
      // Penetration Testing
      ['penetration testing', 'pentest', 'pentesting', 'ethical hacking'],
      ['vulnerability assessment', 'vuln assessment', 'vulnerability scan'],
      ['red team', 'red teaming'],
      ['blue team', 'blue teaming'],
      ['purple team', 'purple teaming'],
      ['bug bounty', 'bug bounty hunting'],
      ['ctf', 'capture the flag'],
      
      // Security Tools
      ['burp suite', 'burp', 'portswigger'],
      ['metasploit', 'msf', 'metasploit framework'],
      ['nmap', 'network mapper'],
      ['wireshark', 'packet analysis'],
      ['nessus', 'tenable nessus'],
      ['qualys', 'qualys guard'],
      ['snort', 'snort ids'],
      ['suricata', 'suricata ids'],
      ['ossec', 'ossec hids'],
      ['crowdstrike', 'crowdstrike falcon'],
      ['splunk', 'splunk siem'],
      ['qradar', 'ibm qradar'],
      ['sentinel', 'microsoft sentinel', 'azure sentinel'],
      ['elastic security', 'elastic siem'],
      
      // Identity & Access
      ['identity and access management', 'iam', 'identity management'],
      ['single sign-on', 'sso'],
      ['multi-factor authentication', 'mfa', '2fa', 'two-factor'],
      ['privileged access management', 'pam'],
      ['zero trust', 'zero trust architecture', 'ztna'],
      ['oauth', 'oauth2', 'oauth 2.0'],
      ['saml', 'saml 2.0'],
      ['openid connect', 'oidc'],
      ['ldap', 'active directory'],
      ['okta', 'okta identity'],
      ['auth0', 'auth zero'],
      ['ping identity', 'pingfederate'],
      
      // Cloud Security
      ['cloud security', 'cloud sec'],
      ['cspm', 'cloud security posture management'],
      ['cwpp', 'cloud workload protection'],
      ['cnapp', 'cloud native application protection'],
      ['casb', 'cloud access security broker'],
      ['devsecops', 'dev sec ops', 'security automation'],
      ['container security', 'kubernetes security'],
      ['infrastructure security', 'network security'],
      
      // Compliance & Frameworks
      ['nist', 'nist cybersecurity framework', 'nist csf'],
      ['iso 27001', 'iso27001', 'isms'],
      ['soc 2', 'soc2', 'soc 2 type 2'],
      ['cis controls', 'cis benchmarks'],
      ['mitre att&ck', 'mitre attack', 'attack framework'],
      ['owasp', 'owasp top 10'],
      ['pci dss', 'pci compliance'],
      ['fedramp', 'fed ramp'],
      ['cmmc', 'cybersecurity maturity model'],
    ],
  },

  blockchain: {
    name: 'Blockchain & Web3',
    description: 'Distributed ledger, smart contracts, and decentralized applications',
    skills: [
      // Platforms
      ['ethereum', 'eth', 'ethereum network'],
      ['solana', 'sol', 'solana blockchain'],
      ['polygon', 'matic', 'polygon network'],
      ['avalanche', 'avax'],
      ['binance smart chain', 'bsc', 'bnb chain'],
      ['cardano', 'ada'],
      ['polkadot', 'dot'],
      ['cosmos', 'atom', 'cosmos sdk'],
      ['near protocol', 'near'],
      ['arbitrum', 'arbitrum one'],
      ['optimism', 'op mainnet'],
      ['base', 'base chain'],
      ['hyperledger fabric', 'hyperledger', 'hlf'],
      
      // Smart Contracts
      ['solidity', 'solidity programming'],
      ['rust smart contracts', 'anchor', 'solana rust'],
      ['vyper', 'vyper lang'],
      ['move', 'move language'],
      ['cairo', 'starknet cairo'],
      ['smart contracts', 'smart contract development'],
      ['erc-20', 'erc20', 'token standard'],
      ['erc-721', 'erc721', 'nft standard'],
      ['erc-1155', 'erc1155', 'multi-token'],
      
      // Development Tools
      ['hardhat', 'hardhat ethereum'],
      ['foundry', 'forge', 'foundry toolkit'],
      ['truffle', 'truffle suite'],
      ['remix', 'remix ide'],
      ['wagmi', 'wagmi hooks'],
      ['ethers.js', 'ethersjs'],
      ['web3.js', 'web3js'],
      ['viem', 'viem typescript'],
      ['alchemy', 'alchemy api'],
      ['infura', 'infura api'],
      ['moralis', 'moralis api'],
      ['thegraph', 'the graph', 'subgraph'],
      ['chainlink', 'chainlink oracle'],
      
      // DeFi
      ['decentralized finance', 'defi'],
      ['automated market maker', 'amm', 'dex'],
      ['liquidity pool', 'liquidity mining'],
      ['yield farming', 'yield optimization'],
      ['lending protocol', 'defi lending'],
      ['flash loans', 'flash loan'],
      ['mev', 'maximal extractable value'],
      ['uniswap', 'uniswap v3'],
      ['aave', 'aave protocol'],
      ['compound', 'compound finance'],
      
      // Security & Auditing
      ['smart contract audit', 'code audit', 'security audit'],
      ['slither', 'slither analyzer'],
      ['mythril', 'mythril security'],
      ['echidna', 'echidna fuzzing'],
    ],
  },

  'iot-embedded': {
    name: 'IoT & Embedded Systems',
    description: 'Internet of Things, embedded programming, and hardware',
    skills: [
      // Microcontrollers
      ['arduino', 'arduino uno', 'arduino mega', 'arduino ide'],
      ['raspberry pi', 'rpi', 'raspi', 'raspberry pi os'],
      ['esp32', 'esp8266', 'espressif', 'esp-idf'],
      ['stm32', 'stm32cube', 'stmicroelectronics'],
      ['arm cortex', 'arm cortex-m', 'arm microcontroller'],
      ['avr', 'avr microcontroller', 'atmega'],
      ['pic', 'pic microcontroller', 'microchip'],
      ['nordic nrf', 'nrf52', 'nordic semiconductor'],
      ['teensy', 'pjrc teensy'],
      ['particle', 'particle photon', 'particle argon'],
      
      // Operating Systems
      ['rtos', 'real-time operating system', 'real time os'],
      ['freertos', 'free rtos'],
      ['zephyr', 'zephyr rtos'],
      ['riot os', 'riot'],
      ['mbed os', 'arm mbed'],
      ['nuttx', 'apache nuttx'],
      ['vxworks', 'wind river vxworks'],
      ['qnx', 'blackberry qnx'],
      ['embedded linux', 'yocto', 'buildroot'],
      
      // Communication Protocols
      ['uart', 'universal asynchronous receiver-transmitter', 'serial communication'],
      ['spi', 'serial peripheral interface'],
      ['i2c', 'inter-integrated circuit', 'iic', 'twi'],
      ['can bus', 'can protocol', 'controller area network'],
      ['modbus', 'modbus rtu', 'modbus tcp'],
      ['rs-485', 'rs485', 'serial bus'],
      ['rs-232', 'rs232', 'serial port'],
      ['ethernet', 'embedded ethernet'],
      ['usb', 'usb protocol', 'usb device'],
      
      // Wireless
      ['bluetooth', 'ble', 'bluetooth low energy'],
      ['zigbee', 'zigbee protocol'],
      ['z-wave', 'zwave'],
      ['lora', 'lorawan', 'long range'],
      ['nb-iot', 'narrowband iot'],
      ['lte-m', 'lte cat-m1'],
      ['thread', 'thread protocol'],
      ['matter', 'matter protocol'],
      ['wifi', 'wi-fi', 'wireless lan'],
      ['nfc', 'near field communication'],
      
      // IoT Platforms
      ['aws iot', 'aws iot core', 'amazon iot'],
      ['azure iot', 'azure iot hub', 'azure iot central'],
      ['google cloud iot', 'cloud iot core'],
      ['aws greengrass', 'greengrass'],
      ['home assistant', 'hass'],
      ['thingsboard', 'things board'],
      ['node-red', 'node red', 'nodered'],
      
      // Embedded Programming
      ['embedded c', 'embedded c++'],
      ['firmware development', 'firmware', 'fw development'],
      ['bare metal', 'bare metal programming'],
      ['dma', 'direct memory access'],
      ['interrupt handling', 'isr', 'interrupt service routine'],
      ['memory management', 'heap management', 'stack management'],
      ['low-power design', 'power optimization', 'sleep modes'],
      ['bootloader', 'bootloader development'],
      ['ota update', 'over-the-air update', 'firmware update'],
    ],
  },

  'ai-ml': {
    name: 'AI & Machine Learning',
    description: 'Artificial intelligence, machine learning, and deep learning',
    skills: [
      // Frameworks
      ['tensorflow', 'tf', 'tensorflow 2'],
      ['pytorch', 'torch', 'pytorch lightning'],
      ['keras', 'keras api'],
      ['scikit-learn', 'sklearn', 'scikit'],
      ['jax', 'google jax'],
      ['mxnet', 'apache mxnet'],
      ['caffe', 'caffe2'],
      ['onnx', 'open neural network exchange'],
      ['mlflow', 'ml flow'],
      ['kubeflow', 'kube flow'],
      ['ray', 'ray tune', 'ray serve'],
      
      // Deep Learning
      ['deep learning', 'dl', 'neural networks'],
      ['convolutional neural network', 'cnn', 'convnet'],
      ['recurrent neural network', 'rnn', 'lstm', 'gru'],
      ['transformer', 'transformer architecture', 'attention mechanism'],
      ['generative adversarial network', 'gan', 'gans'],
      ['variational autoencoder', 'vae'],
      ['diffusion models', 'stable diffusion', 'ddpm'],
      
      // NLP
      ['natural language processing', 'nlp'],
      ['hugging face', 'huggingface', 'hf', 'transformers library'],
      ['bert', 'bert model', 'bidirectional encoder'],
      ['gpt', 'generative pre-trained transformer'],
      ['t5', 'text-to-text transfer transformer'],
      ['spacy', 'spacy nlp'],
      ['nltk', 'natural language toolkit'],
      ['word embeddings', 'word2vec', 'glove'],
      ['sentiment analysis', 'sentiment classification'],
      ['named entity recognition', 'ner'],
      ['text classification', 'document classification'],
      ['question answering', 'qa system'],
      ['machine translation', 'neural machine translation', 'nmt'],
      
      // Computer Vision
      ['computer vision', 'cv', 'image processing'],
      ['opencv', 'open cv', 'cv2'],
      ['object detection', 'yolo', 'faster rcnn'],
      ['image segmentation', 'semantic segmentation', 'instance segmentation'],
      ['image classification', 'image recognition'],
      ['face recognition', 'facial recognition', 'face detection'],
      ['ocr', 'optical character recognition', 'text detection'],
      ['pose estimation', 'keypoint detection'],
      
      // LLMs & GenAI
      ['large language models', 'llm', 'llms'],
      ['generative ai', 'genai', 'gen ai'],
      ['prompt engineering', 'prompt design'],
      ['retrieval augmented generation', 'rag'],
      ['fine-tuning', 'model fine-tuning', 'instruction tuning'],
      ['rlhf', 'reinforcement learning human feedback'],
      ['langchain', 'lang chain'],
      ['llamaindex', 'llama index'],
      ['semantic search', 'vector search'],
      ['embeddings', 'text embeddings', 'vector embeddings'],
      ['vector database', 'vector db', 'pinecone', 'weaviate', 'milvus', 'qdrant'],
      
      // MLOps
      ['mlops', 'machine learning operations', 'ml operations'],
      ['model deployment', 'model serving'],
      ['model monitoring', 'ml monitoring'],
      ['feature store', 'feature engineering'],
      ['experiment tracking', 'ml experiments'],
      ['data versioning', 'dvc', 'data version control'],
      ['model registry', 'model versioning'],
      ['a/b testing ml', 'model a/b testing'],
      
      // AutoML & Tools
      ['automl', 'automated machine learning'],
      ['hyperparameter tuning', 'hyperopt', 'optuna'],
      ['weights and biases', 'wandb', 'w&b'],
      ['neptune', 'neptune.ai'],
      ['comet', 'comet ml'],
      ['sagemaker', 'aws sagemaker'],
      ['vertex ai', 'google vertex ai'],
      ['azure ml', 'azure machine learning'],
    ],
  },

  ecommerce: {
    name: 'E-commerce & Retail',
    description: 'Online retail platforms, payments, and commerce systems',
    skills: [
      // Platforms
      ['shopify', 'shopify plus', 'shopify api', 'liquid'],
      ['magento', 'adobe commerce', 'magento 2'],
      ['woocommerce', 'woo commerce', 'woo'],
      ['bigcommerce', 'big commerce'],
      ['salesforce commerce cloud', 'sfcc', 'demandware'],
      ['sap commerce', 'hybris', 'sap commerce cloud'],
      ['oracle commerce', 'atg'],
      ['prestashop', 'presta shop'],
      ['opencart', 'open cart'],
      ['medusa', 'medusajs'],
      ['vendure', 'vendure commerce'],
      ['saleor', 'saleor commerce'],
      
      // Headless Commerce
      ['headless commerce', 'composable commerce'],
      ['commercetools', 'commerce tools'],
      ['elasticpath', 'elastic path'],
      ['fabric', 'fabric commerce'],
      ['nacelle', 'nacelle commerce'],
      
      // Features
      ['product catalog', 'catalog management', 'pim'],
      ['inventory management', 'stock management'],
      ['order management', 'oms', 'order management system'],
      ['shopping cart', 'cart management'],
      ['checkout', 'checkout flow', 'one-page checkout'],
      ['product recommendation', 'recommendation engine'],
      ['search and discovery', 'product search', 'algolia'],
      ['personalization', 'dynamic content', 'customer personalization'],
      ['pricing engine', 'dynamic pricing'],
      ['promotion engine', 'discount management'],
    ],
  },

  legal: {
    name: 'Legal & Compliance',
    description: 'Legal technology, contract management, and regulatory compliance',
    skills: [
      // Legal Tech
      ['legal tech', 'legaltech', 'legal technology'],
      ['contract management', 'clm', 'contract lifecycle management'],
      ['e-discovery', 'ediscovery', 'electronic discovery'],
      ['legal research', 'case research'],
      ['document automation', 'legal document automation'],
      ['legal ai', 'legal analytics'],
      ['matter management', 'case management'],
      
      // Platforms
      ['docusign', 'docu sign', 'e-signature'],
      ['ironclad', 'ironclad contracts'],
      ['clio', 'clio legal'],
      ['relativity', 'relativity ediscovery'],
      ['logikcull', 'logikcull ediscovery'],
      ['westlaw', 'west law'],
      ['lexisnexis', 'lexis nexis'],
      
      // Compliance
      ['regulatory compliance', 'compliance management'],
      ['sox compliance', 'sarbanes oxley'],
      ['gdpr compliance', 'data protection'],
      ['ccpa', 'california consumer privacy act'],
      ['hipaa compliance', 'healthcare compliance'],
      ['aml compliance', 'anti-money laundering'],
      ['know your customer', 'kyc'],
      ['sanctions compliance', 'ofac'],
      ['third-party risk', 'vendor risk management'],
      ['audit management', 'internal audit'],
      ['policy management', 'policy lifecycle'],
      ['grc', 'governance risk compliance'],
    ],
  },
};

function buildCandidates(): CandidateEntry[] {
  const candidates: CandidateEntry[] = [];
  
  for (const [verticalKey, vertical] of Object.entries(VERTICALS)) {
    // Apply filter if specified
    if (VERTICAL_FILTER && !verticalKey.toLowerCase().includes(VERTICAL_FILTER.toLowerCase())) {
      continue;
    }
    
    for (const skill of vertical.skills) {
      const [canonical, ...aliases] = skill;
      
      candidates.push({
        canonical: canonical.toLowerCase(),
        aliases,
        source: 'industry-vertical',
        category: `${vertical.name}`,
      });
    }
  }
  
  return candidates;
}

// Main execution
console.log('[verticals-enhanced] Building comprehensive industry vertical skills...\n');

const candidates = buildCandidates();

// Summary by vertical
const byVertical = new Map<string, number>();
for (const c of candidates) {
  const current = byVertical.get(c.category!) ?? 0;
  byVertical.set(c.category!, current + 1);
}

console.log('Skills by vertical:');
for (const [vertical, count] of [...byVertical.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(4)}: ${vertical}`);
}

console.log(`\nTotal vertical skills: ${candidates.length}`);

// Save candidates to JSON for merge-all script
import * as fs from 'node:fs';
import * as path from 'node:path';

const dataDir = path.join(__dirname, 'data', 'verticals');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
fs.writeFileSync(
  path.join(dataDir, 'candidates.json'),
  JSON.stringify(candidates, null, 2)
);

reportAndApply(candidates, 'verticals-enhanced');
