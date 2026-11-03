import { randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { hash, problem } from './db.mjs';
import { keycloak } from './keycloak.mjs';
import { createBrowserSessions, identityFailure } from './browser-sessions.mjs';
const cookie = (req, key) =>
  (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(key + '='))
    ?.slice(key.length + 1);
export function createIdentity(db, config) {
  const m1 = config.milestone === 'M1',
    kc = m1 ? keycloak(config) : null;
  const sessionCookie = m1 ? 'hd_m1' : 'hd_m0',
    stateCookie = m1 ? 'hd_oidc_m1' : 'hd_oidc';
  if (m1)
    db.accountGate = async (userId, client = db.pool) => {
      const {
        rows: [u],
      } = await client.query('SELECT subject FROM hd_users WHERE user_id=$1', [userId]);
      if (!u) throw problem('account_missing', 403);
      const account = await kc.admin('users/' + encodeURIComponent(u.subject));
      if (!account.enabled || !account.emailVerified)
        throw problem('identity_account_unavailable', 403);
    };
  const jwks = createRemoteJWKSet(new URL(config.issuer + '/protocol/openid-connect/certs'));
  const verifyToken = async token => (await jwtVerify(token,jwks,{issuer:config.issuer,audience:config.clientId,algorithms:['RS256']})).payload;
  const setCookie = (res, k, v, age = 3600) =>
    res.setHeader(
      'Set-Cookie',
      `${k}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.origin.startsWith('https:') ? '; Secure' : ''}`,
    );
  const claims = async (token) => {
    try {
      const payload = (
        await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.clientId,
          algorithms: ['RS256'],
        })
      ).payload;
      if (m1) {
        await kc.active(token);
        const account = await kc.admin('users/' + encodeURIComponent(payload.sub));
        if (!account.enabled || !account.emailVerified)
          throw problem('verified_email_required', 403);
        payload.email = account.email;
        payload.email_verified = true;
      }
      return payload;
    } catch (e) {
      throw identityFailure(e);
    }
  };
  const sessions=m1?createBrowserSessions(db,config,{claims,verifyToken}):null;
  const user = async (req) => {
    if (req.headers.authorization) {
      const token = req.headers.authorization.match(/^Bearer (\S+)$/)?.[1];
      if (!token) throw problem('invalid_identity_token', 401);
      return db.identity(await claims(token));
    }
    const token = cookie(req, sessionCookie);
    if (!token) throw problem('login_required', 401);
    if (m1) return sessions.user(hash(token));
    const {
      rows: [u],
    } = await db.pool.query(
      `SELECT u.* FROM hd_sessions s JOIN hd_users u USING(user_id)
      WHERE s.token_hash=$1 AND s.expires_at>now()`,
      [hash(token)],
    );
    if (!u) throw problem('login_required', 401);
    return u;
  };
  return {
    user,
    claims,
    async principal(req) {
      if (req.headers.authorization?.startsWith('Bearer hd_ag_')) {
        if (!db.agentPrincipal) throw problem('agent_delegation_unavailable', 403);
        return db.agentPrincipal(req);
      }
      const u = await user(req);
      const { rows } = await db.pool.query(
        `SELECT s.space_id FROM hd_memberships m JOIN hd_schools s USING(school_id) WHERE m.user_id=$1 AND m.active`,
        [u.user_id],
      );
      const aliases = m1
        ? (
            await db.pool.query('SELECT guest_id FROM hd_guest_bindings WHERE user_id=$1', [
              u.user_id,
            ])
          ).rows.map((r) => r.guest_id)
        : [];
      return {
        id: u.user_id,
        ...(m1 ? { ownershipIds: [u.user_id, ...aliases] } : {}),
        tenantBound: true,
        spaces: rows.map((s) => s.space_id),
        scopes: ['public:read', 'a2a:call'],
      };
    },
    async handle(req, res, url) {
      if (['/auth/login', '/auth/register'].includes(url.pathname) && req.method === 'GET') {
        const state = randomBytes(32).toString('base64url'),
          verifier = randomBytes(32).toString('base64url'),
          nonce = randomBytes(24).toString('base64url');
        await db.pool.query(
          "INSERT INTO hd_auth_flows VALUES($1,$2,$3,now()+interval '5 minutes')",
          [hash(state), verifier, nonce],
        );
        const u = new URL(
          config.issuer +
            '/protocol/openid-connect/' +
            (url.pathname === '/auth/register' && m1 ? 'registrations' : 'auth'),
        );
        const challenge = Buffer.from(hash(verifier), 'hex').toString('base64url');
        for (const [k, v] of Object.entries({
          client_id: config.clientId,
          redirect_uri: config.origin + '/auth/callback',
          response_type: 'code',
          scope: 'openid profile email',
          state,
          nonce,
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }))
          u.searchParams.set(k, v);
        setCookie(res, stateCookie, state, 300);
        res.writeHead(302, { Location: u.href });
        res.end();
        return true;
      }
      if (url.pathname === '/auth/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state');
        if (!state || state !== cookie(req, stateCookie)) throw problem('invalid_login_state', 403);
        const {
          rows: [flow],
        } = await db.pool.query(
          'DELETE FROM hd_auth_flows WHERE state_hash=$1 AND expires_at>now() RETURNING *',
          [hash(state)],
        );
        if (!flow) throw problem('expired_login_state', 403);
        const response = await fetch(config.issuer + '/protocol/openid-connect/token', {
          method: 'POST',
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: config.clientId,
            ...(m1 ? { client_secret: config.clientSecret } : {}),
            code: url.searchParams.get('code') || '',
            redirect_uri: config.origin + '/auth/callback',
            code_verifier: flow.verifier,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw problem('identity_exchange_failed', 401);
        const data = await response.json(),
          id = await claims(data.id_token);
        if (id.nonce !== flow.nonce) throw problem('invalid_login_nonce', 403);
        const u = await db.identity(id),
          token = randomBytes(32).toString('base64url');
        if (m1) await sessions.create(hash(token),u,data);
        else await db.pool.query(
          "INSERT INTO hd_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
          [hash(token), u.user_id],
        );
        setCookie(res, sessionCookie, token);
        res.writeHead(302, { Location: m1 ? '/m1.html' : '/m0.html' });
        res.end();
        return true;
      }
      if (url.pathname === '/auth/logout' && req.method === 'POST') {
        await db.pool.query('DELETE FROM hd_sessions WHERE token_hash=$1', [
          hash(cookie(req, sessionCookie) || ''),
        ]);
        setCookie(res, sessionCookie, '', 0);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"loggedOut":true}');
        return true;
      }
      return false;
    },
  };
}
