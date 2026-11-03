import test from 'node:test';
import assert from 'node:assert/strict';
import { createReception } from '../src/reception/index.mjs';
import { exampleScene, packageFor } from '../tools/fixtures.mjs';
const p = {
  id: 'visitor-test',
  tenantBound: true,
  spaces: ['north'],
  scopes: ['public:read', 'a2a:call'],
};
const pack = packageFor(exampleScene(), 'north', '北岸');
test('reviewed partner facts are dynamically scoped; withdrawal clears prior source context', async () => {
  let active = true,
    calls = [];
  const source = {
    id: 'partner:service:1',
    title: '咖啡预约',
    text: '白桦咖啡每日10时开始预约。',
    sourceType: 'reviewed-partner',
    revision: 1,
  };
  const resolver = async (space) => (space === 'north' && active ? [source] : []);
  const provider = Object.assign(
    async (input) => {
      calls.push(input);
      return input.facts.some((f) => f.id === source.id)
        ? { answer: '十点预约', kind: 'space', sourceIds: [source.id] }
        : { answer: '该服务暂无有效资料', kind: 'unknown', sourceIds: [] };
    },
    { general: true },
  );
  const reception = createReception({ provider, sourceResolver: resolver });
  const r = await reception.answer({ pack, principal: p, message: '白桦咖啡预约' });
  assert.equal(r.sources[0].sourceType, 'reviewed-partner');
  active = false;
  await reception.answer({
    pack,
    principal: p,
    message: '现在还能预约吗',
    history: [{ role: 'assistant', text: '十点预约', sourceIds: [source.id] }],
  });
  assert.deepEqual(calls.at(-1).history, []);
  assert.ok(!calls.at(-1).facts.some((f) => f.id === source.id));
  await assert.rejects(
    reception.answer({ pack, principal: { ...p, spaces: ['south'] }, message: '咖啡' }),
  );
});
test('source withdrawal while model is generating blocks stale output', async () => {
  let active = true;
  const source = {
    id: 'partner:service:2',
    title: '预约咨询',
    text: '咨询须提前预约',
    sourceType: 'reviewed-partner',
    revision: 2,
  };
  const provider = Object.assign(
    async () => {
      active = false;
      return { answer: '过期回答不应返回', kind: 'space', sourceIds: [source.id] };
    },
    { general: true },
  );
  const reception = createReception({
    provider,
    sourceResolver: async () => (active ? [source] : []),
  });
  await assert.rejects(reception.answer({ pack, principal: p, message: '预约咨询' }), {
    code: 'source_changed',
  });
});
