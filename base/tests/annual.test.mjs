import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateAnnualDocument,
  annualPeriod,
  annualPriority,
  annualDiff,
  annualUrl,
  annualDate,
} from '../src/platform/annual-contract.mjs';
const example = JSON.parse(
  await readFile(new URL('../examples/operations/annual-starter-v1.json', import.meta.url), 'utf8'),
);
test('Annual reference data preserves school year boundaries and does not invent actual deadlines', () => {
  const d = validateAnnualDocument(example);
  assert.equal(d.entries.length, 8);
  assert.equal(annualPeriod(2026, 8, 8), '2026-08');
  assert.equal(annualPeriod(2026, 8, 7), '2027-07');
  assert.equal(annualPeriod(2026, 1, 1), '2026-01');
  assert(!JSON.stringify(d).includes('dueAt'));
  assert.throws(() => annualPeriod(2026, 8, 13));
  assert.throws(() => annualPeriod(1999, 8, 7));
  assert.throws(() => annualDate('2026-02-30T12:00:00Z'));
  assert.equal(annualDate('2028-02-29T12:00:00+08:00'), '2028-02-29T04:00:00.000Z');
  assert.equal(example.entries[0].suggestedPriority, null);
});
test('Objective situations are unranked; completion and non-applicability clear personal urgency', () => {
  assert.equal(annualPriority('objective', 'A'), null);
  assert.equal(annualPriority('academic', 'A', 'done'), null);
  assert.equal(annualPriority('life', 'B', 'not-applicable'), null);
  assert.equal(annualPriority('career', null), null);
  assert.throws(() => annualPriority('academic', 'D'));
  const d = structuredClone(example);
  d.entries[0].suggestedPriority = 'A';
  assert.throws(() => validateAnnualDocument(d), /annual_objective_not_rated/);
});
test('Version changes are explicit; repeated monthly chain IDs remain one personal planning identity', () => {
  const old = validateAnnualDocument(example),
    next = structuredClone(old);
  next.version = 2;
  next.entries[1].title = '新的迎新导览';
  next.entries.splice(2, 1);
  const diff = annualDiff(old, next);
  assert.deepEqual(diff.changed, ['welcome-tour']);
  assert.deepEqual(diff.removed, ['guide-review']);
  assert.equal(old.entries[1].title, example.entries[1].title);
  assert.equal(
    old.entries.find((x) => x.entryId === 'study-august').chainId,
    old.entries.find((x) => x.entryId === 'study-september').chainId,
  );
});
test('Reference packages reject executable fields, unknown references/cohorts, duplicate IDs and unsafe links', () => {
  for (const transform of [
    (d) => (d.execute = 'code'),
    (d) => (d.entries[0].sourceRefs = ['missing']),
    (d) => (d.entries[0].cohortIds = ['missing']),
    (d) => d.entries.push(structuredClone(d.entries[0])),
    (d) => (d.entries[0].channel = 'broadcast-all'),
  ]) {
    const d = structuredClone(example);
    transform(d);
    assert.throws(() => validateAnnualDocument(d));
  }
  assert.throws(() => annualUrl('javascript:alert(1)'));
  assert.throws(() => annualUrl('https://user:secret@example.org'));
  assert.equal(annualUrl(null), null);
});
