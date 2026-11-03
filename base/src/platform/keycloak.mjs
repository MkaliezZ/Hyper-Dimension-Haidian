import { problem } from './db.mjs';
// Confidential server credentials never enter HTML, tickets, model prompts or logs.
export function keycloak(config) {
  let adminToken,
    until = 0;
  const endpoint = config.issuer + '/protocol/openid-connect/';
  async function admin(path, method = 'GET', body) {
    if (Date.now() > until) {
      const r = await fetch(endpoint + 'token', {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.identityAdmin.clientId,
          client_secret: config.identityAdmin.secret,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw problem('identity_service_unavailable', 503);
      const d = await r.json();
      adminToken = d.access_token;
      until = Date.now() + (d.expires_in - 15) * 1000;
    }
    const realm = new URL(config.issuer).pathname.split('/').pop();
    const r = await fetch(
      new URL('/admin/realms/' + encodeURIComponent(realm) + '/' + path, config.issuer),
      {
        method,
        headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!r.ok) throw problem('identity_service_unavailable', 503);
    return r.status === 204 ? {} : r.json();
  }
  return {
    admin,
    async active(token) {
      const r = await fetch(endpoint + 'token/introspect', {
        method: 'POST',
        body: new URLSearchParams({
          token,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw problem('identity_service_unavailable', 503);
      const d = await r.json();
      if (!d.active) throw problem('identity_session_expired', 401);
    },
  };
}
