import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateOperationsPackage, operationsDiff } from '../src/platform/operations.mjs';
const example = JSON.parse(
  await readFile(new URL('../examples/operations/campus-starter-v1.json', import.meta.url), 'utf8'),
);
test('four original example templates have explicit provenance, responsibilities and bounded data-only fields', () => {
  const d = validateOperationsPackage(example);
  assert.equal(d.exampleOnly, true);
  assert.deepEqual(
    d.templates.map((t) => t.templateId),
    ['welcome', 'reading', 'volunteer', 'graduation'],
  );
  for (const patch of [
    { ...d, shell: 'run arbitrary code' },
    { ...d, version: 0 },
    { ...d, exampleOnly: 'yes' },
    { ...d, templates: [...d.templates, d.templates[0]] },
    { ...d, templates: [{ ...d.templates[0], dayOffset: -1 }] },
    { ...d, templates: [{ ...d.templates[0], kind: 'script' }] },
  ])
    assert.throws(() => validateOperationsPackage(patch));
});
test('version diff explains actual changed fields without mutating previous versions', () => {
  const before = JSON.stringify(example),
    next = structuredClone(example);
  next.version++;
  next.templates[0].capacity = 20;
  next.templates.splice(1, 1);
  next.templates.push({ ...next.templates[0], templateId: 'new-welcome' });
  const diff = operationsDiff(example, next);
  assert.deepEqual(diff.added, ['new-welcome']);
  assert.deepEqual(diff.removed, ['reading']);
  assert.deepEqual(diff.changed, [{ templateId: 'welcome', fields: ['capacity'] }]);
  assert.equal(JSON.stringify(example), before);
});
