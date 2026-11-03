import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBrowserTokens,identityFailure} from '../base/src/platform/browser-sessions.mjs';
const clock=()=>100000,config={issuer:'https://identity.test/realm',clientId:'school',clientSecret:'server-only-fixture'};
const payload={sub:'member',iss:config.issuer},row={access_token:'expired-access',refresh_token:'refresh-1',refresh_expires_at:new Date(200000),subject:'member',issuer:config.issuer};
const expired=()=>Object.assign(Error('expired'),{status:401,expired:true});
function dependencies(change={}) {return {config,now:clock,claims:async token=>{if(token==='expired-access')throw expired();return payload;},verifyToken:async()=>payload,request:async()=>({ok:true,json:async()=>({access_token:'new-access',refresh_token:'refresh-2',refresh_expires_in:1800})}),...change};}
test('valid browser access retains identity without any refresh request',async()=>{
  const r=await resolveBrowserTokens({...row,access_token:'current'},dependencies({request:()=>assert.fail('must not refresh current token')}));assert.deepEqual(r,{payload});
});
test('a current access token belonging to another subject cannot change the browser identity',async()=>{
  const r=await resolveBrowserTokens({...row,access_token:'current'},dependencies({claims:async()=>({...payload,sub:'other'}),request:()=>assert.fail('must not renew an identity mismatch')}));assert.equal(r.error.status,401);assert(r.invalidate);
});
test('expired browser access exchanges only the server-held refresh token and rotates it',async()=>{
  let calls=0;const r=await resolveBrowserTokens(row,dependencies({request:async(url,init)=>{calls++;assert.equal(url,config.issuer+'/protocol/openid-connect/token');assert.equal(init.body.get('grant_type'),'refresh_token');assert.equal(init.body.get('client_secret'),config.clientSecret);assert.equal(init.body.get('refresh_token'),'refresh-1');return {ok:true,json:async()=>({access_token:'new-access',refresh_token:'refresh-2',refresh_expires_in:1800})};}}));assert.equal(calls,1);assert.deepEqual(r.payload,payload);assert.equal(r.tokens.refresh,'refresh-2');assert.equal(r.tokens.expiresAt.getTime(),1900000);
});
test('revocation and ordinary identity denials never trigger silent renewal',async()=>{
  for(const status of [401,403]){const r=await resolveBrowserTokens(row,dependencies({claims:async()=>{throw Object.assign(Error('revoked'),{status});},request:()=>assert.fail('revoked access must stay denied')}));assert.equal(r.error.status,status);assert.equal(r.tokens,undefined);}
});
test('missing, invalid or expired server refresh state cannot renew a browser session',async()=>{
  for(const change of [{refresh_token:null},{refresh_expires_at:new Date(99999)},{refresh_expires_at:'invalid'}]){const r=await resolveBrowserTokens({...row,...change},dependencies({request:()=>assert.fail('expired refresh state')}));assert.equal(r.error.status,401);assert(!r.tokens);}
});
test('an invalid refresh grant invalidates the opaque browser session',async()=>{
  const r=await resolveBrowserTokens(row,dependencies({request:async()=>({ok:false,status:400,json:async()=>({error:'invalid_grant'})})}));assert.equal(r.error.status,401);assert(r.invalidate);assert(!r.tokens);
});
test('provider outages and provider throttling preserve the existing session for retry',async()=>{
  for(const request of [async()=>{throw Error('offline')},async()=>({ok:false,status:503}),async()=>({ok:false,status:429}),async()=>({ok:false,status:401,json:async()=>({error:'invalid_client'})})]){const r=await resolveBrowserTokens(row,dependencies({request}));assert.equal(r.error.status,503);assert(!r.invalidate);assert(!r.tokens);}
});
test('renewal cannot switch the authenticated subject or issuer',async()=>{
  for(const p of [{...payload,sub:'other'},{...payload,iss:'https://other.test'}]){const r=await resolveBrowserTokens(row,dependencies({verifyToken:async()=>p}));assert.equal(r.error.status,401);assert(r.invalidate);assert(!r.tokens);}
});
test('a rotated token survives a temporary later validation outage',async()=>{
  const r=await resolveBrowserTokens(row,dependencies({claims:async t=>{throw t==='expired-access'?expired():Object.assign(Error('unavailable'),{status:503});}}));assert.equal(r.error.status,503);assert.equal(r.tokens.refresh,'refresh-2');assert(!r.invalidate);
});
test('an account disabled after renewal is rejected and the browser session invalidated',async()=>{
  const r=await resolveBrowserTokens(row,dependencies({claims:async t=>{throw t==='expired-access'?expired():Object.assign(Error('disabled'),{status:403});}}));assert.equal(r.error.status,403);assert(r.invalidate);
});
test('transport outages are unavailable, while JWT expiry alone permits browser renewal',()=>{
  for(const e of [new TypeError('offline'),Object.assign(Error('timeout'),{name:'TimeoutError'}),Object.assign(Error('JWKS timeout'),{code:'ERR_JWKS_TIMEOUT'})])assert.equal(identityFailure(e).status,503);
  assert.equal(identityFailure(Object.assign(Error('bad signature'),{code:'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'})).status,401);
  assert.equal(identityFailure(Object.assign(Error('expired'),{code:'ERR_JWT_EXPIRED'})).expired,true);
});
test('temporary key discovery failure retains rotated credentials without authorizing a request',async()=>{
  const r=await resolveBrowserTokens(row,dependencies({verifyToken:async()=>{throw new TypeError('key service unavailable')}}));assert.equal(r.error.status,503);assert.equal(r.tokens.refresh,'refresh-2');assert(!r.invalidate);assert(!r.payload);
});
