// Deployment input, not content-package executable configuration.
export function validateSchoolDefinitions(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8)
    throw Error('Configure between one and eight explicit schools');
  const ids = new Set(), spaces = new Set();
  return value.map(s => {
    if (!s || typeof s !== 'object' || Object.keys(s).some(k => !['schoolId','spaceId','name'].includes(k)))
      throw Error('Unknown school deployment field');
    if (!/^[a-z][a-z0-9_]{1,20}$/.test(s.schoolId) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(s.spaceId))
      throw Error('Invalid school or space identity');
    if (ids.has(s.schoolId) || spaces.has(s.spaceId)) throw Error('School and space identities must be unique');
    if (s.name !== undefined && (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 160))
      throw Error('Invalid school display name');
    ids.add(s.schoolId); spaces.add(s.spaceId);
    return {schoolId:s.schoolId,spaceId:s.spaceId,...(s.name ? {name:s.name}: {})};
  });
}
