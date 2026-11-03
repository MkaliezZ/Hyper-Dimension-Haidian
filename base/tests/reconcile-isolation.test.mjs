import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSteps } from '../src/platform/reconcile.mjs';

test('source failure preserves later services and schools while reporting failed health', async () => {
  const calls = [];
  const steps = ['north:chat', 'north:forum', 'south:chat', 'south:forum', 'global:projection'].map(
    (label) => ({
      schoolId: label.split(':')[0],
      stage: label.split(':')[1],
      run: async () => {
        calls.push(label);
        if (label === 'north:chat' || label === 'north:forum')
          throw Error('untrusted upstream details');
      },
    }),
  );
  await assert.rejects(reconcileSteps(steps), (error) => {
    assert.equal(error.code, 'source_reconciliation_incomplete');
    assert.deepEqual(error.failures, [
      { schoolId: 'north', stage: 'chat' },
      { schoolId: 'north', stage: 'forum' },
    ]);
    assert.doesNotMatch(error.message, /upstream/);
    return true;
  });
  assert.deepEqual(
    calls,
    steps.map((x) => x.schoolId + ':' + x.stage),
  );
  await reconcileSteps([{ schoolId: 'south', stage: 'forum', run: async () => {} }]);
});
