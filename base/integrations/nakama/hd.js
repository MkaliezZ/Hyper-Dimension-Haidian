// Nakama JavaScript runtime (ES5). One independent instance/database per school.
var deny = function () {
  throw { code: 7, message: 'Disabled in M0: use a verified school identity' };
};
var base = function (ctx, nk, path, data) {
  var r = nk.httpRequest(
    ctx.env.HD_BASE_URL + '/m0/internal/nakama/' + path,
    'post',
    { 'Content-Type': 'application/json', 'X-HD-Service-Key': ctx.env.HD_BRIDGE_KEY },
    JSON.stringify(data),
    5000,
  );
  if (r.code !== 200) throw { code: 7, message: 'School membership denied' };
  return JSON.parse(r.body);
};
var member = function (ctx, logger, nk, request) {
  if (!ctx.userId) deny();
  var a = nk.accountGetId(ctx.userId);
  base(ctx, nk, 'member', { userId: a.customId });
  return request;
};
var authCustom = function (ctx, logger, nk, req) {
  if (!req.account || !req.account.vars || typeof req.account.vars.ticket !== 'string') deny();
  var r = base(ctx, nk, 'ticket', { ticket: req.account.vars.ticket });
  if (r.schoolId !== ctx.env.HD_SCHOOL || r.userId !== req.account.id) deny();
  return req;
};
// Campus periods may belong to private organizations. Their public read path is Base ACL.
var legacyLeaderboardMember = function (ctx, logger, nk, request) {
  if (request.leaderboardId !== ctx.env.HD_SCHOOL + ':m0-trial') deny();
  if (!ctx.userId) deny();
  var account = nk.accountGetId(ctx.userId);
  var who = base(ctx, nk, 'member', { userId: account.customId });
  if (who.campusEnabled) deny();
  return request;
};
var InitModule = function (ctx, logger, nk, initializer) {
  logger.info('HD M0 initializing hooks');
  initializer.registerBeforeAuthenticateCustom(authCustom);
  initializer.registerBeforeAuthenticateApple(deny);
  initializer.registerBeforeAuthenticate(deny);
  initializer.registerBeforeAuthenticateDevice(deny);
  initializer.registerBeforeAuthenticateEmail(deny);
  initializer.registerBeforeAuthenticateFacebook(deny);
  initializer.registerBeforeAuthenticateFacebookInstantGame(deny);
  initializer.registerBeforeAuthenticateGameCenter(deny);
  initializer.registerBeforeAuthenticateGoogle(deny);
  initializer.registerBeforeAuthenticateSteam(deny);
  initializer.registerBeforeSessionRefresh(deny);
  initializer.registerBeforeUpdateAccount(deny);
  initializer.registerBeforeDeleteAccount(deny);
  initializer.registerBeforeLinkCustom(deny);
  initializer.registerBeforeLinkDevice(deny);
  initializer.registerBeforeLinkEmail(deny);
  initializer.registerBeforeUnlinkCustom(deny);
  initializer.registerBeforeGetAccount(member);
  initializer.registerBeforeReadStorageObjects(member);
  initializer.registerBeforeListStorageObjects(member);
  initializer.registerBeforeWriteStorageObjects(deny);
  initializer.registerBeforeDeleteStorageObjects(deny);
  initializer.registerBeforeListLeaderboardRecords(legacyLeaderboardMember);
  initializer.registerBeforeListLeaderboardRecordsAroundOwner(legacyLeaderboardMember);
  initializer.registerBeforeWriteLeaderboardRecord(deny);
  initializer.registerBeforeDeleteLeaderboardRecord(deny);
  initializer.registerBeforeListChannelMessages(deny);
  // M0 tests identity/storage/ranking only. Chat is not exposed before per-packet ACL work in M1.
  initializer.registerRtBefore('ChannelJoin', deny);
  initializer.registerRtBefore('ChannelMessageSend', deny);
  initializer.registerRtBefore('ChannelMessageUpdate', deny);
  initializer.registerRtBefore('ChannelMessageRemove', deny);
  initializer.registerRtBefore('MatchJoin', deny);
  initializer.registerRtBefore('PartyJoin', deny);
  initializer.registerRpc('hd_project', project);
  initializer.registerRpc('hd_reset_projection', resetProjection);
  initializer.registerRpc('hd_projection_read', readProjection);
  initializer.registerRpc('hd_message', messageStore);
  logger.info('HD M0 school boundary loaded: %s', ctx.env.HD_SCHOOL);
};
// Server-only message authority. No user token, native channel or direct storage route can bypass Base ACL.
var messageStore = function (ctx, logger, nk, payload) {
  var p = JSON.parse(payload),
    owner = '00000000-0000-0000-0000-000000000000';
  if (ctx.userId || p.key !== ctx.env.HD_BRIDGE_KEY || !/^[a-f0-9-]{36}$/.test(p.id || '')) deny();
  var k = { collection: 'hd_messages', key: p.id, userId: owner },
    old = nk.storageRead([k])[0];
  if (p.action === 'get')
    return JSON.stringify(old ? { value: old.value, version: old.version } : { missing: true });
  if (
    p.action !== 'put' ||
    !p.value ||
    p.value.schoolId !== ctx.env.HD_SCHOOL ||
    typeof p.value.operationId !== 'string'
  )
    deny();
  if (old && old.value.operationId === p.value.operationId) {
    if (
      old.value.inputHash !== p.value.inputHash ||
      old.value.text !== p.value.text ||
      old.value.revision !== p.value.revision ||
      old.value.status !== p.value.status
    )
      throw { code: 6, message: 'operation_conflict' };
    return JSON.stringify({ value: old.value, version: old.version });
  }
  if ((old ? old.version : null) !== (p.expectedVersion || null))
    throw { code: 10, message: 'message_version_conflict' };
  var ack = nk.storageWrite([
    {
      collection: k.collection,
      key: k.key,
      userId: owner,
      version: old ? old.version : '*',
      value: p.value,
      permissionRead: 0,
      permissionWrite: 0,
    },
  ])[0];
  return JSON.stringify({ value: p.value, version: ack.version });
};
var project = function (ctx, logger, nk, payload) {
  var p = JSON.parse(payload);
  if (
    ctx.userId ||
    p.key !== ctx.env.HD_BRIDGE_KEY ||
    typeof p.period !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(p.period) ||
    ['__proto__', 'constructor', 'prototype'].indexOf(p.period) >= 0 ||
    !Number.isInteger(p.version) ||
    !Number.isInteger(p.score)
  )
    deny();
  var board = ctx.env.HD_SCHOOL + ':' + p.period;
  nk.leaderboardCreate(board, true, 'desc', 'set', null, { schoolId: ctx.env.HD_SCHOOL }, true);
  var key = {
      collection: 'hd_projection_lock',
      key: p.userId + ':' + p.period,
      userId: '00000000-0000-0000-0000-000000000000',
    },
    old = nk.storageRead([key])[0];
  var now = Date.now();
  if (old && old.value.until > now) throw { code: 10, message: 'Projection busy; retry outbox' };
  var ack = nk.storageWrite([
    {
      collection: key.collection,
      key: key.key,
      userId: key.userId,
      version: old ? old.version : '*',
      value: { until: now + 90000 },
      permissionRead: 0,
      permissionWrite: 0,
    },
  ])[0];
  try {
    var records = nk.leaderboardRecordsList(board, [p.userId], 10).ownerRecords;
    var record = records && records[0];
    if (!record || Number(record.metadata.version || 0) < p.version)
      nk.leaderboardRecordWrite(
        board,
        p.userId,
        undefined,
        p.score,
        0,
        { version: p.version, schoolId: ctx.env.HD_SCHOOL },
        'set',
      );
    // A private record verifies direct native storage ACLs; business authority remains Base PG.
    nk.storageWrite([
      {
        collection: 'hd_private',
        key: 'profile',
        userId: p.userId,
        value: { schoolId: ctx.env.HD_SCHOOL },
        permissionRead: 1,
        permissionWrite: 0,
      },
    ]);
    return JSON.stringify({ projected: true, version: p.version });
  } finally {
    nk.storageWrite([
      {
        collection: key.collection,
        key: key.key,
        userId: key.userId,
        version: ack.version,
        value: { until: 0 },
        permissionRead: 0,
        permissionWrite: 0,
      },
    ]);
  }
};
var resetProjection = function (ctx, logger, nk, payload) {
  var p = JSON.parse(payload);
  if (
    ctx.userId ||
    p.key !== ctx.env.HD_BRIDGE_KEY ||
    typeof p.period !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(p.period) ||
    ['__proto__', 'constructor', 'prototype'].indexOf(p.period) >= 0
  )
    deny();
  nk.leaderboardDelete(ctx.env.HD_SCHOOL + ':' + p.period);
  return JSON.stringify({ reset: true, schoolId: ctx.env.HD_SCHOOL });
};
var readProjection = function (ctx, logger, nk, payload) {
  var p = JSON.parse(payload);
  if (
    ctx.userId ||
    p.key !== ctx.env.HD_BRIDGE_KEY ||
    typeof p.period !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(p.period) ||
    ['__proto__', 'constructor', 'prototype'].indexOf(p.period) >= 0 ||
    !/^[a-f0-9-]{36}$/.test(p.userId || '')
  )
    deny();
  var records = nk.leaderboardRecordsList(
    ctx.env.HD_SCHOOL + ':' + p.period,
    [p.userId],
    1,
  ).ownerRecords;
  return JSON.stringify({ record: (records && records[0]) || null });
};
