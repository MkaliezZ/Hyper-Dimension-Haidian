import http from 'node:http';

// The configured local HTTP service is intentional (including Sieve's 4190
// port used by the established preview). No proxy, redirect or user URL is
// accepted here. HTTPS deployments retain the standard Fetch implementation.
export async function serviceRequest(url,{headers={},timeout=4000,maxBytes=128000}={}){
  const target=new URL(url);
  if(target.protocol!=='http:')return fetch(target,{headers,redirect:'error',signal:AbortSignal.timeout(timeout)});
  if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.username||target.password)throw Error('Only configured loopback HTTP services are supported');
  return new Promise((resolve,reject)=>{
    const req=http.get(target,{headers,agent:false},res=>{
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){const error=Error('Service response exceeds limit');reject(error);res.destroy();req.destroy(error);}else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{
        if(res.statusCode>=300&&res.statusCode<400)return reject(Error('Service redirects are not accepted'));
        resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers}));
      });
    });
    const timer=setTimeout(()=>req.destroy(Error('Service response timeout')),timeout);
    req.once('close',()=>clearTimeout(timer));req.once('error',reject);
  });
}
