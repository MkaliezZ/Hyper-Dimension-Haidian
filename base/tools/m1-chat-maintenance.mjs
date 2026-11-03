import { readFile } from 'node:fs/promises';
import { openPlatform } from '../src/platform/db.mjs';
import { createServices } from '../src/platform/services.mjs';
import { createChat } from '../src/platform/chat.mjs';
import { audit } from '../src/platform/permissions.mjs';
const c = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8'));
if (c.milestone !== 'M1') throw Error('M1 private configuration required');
const args = process.argv.slice(2),
  option = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const db = await openPlatform(c.databaseUrl, { m1: true }),
  services = createServices(db, c),
  chat = createChat(db, null, services, c);
try {
  const school = services.school(option('--school')).schoolId;
  if (args.includes('--hold') || args.includes('--release-hold')) {
    const id = option('--message'),
      reason = option('--reason');
    if (!/^[a-f0-9-]{36}$/.test(id || '') || !reason || reason.length < 3 || reason.length > 500)
      throw Error('A message ID and 3-500 character reason are required');
    await db.tx(async (client) => {
      const r = await client.query(
        'UPDATE hd_chat_messages SET legal_hold=$3 WHERE school_id=$1 AND message_id=$2 RETURNING message_id',
        [school, id, args.includes('--hold')],
      );
      if (r.rowCount !== 1) throw Error('Message not in this school');
      await audit(client, school, null, 'chat.legal-hold', id, {
        held: args.includes('--hold'),
        reason,
        actorKind: 'operator',
      });
    });
    console.log(JSON.stringify({ messageId: id, held: args.includes('--hold') }));
  } else if (args.includes('--reconcile'))
    console.log(JSON.stringify(await chat.reconcile(school)));
  else console.log(JSON.stringify(await chat.expire(school, { apply: args.includes('--apply') })));
} finally {
  chat.close();
  await db.close();
}
