import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Owned browser and isolated fixture required');
const fixture = JSON.parse(await readFile('.local/rewards-browser-fixture.json', 'utf8'));
fixtures.push(fixture);
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true }),
  checks = [],
  errors = [],
  run = randomUUID().slice(0, 8),
  title = '校园共同建设认可 ' + run,
  started = Date.now();
await mkdir('qa/rewards', { recursive: true });
let rewardId, claimId;
async function account(name) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } }),
    page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(name);
  await page
    .locator('#password')
    .fill(fixtures.find((x) => x.username === name).credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  await page.goto(config.origin + '/rewards.html');
  await page.waitForFunction(() => window.rewardsQA?.ready);
  return page;
}
const idle = (page) => page.waitForFunction(() => !document.getElementById('school').disabled);
async function success(page, text) {
  await page.locator('#status').filter({ hasText: text }).waitFor();
  assert.equal(await page.locator('#status').evaluate((n) => n.classList.contains('error')), false);
  await idle(page);
}
async function api(page, path, body) {
  return page.evaluate(
    async ({ path, body }) => {
      const r = await fetch(path, {
        ...(body
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {}),
      });
      return { status: r.status, data: await r.json() };
    },
    { path, body },
  );
}
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
try {
  const owner = await account('moda'),
    member = await account(fixture.username),
    base = '/rewards/schools/north';
  await test('organization owner can author only own organization scope; school manager sees participation boundary before claiming', async () => {
    await member.locator('#tab-manage').click();
    await idle(member);
    await member.locator('#new-reward').click();
    await member.locator('#edit-dialog').waitFor({ state: 'visible' });
    assert.deepEqual(
      await member.locator('#edit-org option').evaluateAll((ns) => ns.map((n) => n.value)),
      [fixture.rewardOrgId],
    );
    await member.locator('#edit-title').fill('本组织奖励草稿 ' + run);
    await member.locator('#edit-description').fill('由本组织负责人建立的独立虚构奖励草稿。');
    await member.locator('#save-draft').click();
    await success(member, '奖励草稿已保存');
    await member.locator('#tab-explore').click();
    await idle(member);
    const scoped = ok(await api(owner, base + '/items')).items.find(
      (r) => r.orgId === fixture.rewardOrgId && r.kind === 'appearance',
    );
    await owner
      .locator('#items [data-reward-id="' + scoped.rewardId + '"] p')
      .filter({ hasText: '管理权限不自动赋予参与资格' })
      .waitFor();
  });
  await test('organizer creates scoped finite reward, explicit demo confirmation precedes publication', async () => {
    await owner.locator('#tab-manage').click();
    await idle(owner);
    await owner.locator('#new-reward').click();
    await owner.locator('#edit-dialog').waitFor({ state: 'visible' });
    await owner.locator('#edit-title').fill(title);
    await owner
      .locator('#edit-description')
      .fill('虚构校园社区认可，只用于自动验证，不代表学校官方奖励。');
    await owner.locator('#edit-stock').fill('1');
    await owner.locator('#save-draft').click();
    await success(owner, '奖励草稿已保存');
    rewardId = ok(await api(owner, base + '/items')).items.find((r) => r.title === title).rewardId;
    const card = owner.locator('#managed [data-reward-id="' + rewardId + '"]');
    await card.getByRole('button', { name: '提交审核', exact: true }).click();
    await success(owner, '奖励草稿已提交审核');
    await card.getByRole('button', { name: '审核发布', exact: true }).click();
    await owner.locator('#action-reason').fill('已核对虚构示例条件和唯一份额');
    await owner.locator('#action-terms').check();
    await owner.locator('#action-demo').check();
    await owner.locator('#action-submit').click();
    await success(owner, '奖励已审核发布');
    await member.locator('#refresh').click();
    await idle(member);
    await member.locator('#search').fill(title);
    await member.screenshot({ path: 'qa/rewards/directory.png', fullPage: true });
  });
  await test('member reads conditions, consents and sees actual personal badge and durable receipt', async () => {
    const card = member.locator('#items [data-reward-id="' + rewardId + '"]');
    await card.getByRole('button', { name: '了解条件并领取', exact: true }).click();
    await member.locator('#action-terms').check();
    await member.locator('#action-demo').check();
    await member.locator('#action-submit').click();
    await success(member, '奖励已实际发放');
    const claim = ok(await api(member, base + '/claims')).claims.find(
      (c) => c.rewardId === rewardId,
    );
    claimId = claim.claimId;
    assert.equal(claim.status, 'fulfilled');
    const profile = ok(await api(member, '/personal/schools/north/me'));
    assert.ok(
      profile.badges.some(
        (b) => b.badge_id === claim.authorityReceipt.badgeId && b.status === 'active',
      ),
    );
    await member
      .locator('#claims [data-claim-id="' + claimId + '"] button')
      .filter({ hasText: '查看处理轨迹' })
      .click();
    await idle(member);
    await member.locator('#history-events').filter({ hasText: '已实际发放' }).waitFor();
    await member.screenshot({ path: 'qa/rewards/my-record.png', fullPage: true });
  });
  await test('manager revocation updates actual badge and member history, mobile width has no overflow', async () => {
    await owner.locator('#tab-manage').click();
    await idle(owner);
    await owner
      .locator('#managed-claims [data-claim-id="' + claimId + '"] button')
      .filter({ hasText: '撤销发放' })
      .click();
    await owner.locator('#action-reason').fill('虚构示例核验更正，撤销原奖励并保留来源');
    await owner.locator('#action-submit').click();
    await success(owner, '奖励已撤销');
    await member.locator('#refresh-mine').click();
    await idle(member);
    await member
      .locator('#claims [data-claim-id="' + claimId + '"] .reward-status')
      .filter({ hasText: '已撤销' })
      .waitFor();
    await member.locator('#history-events').filter({ hasText: '已撤销' }).waitFor();
    await member.setViewportSize({ width: 390, height: 844 });
    assert.ok(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await member.screenshot({ path: 'qa/rewards/mobile.png', fullPage: true });
    await member.setViewportSize({ width: 1360, height: 1000 });
  });
  await test('reward appearance UI explicitly upgrades, displays earned ribbon and restores in independent browser', async () => {
    const r = ok(
      await api(owner, base + '/items', {
        requestId: randomUUID(),
        kind: 'appearance',
        title: '虚构绶带 ' + run,
        description: '仅自动验收使用的可选绶带资格，不代表真实学校荣誉。',
        target: { itemId: 'appearance:community-ribbon' },
        minimumContribution: 0,
        stock: 2,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        demonstration: true,
      }),
    );
    const pending = ok(
      await api(owner, base + '/items/' + r.rewardId + '/submit', {
        requestId: randomUUID(),
        expectedRevision: r.revision,
      }),
    );
    const published = ok(
      await api(owner, base + '/items/' + r.rewardId + '/review', {
        requestId: randomUUID(),
        expectedRevision: pending.revision,
        decision: 'publish',
        reason: '明确发布虚构绶带',
        confirmation: 'publish-demonstration',
      }),
    );
    ok(
      await api(member, base + '/items/' + r.rewardId + '/claim', {
        requestId: randomUUID(),
        expectedRevision: published.revision,
        acceptedTerms: true,
        acknowledgeDemonstration: true,
      }),
    );
    await member.goto(config.origin + '/m2.html');
    await member.waitForFunction(() => window.m2QA?.saved);
    for (const version of ['campus-original-2', 'campus-rewards-3']) {
      await member.locator('#catalog-version').selectOption(version);
      await member.waitForFunction((version) => m2QA.recipe.catalogVersion === version, version);
      await member.locator('#confirm-catalog-upgrade').check();
      if (version === 'campus-rewards-3')
        await member.locator('#part-accessory').selectOption('accessory-community-ribbon');
      await member.locator('#save').click();
      await member.waitForFunction(
        (version) => m2QA.saved.recipe.catalogVersion === version,
        version,
      );
    }
    const expected = await member.evaluate(() => m2QA.saved.modelHash);
    await member.screenshot({ path: 'qa/rewards/earned-ribbon.png', fullPage: true });
    const second = await account(fixture.username);
    await second.goto(config.origin + '/m2.html');
    await second.waitForFunction(() => window.m2QA?.saved);
    assert.equal(await second.evaluate(() => m2QA.saved.modelHash), expected);
    assert.equal(
      await second.locator('#part-accessory').inputValue(),
      'accessory-community-ribbon',
    );
    assert.deepEqual(errors, []);
  });
  await writeFile(
    'qa/rewards/browser.json',
    JSON.stringify(
      {
        status: 'PASS',
        generatedAt: new Date().toISOString(),
        checks,
        errors,
        durationMs: Date.now() - started,
        scope:
          'Owned automated Chrome contexts on one host, fictional rewards and accounts. No human or real campus acceptance.',
      },
      null,
      2,
    ),
  );
} catch (e) {
  await writeFile(
    'qa/rewards/browser.json',
    JSON.stringify({ status: 'FAIL', checks, error: e.message, errors }, null, 2),
  );
  for (const [i, c] of browser.contexts().entries())
    for (const p of c.pages())
      await p.screenshot({ path: 'qa/rewards/failure-' + i + '.png', fullPage: true });
  throw e;
} finally {
  await browser.close();
}
