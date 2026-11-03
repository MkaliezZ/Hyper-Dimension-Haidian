import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModulePolicy } from '../src/platform/modules.mjs';
const config = {
  m2Enabled: true,
  campusEnabled: true,
  partnersEnabled: true,
  schools: [{ schoolId: 'one' }, { schoolId: 'two', modules: { base3: false, base4: false } }],
};
const url = (p) => new URL(p, 'http://local');
test('module flags preserve reads and reject all disabled business mutations including legacy routes', () => {
  const p = createModulePolicy(config);
  for (const path of [
    '/community/schools/two/drafts',
    '/network/schools/two/profile',
    '/activities/schools/two',
    '/ledger/schools/two/adjustments',
    '/rewards/schools/two/claims',
    '/operations/schools/two',
    '/m5/schools/two/partners',
    '/attachments/schools/two',
    '/m1/schools/two/organizations/club/forum',
    '/m0/schools/two/forum',
  ]) {
    assert.throws(() => p.guard({ method: 'POST' }, url(path)), { code: 'module_disabled' });
    assert.doesNotThrow(() => p.guard({ method: 'GET' }, url(path)));
  }
  assert.throws(() => p.guard({ method: 'GET' }, url('/m0/schools/two/forum-login')), {
    code: 'module_disabled',
  });
  assert.doesNotThrow(() => p.guard({ method: 'POST' }, url('/m2/schools/two/avatar')));
  assert.doesNotThrow(() => p.guard({ method: 'POST' }, url('/community/schools/one/drafts')));
});
test('base2 closure includes chat consent and avatar; invalid/uninstalled switches fail configuration', () => {
  const p = createModulePolicy({ ...config, modules: { base2: false } });
  for (const path of [
    '/personal/schools/one/profile',
    '/contacts/schools/one/requests',
    '/m2/schools/one/avatar',
    '/m1/schools/one/chat',
    '/m1/schools/one/blocks',
  ])
    assert.throws(() => p.guard({ method: 'POST' }, url(path)), { code: 'module_disabled' });
  assert.throws(() => createModulePolicy({ ...config, modules: { base1: false } }), {
    code: 'module_configuration_invalid',
  });
  assert.throws(() => createModulePolicy({ ...config, modules: { base3: 'false' } }), {
    code: 'module_configuration_invalid',
  });
  assert.throws(
    () => createModulePolicy({ ...config, m2Enabled: false, modules: { base2: true } }),
    { code: 'module_not_installed' },
  );
});
test('historical M0/M1 configurations without campus flags retain their original routes', () => {
  const p = createModulePolicy({ schools: [{ schoolId: 'old' }] });
  for (const path of ['/m0/schools/old/forum', '/m0/schools/old/avatar', '/m1/schools/old/chat'])
    assert.doesNotThrow(() => p.guard({ method: 'POST' }, url(path)));
});
