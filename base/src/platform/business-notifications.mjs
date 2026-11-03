// Narrow ownership exception for private business receipts. This grants no school
// feed, merchant staff, message-body or profile access.
export async function authorizeOwnedBusinessNotification(db, school, user, n, c = db.pool) {
  await db.member(school, user, null, c);
  if (!n || n.school_id !== school || n.user_id !== user || n.information_event) return false;
  const p = n.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (
    !['partner-business', 'partner-withdrawal'].includes(p.type) ||
    !/^\d{1,18}$/.test(String(n.id))
  )
    return false;
  if (
    !(
      await c.query(
        `SELECT 1 FROM hd_notifications WHERE id=$1 AND school_id=$2 AND user_id=$3
    AND event_id=$4 AND payload=$5::jsonb AND information_event IS NULL`,
        [n.id, school, user, n.event_id, p],
      )
    ).rowCount
  )
    return false;
  if (p.type === 'partner-business') {
    if (
      Object.keys(p).some((k) => !['type', 'objectId', 'partnerId', 'kind', 'status'].includes(k))
    )
      return false;
    const e = (
      await c.query('SELECT * FROM hd_m5_events WHERE school_id=$1 AND event_id=$2', [
        school,
        n.event_id,
      ])
    ).rows[0];
    if (
      !e ||
      e.object_id !== p.objectId ||
      e.partner_id !== p.partnerId ||
      e.kind !== p.kind ||
      e.envelope.status !== p.status ||
      e.envelope.schoolId !== school ||
      e.envelope.source?.system !== 'base-partners' ||
      e.envelope.source?.id !== p.objectId
    )
      return false;
    const table = e.kind.startsWith('partner_')
      ? 'partners'
      : e.kind.startsWith('task_')
        ? 'tasks'
        : e.kind.startsWith('entitlement_')
          ? 'entitlements'
          : null;
    if (!table) return false;
    const key = { partners: 'partner_id', tasks: 'task_id', entitlements: 'entitlement_id' }[table];
    const owner = table === 'partners' ? 'applicant_id' : 'user_id';
    return Boolean(
      (
        await c.query(
          `SELECT 1 FROM hd_m5_${table} WHERE school_id=$1 AND ${key}=$2 AND partner_id=$3 AND ${owner}=$4`,
          [school, p.objectId, p.partnerId, user],
        )
      ).rowCount,
    );
  }
  if (p.type === 'partner-withdrawal') {
    if (
      Object.keys(p).some(
        (k) => !['type', 'partnerId', 'entitlementId', 'policy', 'reason'].includes(k),
      )
    )
      return false;
    if (
      p.policy !== 'honor' ||
      n.event_id !== `${school}:partner-withdrawal:${p.partnerId}:${p.entitlementId}`
    )
      return false;
    if (
      ![p.partnerId, p.entitlementId].every(
        (x) => typeof x === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x),
      )
    )
      return false;
    // This receipt uses a per-holder ID. Bind it back to the actual partner exit
    // event and the immutable terms held by this recipient, never just the label.
    return Boolean(
      (
        await c.query(
          `SELECT 1 FROM hd_m5_entitlements v JOIN hd_m5_partners p USING(school_id,partner_id)
       JOIN hd_m5_events e ON e.school_id=p.school_id AND e.object_id=p.partner_id AND e.partner_id=p.partner_id
       WHERE v.school_id=$1 AND v.entitlement_id=$2 AND v.partner_id=$3 AND v.user_id=$4
       AND v.terms->>'withdrawalPolicy'='honor' AND p.status='withdrawn'
       AND e.kind='partner_withdrawn' AND e.envelope->'detail'->>'reason'=$5`,
          [school, p.entitlementId, p.partnerId, user, p.reason],
        )
      ).rowCount,
    );
  }
  return false;
}
