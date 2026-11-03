import { problem } from './db.mjs';
const names = ['base1', 'base2', 'base3', 'base4'];
function validate(input = {}) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.entries(input).some(([k, v]) => !names.includes(k) || typeof v !== 'boolean') ||
    input.base1 === false
  )
    throw problem('module_configuration_invalid');
  return input;
}
export function createModulePolicy(config) {
  const defaults = {
    base1: true,
    base2: Boolean(config.m2Enabled),
    base3: Boolean(config.campusEnabled),
    base4: Boolean(config.partnersEnabled),
  };
  const global = validate(config.modules);
  const governed = new Set(
    config.schools
      .filter((s) => config.campusEnabled || config.modules || s.modules)
      .map((s) => s.schoolId),
  );
  const schools = new Map(
    config.schools.map((s) => [s.schoolId, { ...defaults, ...global, ...validate(s.modules) }]),
  );
  for (const enabled of schools.values())
    for (const key of names)
      if (enabled[key] && !defaults[key]) throw problem('module_not_installed');
  function forSchool(id) {
    const p = schools.get(id);
    if (!p) throw problem('school_missing', 404);
    return { ...p };
  }
  function mutationModule(url) {
    const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (['m2', 'personal', 'contacts'].includes(p[0])) return ['base2', p[2]];
    if (
      [
        'community',
        'activities',
        'ledger',
        'rewards',
        'operations',
        'annual',
        'network',
        'attachments',
        'jobs',
      ].includes(p[0])
    )
      return ['base3', p[2]];
    if (['m5', 'partners'].includes(p[0])) return ['base4', p[2]];
    if (['m0', 'm1'].includes(p[0]) && p[1] === 'schools') {
      const action = p[3] === 'organizations' ? p[5] : p[3];
      if (['forum', 'forum-login'].includes(action)) return ['base3', p[2]];
      if (['avatar', 'social', 'chat', 'contacts', 'blocks', 'reports'].includes(action))
        return ['base2', p[2]];
      if (action === 'identities') return ['identities', p[2]];
    }
    return [];
  }
  return {
    forSchool,
    guard(req, url) {
      if (['GET', 'HEAD'].includes(req.method) && !url.pathname.endsWith('/forum-login')) return;
      const [module, school] = mutationModule(url);
      if (!module) return;
      if (!governed.has(school)) return;
      const enabled = forSchool(school);
      if (module === 'identities' ? !enabled.base2 || !enabled.base3 : !enabled[module])
        throw problem('module_disabled', 409);
    },
  };
}
