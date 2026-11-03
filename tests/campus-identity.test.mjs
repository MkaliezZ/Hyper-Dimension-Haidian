import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampusPrincipal} from '../src/campus-identity.mjs';
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];}});
test('expired school cookies return to an independently authenticated visitor and preserve both cookie headers',async()=>{
  const principal={id:'own-visitor',spaces:['uw-seattle'],scopes:['public:read']};
  const resolve=createCampusPrincipal({spaceId:'uw-seattle',platform:{identity:{async principal(){throw Object.assign(Error('expired'),{status:401});}}},visitorAccess:{principal(req,res){assert(req.headers.cookie.includes('hd_uw_proof'));res.setHeader('Set-Cookie','hd_uw_proof=renewed; HttpOnly');return principal;}}});
  const res=response(),result=await resolve({headers:{cookie:'hd_uw_proof=valid; hd_m1=expired'}},res,{browser:true});assert.equal(result.id,'own-visitor');assert(result.loginExpired);assert.deepEqual(res.headers['Set-Cookie'],['hd_uw_proof=renewed; HttpOnly','hd_m1=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0']);
  await assert.rejects(()=>resolve({headers:{cookie:'hd_uw_proof=valid; hd_m1=expired'}},response(),{browser:false}),{status:401});
  await assert.rejects(()=>resolve({headers:{authorization:'Bearer invalid',cookie:'hd_uw_proof=valid'}},response(),{browser:true}),{status:401});
});
test('valid member identity remains tenant-bound and revoked or foreign-school membership never falls back',async()=>{
  let spaces=['uw-seattle'],denied=false;const platform={identity:{async principal(){if(denied)throw Object.assign(Error('disabled'),{status:403});return {id:'member',spaces,scopes:['public:read'],tenantBound:true};}}};
  const resolve=createCampusPrincipal({spaceId:'uw-seattle',platform,visitorAccess:{principal(){assert.fail('no guest fallback for member denial');}}});
  assert.equal((await resolve({headers:{cookie:'hd_m1=valid'}},response(),{browser:true})).id,'member');
  spaces=['other-school'];await assert.rejects(()=>resolve({headers:{cookie:'hd_m1=valid'}},response(),{browser:true}),{status:403});
  denied=true;await assert.rejects(()=>resolve({headers:{cookie:'hd_m1=valid'}},response(),{browser:true}),{status:403});
});
