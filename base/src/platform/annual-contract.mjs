import { canonical, fields } from '../protocol/index.mjs';
import { problem } from './db.mjs';
import { validId } from './permissions.mjs';
export const annualSchema = 'hyper-dimension.annual-operations/v1';
export const categories = ['objective', 'academic', 'career', 'life', 'community'];
export const channels = ['event', 'public', 'private'];
export const annualText = (v, min, max) => {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max)
    throw problem('annual_text_invalid');
  return v.trim();
};
export const annualNumber = (v, min, max) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw problem('annual_number_invalid');
  return v;
};
export const annualKey = (v) => {
  if (!validId(v)) throw problem('annual_id_invalid');
  return v;
};
export const annualDate = (v) => {
  if (v === null) return null;
  const m =
    typeof v === 'string' &&
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      v,
    );
  if (
    !m ||
    !Number.isFinite(Date.parse(v)) ||
    Number(m[2]) < 1 ||
    Number(m[2]) > 12 ||
    Number(m[3]) < 1 ||
    Number(m[3]) > new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate() ||
    Number(m[4]) > 23 ||
    Number(m[5]) > 59 ||
    Number(m[6] || 0) > 59
  )
    throw problem('annual_date_invalid');
  return new Date(v).toISOString();
};
export const annualUrl = (v) => {
  if (v === null) return null;
  let u;
  try {
    u = new URL(v);
  } catch {
    throw problem('annual_reference_invalid');
  }
  if (u.protocol !== 'https:' || u.username || u.password || v.length > 2000)
    throw problem('annual_reference_invalid');
  return u.href;
};
export function annualPriority(category, priority, status = 'active') {
  if (priority !== null && !['A', 'B', 'C'].includes(priority))
    throw problem('annual_priority_invalid');
  if (category === 'objective' || status !== 'active') return null;
  return priority;
}
export function annualPeriod(startYear, startMonth, month) {
  annualNumber(startYear, 2000, 2199);
  annualNumber(startMonth, 1, 12);
  annualNumber(month, 1, 12);
  return String(startYear + (month < startMonth ? 1 : 0)) + '-' + String(month).padStart(2, '0');
}
export function validateAnnualDocument(value) {
  const d = fields(
    value,
    [
      'schema',
      'packageId',
      'version',
      'name',
      'sourceLabel',
      'sourceHash',
      'exampleOnly',
      'startMonth',
      'cohorts',
      'references',
      'assumptions',
      'entries',
    ],
    'annual_document',
  );
  if (d.schema !== annualSchema || typeof d.exampleOnly !== 'boolean')
    throw problem('annual_schema_invalid');
  annualKey(d.packageId);
  annualNumber(d.version, 1, 100000);
  annualText(d.name, 2, 160);
  annualText(d.sourceLabel, 3, 300);
  if (d.sourceHash !== null && !/^[a-f0-9]{64}$/.test(d.sourceHash || ''))
    throw problem('annual_source_hash_invalid');
  annualNumber(d.startMonth, 1, 12);
  if (!Array.isArray(d.cohorts) || !d.cohorts.length || d.cohorts.length > 64)
    throw problem('annual_cohorts_invalid');
  const cohorts = new Set();
  for (const x of d.cohorts) {
    fields(x, ['id', 'name'], 'annual_cohort');
    annualKey(x.id);
    annualText(x.name, 1, 100);
    if (cohorts.has(x.id)) throw problem('annual_cohort_duplicate');
    cohorts.add(x.id);
  }
  if (!Array.isArray(d.references) || d.references.length > 100)
    throw problem('annual_references_invalid');
  const refs = new Set();
  for (const x of d.references) {
    fields(x, ['id', 'title', 'url', 'checkedAt', 'scope'], 'annual_reference');
    annualKey(x.id);
    annualText(x.title, 1, 200);
    annualText(x.scope, 0, 2000);
    annualUrl(x.url);
    if (typeof x.checkedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.checkedAt)) {
      if (
        !Number.isFinite(Date.parse(x.checkedAt)) ||
        new Date(x.checkedAt).toISOString().slice(0, 10) !== x.checkedAt
      )
        throw problem('annual_date_invalid');
    } else annualDate(x.checkedAt);
    if (refs.has(x.id)) throw problem('annual_reference_duplicate');
    refs.add(x.id);
  }
  if (!Array.isArray(d.assumptions) || d.assumptions.length > 40)
    throw problem('annual_assumptions_invalid');
  d.assumptions.forEach((x) => annualText(x, 1, 2000));
  if (!Array.isArray(d.entries) || !d.entries.length || d.entries.length > 1500)
    throw problem('annual_entries_invalid');
  const seen = new Set();
  for (const e of d.entries) {
    fields(
      e,
      [
        'entryId',
        'month',
        'cohortIds',
        'category',
        'channel',
        'chainId',
        'title',
        'description',
        'studentNeed',
        'familyNeed',
        'applicability',
        'eventWindow',
        'bestWindow',
        'processWindow',
        'directImpact',
        'downstream',
        'suggestedPriority',
        'sourceRefs',
        'requiresDateVerification',
        'targetBase',
      ],
      'annual_entry',
    );
    annualKey(e.entryId);
    annualKey(e.chainId);
    annualNumber(e.month, 1, 12);
    annualText(e.title, 2, 160);
    if (seen.has(e.entryId)) throw problem('annual_entry_duplicate');
    seen.add(e.entryId);
    for (const k of [
      'description',
      'studentNeed',
      'familyNeed',
      'applicability',
      'eventWindow',
      'bestWindow',
      'processWindow',
      'directImpact',
      'downstream',
    ])
      annualText(e[k], 0, 5000);
    if (
      !categories.includes(e.category) ||
      !channels.includes(e.channel) ||
      ![1, 2, 3, 4].includes(e.targetBase) ||
      typeof e.requiresDateVerification !== 'boolean'
    )
      throw problem('annual_classification_invalid');
    if (
      !Array.isArray(e.cohortIds) ||
      !e.cohortIds.length ||
      new Set(e.cohortIds).size !== e.cohortIds.length ||
      !e.cohortIds.every((x) => cohorts.has(x))
    )
      throw problem('annual_cohort_unknown');
    if (
      !Array.isArray(e.sourceRefs) ||
      new Set(e.sourceRefs).size !== e.sourceRefs.length ||
      !e.sourceRefs.every((x) => refs.has(x))
    )
      throw problem('annual_source_unknown');
    annualPriority(e.category, e.suggestedPriority);
    if (e.category === 'objective' && e.suggestedPriority !== null)
      throw problem('annual_objective_not_rated');
  }
  return JSON.parse(canonical(d));
}
export function annualDiff(old, next) {
  const a = new Map((old?.entries || []).map((x) => [x.entryId, x])),
    b = new Map(next.entries.map((x) => [x.entryId, x]));
  return {
    added: [...b.keys()].filter((x) => !a.has(x)),
    removed: [...a.keys()].filter((x) => !b.has(x)),
    changed: [...b.keys()].filter((x) => a.has(x) && canonical(a.get(x)) !== canonical(b.get(x))),
    metadataChanged:
      canonical(old ? { ...old, entries: [] } : null) !== canonical({ ...next, entries: [] }),
  };
}
