import type { Record as Neo4jRecord } from 'neo4j-driver';
import type { SkillDTO } from '../types/index.js';

/** Extract a Skill node from a Neo4j record and map to a plain DTO */
export function mapSkillNode(record: Neo4jRecord, key = 's'): SkillDTO {
  const node = record.get(key);
  const p = node.properties;

  return Object.freeze({
    canonicalName: p.canonicalName ?? '',
    description: p.description ?? '',
    aliases: toStringArray(p.aliases),
    category: p.category ?? '',
    parentCategory: p.parentCategory ?? '',
    skillType: p.skillType ?? '',
    ecosystem: p.ecosystem ?? '',
    senioritySignal: p.senioritySignal ?? '',
    trendDirection: p.trendDirection ?? '',
    demandLevel: p.demandLevel ?? '',
    confidence: p.confidence ?? 'pending',
    isValidSkill: p.isValidSkill ?? true,
    isOpenSource: p.isOpenSource ?? null,
    isRegionSpecific: p.isRegionSpecific ?? null,
    learningDifficulty: p.learningDifficulty ?? '',
    typicalExperienceYears: p.typicalExperienceYears ?? '',
    salaryImpact: p.salaryImpact ?? '',
    automationRisk: p.automationRisk ?? '',
    communitySize: p.communitySize ?? '',
    emergingYear: toIntOrNull(p.emergingYear),
    sources: toStringArray(p.sources),
    keywords: toStringArray(p.keywords),
    commonJobTitles: toStringArray(p.commonJobTitles),
    certifications: toStringArray(p.certifications),
    unresolvedBroaderTerms: toStringArray(p.unresolvedBroaderTerms),
    unresolvedRelatedSkills: toStringArray(p.unresolvedRelatedSkills),
    unresolvedPrerequisites: toStringArray(p.unresolvedPrerequisites),
    unresolvedComplementarySkills: toStringArray(p.unresolvedComplementarySkills),
  });
}

function toStringArray(val: unknown): readonly string[] {
  if (Array.isArray(val)) return val.map(String);
  return [];
}

function toIntOrNull(val: unknown): number | null {
  if (val == null) return null;
  // Neo4j integers come as Integer objects with .toNumber()
  if (typeof val === 'object' && val !== null && 'toNumber' in val) {
    return (val as { toNumber(): number }).toNumber();
  }
  if (typeof val === 'number') return val;
  return null;
}
