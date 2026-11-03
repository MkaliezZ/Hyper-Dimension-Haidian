// Read-only operator probe. Suitable for a local Ubuntu timer; no message content or credentials in output.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const config = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8'));
if (config.milestone !== 'M1') throw Error('M1 configuration required');
const pool = new pg.Pool({ connectionString: config.databaseUrl });
try {
  const counters = (
    await pool.query(`SELECT
 (SELECT count(*)::int FROM hd_chat_operations WHERE state='pending') AS pending_messages,
 (SELECT count(*)::int FROM hd_outbox WHERE NOT delivered) AS pending_outbox,
 (SELECT count(*)::int FROM hd_outbox WHERE NOT delivered AND attempts>=5) AS repeatedly_failed_outbox,
 (SELECT count(*)::int FROM hd_chat_reports WHERE resolved_at IS NULL) AS open_reports,
 (SELECT count(*)::int FROM hd_chat_messages WHERE expires_at<=now() AND status='active' AND NOT legal_hold) AS expired_bodies`)
  ).rows[0];
  const latest = (
    await pool.query(
      'SELECT DISTINCT ON(school_id) school_id,result,occurred_at FROM hd_reconciliations ORDER BY school_id,occurred_at DESC',
    )
  ).rows;
  const schools = [];
  for (const s of config.schools) {
    const r = latest.find((x) => x.school_id === s.schoolId);
    let probe;
    try {
      const response = await fetch(config.origin + '/m0/internal/nakama/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-HD-Service-Key': s.nakamaKey },
        body: '{}',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) probe = await response.json();
    } catch {}
    schools.push({
      schoolId: s.schoolId,
      stale: !probe?.checkedAt || Date.now() - new Date(probe.checkedAt) > 60000,
      syncHealthy: probe?.syncHealthy === true,
      blocked: r?.result?.blocked?.length || 0,
    });
  }
  const healthy =
    !counters.pending_messages &&
    !counters.repeatedly_failed_outbox &&
    schools.every((s) => !s.stale && !s.blocked && s.syncHealthy);
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      status: healthy ? 'healthy' : 'attention_required',
      counters,
      schools,
    }),
  );
  if (!healthy) process.exitCode = 1;
} finally {
  await pool.end();
}
