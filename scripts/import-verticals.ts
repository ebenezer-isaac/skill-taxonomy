/**
 * Import curated industry-vertical skill lists.
 *
 * These are hand-curated skills that are common in specific industries
 * but often missing from general-purpose tech taxonomies.
 *
 * Usage:
 *   tsx scripts/import-verticals.ts          # dry run
 *   tsx scripts/import-verticals.ts --apply  # write to taxonomy
 */
import { reportAndApply, type CandidateEntry } from './common';

const VERTICALS: Record<string, Record<string, string[]>> = {
  finance: {
    'bloomberg terminal': ['bloomberg', 'bbg'],
    'kdb+': ['kdb', 'kx'],
    'fix protocol': ['fix', 'financial information exchange'],
    'quantitative analysis': ['quant', 'quantitative finance', 'quant finance'],
    'risk management': ['risk analysis', 'risk assessment'],
    'kyc': ['know your customer'],
    'aml': ['anti-money laundering'],
    'regulatory compliance': ['compliance', 'finreg'],
    'algorithmic trading': ['algo trading', 'automated trading'],
    'payment processing': ['payment gateway', 'payments'],
    'swift messaging': ['swift mt', 'swift mx', 'iso 20022'],
    'plaid': ['plaid api'],
    'stripe': ['stripe api', 'stripe payments'],
  },
  healthcare: {
    'hl7': ['health level 7', 'hl7 fhir'],
    'fhir': ['fast healthcare interoperability resources'],
    'hipaa': ['hipaa compliance', 'health insurance portability'],
    'epic systems': ['epic ehr', 'epic'],
    'ehr': ['electronic health records', 'emr', 'electronic medical records'],
    'dicom': ['digital imaging and communications in medicine'],
    'icd-10': ['icd coding', 'icd-10-cm'],
    'clinical trials': ['clinical research', 'clinical data management'],
    'pharma': ['pharmaceutical', 'drug development'],
    'medical devices': ['medtech', 'medical device software'],
  },
  'data & analytics': {
    'dbt': ['data build tool'],
    'looker': ['looker studio', 'google looker'],
    'tableau': ['tableau desktop', 'tableau server'],
    'power bi': ['powerbi', 'microsoft power bi'],
    'metabase': [],
    'data warehouse': ['data warehousing', 'dwh'],
    'data lake': ['data lakehouse', 'delta lake'],
    'data mesh': [],
    'data governance': ['data quality', 'data stewardship'],
    'apache superset': ['superset'],
    'dimensional modeling': ['star schema', 'kimball'],
    'data catalog': ['data discovery'],
    'great expectations': ['ge', 'data validation'],
  },
  design: {
    'framer': ['framer motion'],
    'webflow': [],
    'principle': ['principle app'],
    'prototyping': ['rapid prototyping', 'wireframing'],
    'design systems': ['component library', 'pattern library'],
    'motion design': ['animation design', 'micro-interactions'],
    'user research': ['ux research', 'usability testing'],
    'information architecture': ['ia', 'content strategy'],
    'adobe creative suite': ['adobe cc', 'creative cloud'],
    'adobe illustrator': ['illustrator', 'ai'],
    'adobe photoshop': ['photoshop', 'ps'],
    'invision': ['invision app'],
    'zeplin': [],
    'miro': ['miro board'],
  },
  'devops & platform': {
    'istio': ['istio service mesh'],
    'envoy proxy': ['envoy'],
    'linkerd': [],
    'service mesh': [],
    'chaos engineering': ['chaos monkey', 'litmus chaos'],
    'feature flags': ['feature toggles', 'launchdarkly'],
    'crossplane': [],
    'gitops': ['git ops'],
    'platform engineering': ['internal developer platform', 'idp'],
    'site reliability engineering': ['sre'],
    'incident management': ['incident response', 'on-call'],
    'load balancing': ['load balancer', 'nginx', 'haproxy'],
    'cdn': ['content delivery network', 'edge computing'],
    'vault': ['hashicorp vault', 'secrets management'],
  },
  'game development': {
    'unity': ['unity3d', 'unity engine'],
    'unreal engine': ['ue5', 'ue4', 'unreal'],
    'godot': ['godot engine'],
    'opengl': ['open gl'],
    'vulkan': ['vulkan api'],
    'directx': ['direct3d', 'dx12'],
    'game design': ['game mechanics', 'level design'],
    'shader programming': ['glsl', 'hlsl', 'shader'],
  },
};

function buildCandidates(): CandidateEntry[] {
  const candidates: CandidateEntry[] = [];

  for (const [vertical, skills] of Object.entries(VERTICALS)) {
    for (const [canonical, aliases] of Object.entries(skills)) {
      candidates.push({
        canonical,
        aliases,
        source: 'industry-vertical',
        category: vertical,
      });
    }
  }

  return candidates;
}

const candidates = buildCandidates();
reportAndApply(candidates, 'industry-verticals');
