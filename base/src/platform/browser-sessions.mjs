import { problem } from './db.mjs';

export const browserSessionSeconds = 3600;
const limitedText = value => typeof value === 'string' && value.length > 0 && value.length <= 65536;
export function identityFailure(cause) {
  if (cause.status === 503) return cause;
  if (!cause.status && (['TypeError','TimeoutError','AbortError'].includes(cause.name) || cause.code==='ERR_JWKS_TIMEOUT')) return problem('identity_service_unavailable',503);
  const error=problem('invalid_identity_token',401);
  if (cause.code==='ERR_JWT_EXPIRED') error.expired=true;
  return error;
}

// Only server-held browser sessions may renew. Bearer clients never use this path.
export async function resolveBrowserTokens(row, {config, claims, verifyToken, request = fetch, now = Date.now}) {
  try {
    const payload=await claims(row.access_token);
    if (payload.sub !== row.subject || payload.iss !== row.issuer) return {error:problem('invalid_identity_token',401),invalidate:true};
    return {payload};
  }
  catch (error) {
    const deadline=new Date(row.refresh_expires_at).getTime();
    if (!error.expired || !limitedText(row.refresh_token) || !Number.isFinite(deadline) || deadline <= now()) return {error};
  }
  let response;
  try {
    response = await request(config.issuer+'/protocol/openid-connect/token', {
      method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:config.clientId,client_secret:config.clientSecret,refresh_token:row.refresh_token}),signal:AbortSignal.timeout(10000),
    });
  } catch {return {error:problem('identity_service_unavailable',503)};}
  if (!response.ok) {
    let reason;
    if ([400,401].includes(response.status)) try {reason=(await response.json()).error;} catch {}
    return reason==='invalid_grant' ? {error:problem('login_required',401),invalidate:true} : {error:problem('identity_service_unavailable',503)};
  }
  let data, payload;
  try {
    data=await response.json();
    if (!limitedText(data.access_token) || !limitedText(data.refresh_token || row.refresh_token) || !Number.isFinite(data.refresh_expires_in) || data.refresh_expires_in <= 0) throw Error('Invalid renewal');
  } catch {return {error:problem('invalid_identity_token',401),invalidate:true};}
  const tokens={access:data.access_token,refresh:data.refresh_token || row.refresh_token,expiresAt:new Date(now()+data.refresh_expires_in*1000)};
  try {
    payload=await verifyToken(data.access_token);
    if (payload.sub !== row.subject || payload.iss !== row.issuer) throw Error('Identity changed during renewal');
  } catch (cause) {
    const error=identityFailure(cause);
    return error.status===503?{tokens,error}:{error,invalidate:true};
  }
  try {return {tokens,payload:await claims(tokens.access)};}
  catch (error) {
    // Retain a successfully rotated token on a temporary provider outage so the
    // next request can recover without trying the already-consumed old token.
    return {tokens,error,invalidate:error.status===401 || error.status===403};
  }
}

export function createBrowserSessions(db, config, {claims, verifyToken, request = fetch, now = Date.now}) {
  let ready;
  const ensure = () => ready ||= db.tx(async c => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('hd-browser-refresh-v1',0))");
    await c.query(`CREATE TABLE IF NOT EXISTS hd_session_refresh (
      token_hash text PRIMARY KEY REFERENCES hd_sessions(token_hash) ON DELETE CASCADE,
      refresh_token text NOT NULL, expires_at timestamptz NOT NULL
    )`);
  }).catch(error => {ready=null;throw error;});
  return {
    async create(tokenHash, user, data) {
      if (!limitedText(data.access_token) || !limitedText(data.refresh_token) || !Number.isFinite(data.refresh_expires_in) || data.refresh_expires_in <= 0) throw problem('identity_refresh_unavailable',503);
      const payload=await verifyToken(data.access_token);
      if (payload.sub !== user.subject || payload.iss !== user.issuer) throw problem('invalid_identity_token',401);
      await ensure();
      await db.tx(async c => {
        await c.query("INSERT INTO hd_sessions(token_hash,user_id,expires_at,access_token) VALUES($1,$2,now()+interval '1 hour',$3)",[tokenHash,user.user_id,data.access_token]);
        await c.query('INSERT INTO hd_session_refresh(token_hash,refresh_token,expires_at) VALUES($1,$2,$3)',[tokenHash,data.refresh_token,new Date(now()+data.refresh_expires_in*1000)]);
      });
    },
    async user(tokenHash) {
      await ensure();
      const result=await db.tx(async c => {
        const {rows:[row]}=await c.query(`SELECT u.*,s.access_token,r.refresh_token,r.expires_at AS refresh_expires_at
          FROM hd_sessions s JOIN hd_users u USING(user_id) LEFT JOIN hd_session_refresh r USING(token_hash)
          WHERE s.token_hash=$1 AND s.expires_at>now() FOR UPDATE OF s`,[tokenHash]);
        if (!row) return {error:problem('login_required',401)};
        if (!row.enabled) return {error:problem('account_disabled',403)};
        const auth=await resolveBrowserTokens(row,{config,claims,verifyToken,request,now});
        if (auth.invalidate) await c.query('DELETE FROM hd_sessions WHERE token_hash=$1',[tokenHash]);
        else if (auth.tokens) {
          await c.query('UPDATE hd_sessions SET access_token=$2 WHERE token_hash=$1',[tokenHash,auth.tokens.access]);
          await c.query('UPDATE hd_session_refresh SET refresh_token=$2,expires_at=$3 WHERE token_hash=$1',[tokenHash,auth.tokens.refresh,auth.tokens.expiresAt]);
        }
        return auth;
      });
      if (result.error) throw result.error;
      return db.identity(result.payload);
    },
  };
}
