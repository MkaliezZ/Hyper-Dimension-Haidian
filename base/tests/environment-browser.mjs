import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { config } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Owned QA browser required');
const fixture = JSON.parse(await readFile('.local/environment-browser-fixture.json', 'utf8')),
  checks = [],
  errors = [];
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true });
const url =
  config.origin +
  '/environment.html?' +
  new URLSearchParams({
    school: 'north',
    sceneId: fixture.place.sceneId,
    entityId: fixture.place.entityId,
  });
const ready = (p) =>
  p.waitForFunction(
    (key) => document.body.dataset.ready === key,
    fixture.place.sceneId + '|' + fixture.place.entityId,
  );
const check = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
async function pageFor(u) {
  const c = await browser.newContext({ viewport: { width: 1360, height: 920 } }),
    p = await c.newPage();
  p.setDefaultTimeout(15000);
  p.on('pageerror', (e) => errors.push(e.message));
  if (u) {
    await p.goto(config.origin + '/auth/login');
    await p.locator('#username').fill(u.username);
    await p.locator('#password').fill(u.password);
    await p.locator('#kc-login').click();
    await p.waitForURL(config.origin + '/m1.html');
  }
  await p.goto(url);
  await ready(p);
  return p;
}
let owner, manager, moderator, visitor, anon;
const title = '浏览器地点公告 ' + fixture.run,
  body = '浏览器虚构地点公告，管理员审核后向访客公开。',
  feedback = '浏览器私有建议 ' + fixture.run + '：请增加服务台指示。';
try {
  [owner, manager, moderator, visitor, anon] = await Promise.all([
    pageFor(fixture.owner),
    pageFor(fixture.manager),
    pageFor(fixture.moderator),
    pageFor(fixture.visitor),
    pageFor(null),
  ]);
  await check(
    'school owner chooses a current delegated member and explicitly publishes only the duty label',
    async () => {
      assert.equal(await owner.locator('#assignment').isVisible(), true);
      assert.equal(await owner.locator('#organization').isDisabled(), true);
      await owner.locator('#manager-user').selectOption(fixture.manager.userId);
      await owner.locator('#role-label').fill('虚构场馆服务负责人');
      await owner.locator('#publish-label').check();
      await owner.getByRole('button', { name: '保存地点分配', exact: true }).click();
      await owner.locator('#status').filter({ hasText: '地点分配已保存' }).waitFor();
      await anon.reload();
      await ready(anon);
      await anon.locator('#public-duty').filter({ hasText: '虚构场馆服务负责人' }).waitFor();
      assert.equal(await anon.locator('#assignment').isVisible(), false);
      assert.equal(await anon.locator('#feedback-form').isVisible(), false);
      for (const u of [fixture.manager, fixture.moderator, fixture.visitor])
        assert.equal((await anon.locator('body').innerText()).includes(u.userId), false);
    },
  );
  await check(
    'delegated manager drafts and submits while administrator alone can approve publication',
    async () => {
      assert.equal(await manager.locator('#assignment').isVisible(), false);
      assert.equal(await manager.locator('#announcement-manager').isVisible(), true);
      await manager.locator('#role').filter({ hasText: '受托负责人' }).waitFor();
      await manager.locator('#announcement-title').fill(title);
      await manager.locator('#announcement-body').fill(body);
      await manager.getByRole('button', { name: '保存公告草稿', exact: true }).click();
      let card = manager.locator('#announcement-list article').filter({ hasText: title });
      await card.filter({ hasText: '草稿' }).waitFor();
      await card.getByRole('button', { name: '提交审核', exact: true }).click();
      await card.filter({ hasText: '待审核' }).waitFor();
      assert.equal(await card.getByRole('button', { name: '审核发布', exact: true }).count(), 0);
      await anon.reload();
      await ready(anon);
      assert.equal(
        await anon.locator('#public-notices').getByText(title, { exact: true }).count(),
        0,
      );
      await moderator.locator('#refresh').click();
      card = moderator.locator('#announcement-list article').filter({ hasText: title });
      await card.getByRole('button', { name: '审核发布', exact: true }).waitFor();
      moderator.once('dialog', (d) => d.accept('确认虚构公告可公开'));
      await card.getByRole('button', { name: '审核发布', exact: true }).click();
      await card.filter({ hasText: '已发布' }).waitFor();
      await anon.reload();
      await ready(anon);
      await anon.locator('#public-notices').getByText(title, { exact: true }).waitFor();
      await manager.screenshot({ path: 'qa/campus/environment-manager.png', fullPage: true });
    },
  );
  await check(
    'visitor submits private feedback and current moderator follows claim-processing-resolution flow',
    async () => {
      assert.equal(await visitor.locator('#assignment').isVisible(), false);
      assert.equal(await visitor.locator('#announcement-manager').isVisible(), false);
      assert.equal(await visitor.locator('#managed-feedback').isVisible(), false);
      await visitor.locator('#feedback-body').fill(feedback);
      await visitor.getByRole('button', { name: '提交给地点处理团队', exact: true }).click();
      let card = visitor.locator('#feedback-list article').filter({ hasText: feedback });
      await card.filter({ hasText: '已提交' }).waitFor();
      await moderator.locator('#managed-feedback').click();
      card = moderator.locator('#feedback-list article').filter({ hasText: feedback });
      await card.getByRole('button', { name: '认领处理', exact: true }).waitFor();
      for (const [name, reason, state] of [
        ['认领处理', '认领虚构界面反馈', '已认领'],
        ['开始处理', '正在完善虚构指示牌', '处理中'],
        ['确认解决', '虚构指示牌已完成并复核', '已解决'],
      ]) {
        moderator.once('dialog', (d) => d.accept(reason));
        await card.getByRole('button', { name, exact: true }).click();
        await card.filter({ hasText: state }).waitFor();
      }
      await visitor.reload();
      await ready(visitor);
      await visitor
        .locator('#feedback-list article')
        .filter({ hasText: feedback })
        .filter({ hasText: '已解决' })
        .waitFor();
      await anon.reload();
      await ready(anon);
      assert.equal((await anon.locator('body').innerText()).includes(feedback), false);
      await visitor.screenshot({ path: 'qa/campus/environment-visitor.png', fullPage: true });
      await moderator.screenshot({ path: 'qa/campus/environment-moderator.png', fullPage: true });
    },
  );
  await check(
    'current role revocation removes manager controls and public duty without deleting visitor history',
    async () => {
      const path = '/m1/schools/north/organizations/' + fixture.org + '/members';
      const members = await (await owner.request.get(config.origin + path)).json(),
        m = members.members.find((x) => x.user_id === fixture.manager.userId);
      let r = await owner.request.post(config.origin + path, {
        data: {
          requestId: randomUUID(),
          userId: m.user_id,
          role: m.role,
          active: false,
          expectedRevision: m.revision,
        },
      });
      assert.equal(r.status(), 200);
      const changed = await r.json();
      try {
        await manager.reload();
        await ready(manager);
        assert.equal(await manager.locator('#announcement-manager').isVisible(), false);
        assert.equal(await manager.locator('#managed-feedback').isVisible(), false);
        await anon.reload();
        await ready(anon);
        await anon.locator('#public-duty').filter({ hasText: '尚未发布' }).waitFor();
        await visitor.reload();
        await ready(visitor);
        await visitor
          .locator('#feedback-list article')
          .filter({ hasText: feedback })
          .filter({ hasText: '已解决' })
          .waitFor();
      } finally {
        r = await owner.request.post(config.origin + path, {
          data: {
            requestId: randomUUID(),
            userId: m.user_id,
            role: m.role,
            active: true,
            expectedRevision: changed.revision,
          },
        });
        assert.equal(r.status(), 200);
      }
    },
  );
  await check('mobile visitor retains readable controls without horizontal overflow', async () => {
    await visitor.setViewportSize({ width: 390, height: 844 });
    await visitor.reload();
    await ready(visitor);
    assert.ok(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await visitor.screenshot({ path: 'qa/campus/environment-mobile.png', fullPage: true });
  });
  assert.deepEqual(errors, []);
  await writeFile(
    'qa/campus/environment-browser.json',
    JSON.stringify(
      {
        scope:
          'Automated Chrome on one Windows host against isolated real services; not human or physical multi-device acceptance',
        run: fixture.run,
        checks,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
