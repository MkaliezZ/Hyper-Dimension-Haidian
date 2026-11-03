import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { config, login, api, until } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createServices } from '../src/platform/services.mjs';
if (!config.relocatedFrom || !process.argv.includes('--allow-owned-fixture-crash'))
  throw Error('Only an explicitly restored fixture clone may run this process-death test');
const f = JSON.parse(await readFile(config.configRoot + '/forum-north.json', 'utf8'));
if (!f.hd.allowFaults) throw Error('Fixture-only fault injection must be enabled');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  services = createServices(db, config),
  path = config.configRoot + '/restart-proof.json';
try {
  const alice = await login('alice');
  if (process.argv.includes('--prepare')) {
    const lock = await db.pool.connect();
    try {
      await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
        'north:source-reconciliation',
      ]);
      const org = (
        await db.pool.query(
          "SELECT org_id FROM hd_org_members WHERE school_id='north' AND user_id=$1 AND role='moderator' AND active LIMIT 1",
          [alice.userId],
        )
      ).rows[0].org_id;
      const route = '/m1/schools/north/organizations/' + org + '/forum',
        title = 'Durable restart ' + randomUUID().slice(0, 8);
      const input = {
        action: 'submit',
        requestId: randomUUID(),
        title,
        content: 'Fictional native publication followed by actual owned process termination.',
      };
      const created = await api(alice, route, input);
      assert.equal(created.status, 200, JSON.stringify(created.data));
      const item = created.data;
      await services.forum(config.schools[0], 'fault', { point: 'after-publish' });
      assert.equal((await api(alice, route, { action: 'approve', id: item.id })).status, 503);
      const native = (
        await services.forum(config.schools[0], 'list', { userId: alice.userId, orgId: org })
      ).items.find((i) => i.id === item.id);
      assert.ok(native.pid);
      assert.equal(
        (await db.pool.query('SELECT 1 FROM hd_events WHERE source_id=$1', [item.id])).rowCount,
        0,
      );
      const owned = JSON.parse(
        await readFile(config.serviceRoot + '/logs/owned-processes.json', 'utf8'),
      );
      let child;
      for (const row of owned.children) {
        const cmd = await readFile('/proc/' + row.pid + '/cmdline', 'utf8');
        if (cmd.includes('app.js') && cmd.includes(config.configRoot + '/forum-north.json'))
          child = row;
      }
      assert.ok(child, 'Exact clone forum command ownership must match');
      await writeFile(
        path,
        JSON.stringify({
          id: item.id,
          org,
          pid: native.pid,
          title,
          actor: alice.userId,
          route,
          terminatedPid: child.pid,
          supervisor: owned.supervisor,
        }) + '\n',
        { mode: 0o600 },
      );
      process.kill(child.pid, 'SIGKILL');
      await until(async () => {
        try {
          await readFile('/proc/' + owned.supervisor + '/cmdline');
          return false;
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
          return true;
        }
      }, 20000);
      console.log(
        'PASS committed native post exists without ledger event; exact restored-clone forum process terminated, owned supervisor stopped',
      );
    } finally {
      await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
        'north:source-reconciliation',
      ]);
      lock.release();
    }
  } else {
    const proof = JSON.parse(await readFile(path, 'utf8'));
    await until(
      async () =>
        (await db.pool.query('SELECT 1 FROM hd_events WHERE source_id=$1', [proof.id])).rowCount ===
        1,
    );
    const posts = await services.forum(config.schools[0], 'list', {
        userId: alice.userId,
        orgId: proof.org,
      }),
      item = posts.items.find((i) => i.id === proof.id);
    assert.equal(item.status, 'published');
    assert.equal(item.pid, proof.pid);
    assert.equal(posts.items.filter((i) => i.title === proof.title).length, 1);
    const again = await api(alice, proof.route, { action: 'approve', id: proof.id });
    assert.equal(again.status, 200);
    assert.equal(again.data.events.length, 1);
    const ledger = await db.pool.query(
      'SELECT delta FROM hd_contributions WHERE event_id IN(SELECT event_id FROM hd_events WHERE source_id=$1)',
      [proof.id],
    );
    assert.deepEqual(ledger.rows, [{ delta: 10 }]);
    await writeFile(
      'qa/m1/process-restart.json',
      JSON.stringify(
        {
          kind: 'actual process termination of owned restored fixture service',
          actualNativeProcessTermination: true,
          supervisorStoppedOwnedStack: true,
          sourceInstanceUntouched: true,
          nativePostIdPreserved: true,
          oneSourcePost: true,
          oneEvent: true,
          oneContribution: true,
          status: 'PASS',
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      'PASS actual restart recovers one source event and contribution from the same native post',
    );
  }
} finally {
  await db.close();
}
