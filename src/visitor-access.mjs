import {protocol} from './base.mjs';

// Cookies are hostname-scoped, not port-scoped. Each independently keyed school
// instance retains its own identity even when hosted on the same localhost.
export function createVisitorAccess(auth,{secure=false}={}){
  const cookieName='hd_uw_'+protocol.digest(auth.access.cookieSecret).slice(0,16);
  return {cookieName,principal(req,res,options){
    if(!options?.browser||req.headers.authorization!==undefined)return auth.principal(req,res,options);
    const cookies=(req.headers.cookie||'').split(';').map(x=>x.trim());
    const scoped=cookies.find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    const legacy=cookies.find(x=>x.startsWith('hd_base='))?.slice(8);
    let emitted=false;
    const proxy={setHeader(name,value){
      emitted=true;
      if(name.toLowerCase()!=='set-cookie'||typeof value!=='string'||!value.startsWith('hd_base='))throw Error('Unexpected visitor authentication header');
      res.setHeader(name,cookieName+value.slice('hd_base'.length)+(secure?'; Secure':''));
    }};
    // Legacy migration still passes the original HMAC validator. An arbitrary
    // visitor ID, foreign signature or invalid bearer cannot claim old data.
    const principal=auth.principal({headers:{...req.headers,cookie:'hd_base='+(scoped??legacy??'')}},proxy,options);
    if(!emitted&&!scoped&&legacy)res.setHeader('Set-Cookie',cookieName+'='+legacy+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000'+(secure?'; Secure':''));
    return principal;
  }};
}
