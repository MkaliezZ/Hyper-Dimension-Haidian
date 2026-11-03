'use strict';
// UW school adapter: explicit local HTTP bridge, with no redirects or proxy.
// This preserves the established 4190 campus URL on Node versions whose Fetch
// port policy includes Sieve. School authorization remains in the Base routes.
const http = require('node:http');
module.exports = async function bridgeRequest(url, options) {
  const target = new URL(url);
  if (target.protocol !== 'http:') return fetch(target, { ...options, redirect: 'error' });
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.username || target.password)
    throw Error('Forum bridge requires configured loopback HTTP or HTTPS');
  return new Promise((resolve, reject) => {
    const req = http.request(target, { method: options.method, headers: options.headers, signal: options.signal, agent: false }, (res) => {
      const chunks = []; let size = 0;
      res.on('error', reject);
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 128000) { const error = Error('Forum bridge response exceeds limit'); reject(error); res.destroy(); req.destroy(error); }
        else chunks.push(chunk);
      });
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400) return reject(Error('Forum bridge redirects are refused'));
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers }));
      });
    });
    req.once('error', reject); req.end(options.body);
  });
};
