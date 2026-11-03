import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {projectRoot,loadAccess} from '../src/base.mjs';
import {createVisitorAccess} from '../src/visitor-access.mjs';

test('independent localhost instances keep different signed cookies; valid legacy migration preserves ownership',async()=>{
 await mkdir(join(projectRoot,'.local'),{recursive:true});
 const dir=await mkdtemp(join(projectRoot,'.local/qa-cookie-scope-'));
 try{
  const a=createVisitorAccess(await loadAccess(join(dir,'a'),['uw-seattle'])),b=createVisitorAccess(await loadAccess(join(dir,'b'),['uw-seattle']));
  assert.notEqual(a.cookieName,b.cookieName);
  const call=(access,cookie)=>{let set;const principal=access.principal({headers:{cookie}}, {setHeader(k,v){assert.equal(k,'Set-Cookie');set=v;}},{browser:true});return {principal,cookie:set?.split(';')[0]};};
  const first=call(a,''),other=call(b,first.cookie);assert.notEqual(first.principal.id,other.principal.id);
  const jar=first.cookie+'; '+other.cookie;
  assert.equal(call(a,jar).principal.id,first.principal.id);assert.equal(call(b,jar).principal.id,other.principal.id);
  const legacy=first.cookie.replace(a.cookieName+'=','hd_base='),migrated=call(a,legacy);
  assert.equal(migrated.principal.id,first.principal.id);assert.equal(migrated.cookie,first.cookie);
  const foreign=call(a,other.cookie.replace(b.cookieName+'=','hd_base='));assert.notEqual(foreign.principal.id,other.principal.id);assert.notEqual(foreign.principal.id,first.principal.id);
  assert.throws(()=>a.principal({headers:{authorization:'Bearer invalid'}},{setHeader(){}},{browser:true}));
  const secure=createVisitorAccess(await loadAccess(join(dir,'a'),['uw-seattle']),{secure:true});
  let secureHeader;secure.principal({headers:{}},{setHeader(k,v){secureHeader=v;}},{browser:true});assert(secureHeader.endsWith('; Secure'));
 }finally{await rm(dir,{recursive:true});}
});
