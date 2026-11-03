import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import bridgeRequest from '../base/integrations/nodebb/loopback-http.cjs';

test('school NodeBB callback preserves signed POST body and denies redirects, external HTTP and oversized replies',async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{Location:'http://outside.invalid'});return res.end();}
    if(req.url==='/large')return res.end('x'.repeat(128001));
    const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({method:req.method,key:req.headers['x-hd-service-key'],body:JSON.parse(Buffer.concat(chunks))}));});
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+server.address().port,options={method:'POST',headers:{'Content-Type':'application/json','X-HD-Service-Key':'owned-fixture'},body:JSON.stringify({userId:'own-fictional-user'}),signal:AbortSignal.timeout(3000)};
  try{
    const response=await bridgeRequest(origin,options);assert.equal(response.status,403);
    assert.deepEqual(await response.json(),{method:'POST',key:'owned-fixture',body:{userId:'own-fictional-user'}});
    await assert.rejects(()=>bridgeRequest(origin+'/redirect',options),/redirects/);
    await assert.rejects(()=>bridgeRequest(origin+'/large',options),/limit/);
    await assert.rejects(()=>bridgeRequest('http://external.invalid',options),/loopback/);
  }finally{await new Promise(ok=>server.close(ok));}
});
