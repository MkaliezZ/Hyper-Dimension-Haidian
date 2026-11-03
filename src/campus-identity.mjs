import {protocol} from './base.mjs';

export function createCampusPrincipal({platform,visitorAccess,spaceId}){
  return async(req,res,{browser=false}={})=>{
    const hasMemberCookie=/(?:^|;\s*)hd_m1=/.test(req.headers.cookie||'');
    if(platform&&(req.headers.authorization||hasMemberCookie)){
      try{const principal=await platform.identity.principal(req);protocol.authorize(principal,spaceId);return principal;}
      catch(error){
        // An expired school login must not make public visiting unusable. Bearer
        // requests, membership denials and business APIs retain their own gates.
        if(!browser||req.headers.authorization||error.status!==401)throw error;
        const visitor=visitorAccess.principal(req,res,{browser:true}),prior=res.getHeader('Set-Cookie');
        res.setHeader('Set-Cookie',[...(prior?Array.isArray(prior)?prior:[prior]:[]),'hd_m1=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0']);
        return {...visitor,loginExpired:true};
      }
    }
    return visitorAccess.principal(req,res,{browser});
  };
}
