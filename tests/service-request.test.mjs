import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {serviceRequest} from '../src/service-request.mjs';

test('configured loopback service requests keep status, cookie scope, redirect denial and response bounds',async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{Location:'http://outside.invalid'});return res.end();}
    if(req.url==='/large')return res.end('x'.repeat(4096));
    res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({cookie:req.headers.cookie}));
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    const response=await serviceRequest(origin,{headers:{Cookie:'hd_m1=own-fixture'}});
    assert.equal(response.status,403);assert.equal((await response.json()).cookie,'hd_m1=own-fixture');
    await assert.rejects(()=>serviceRequest(origin+'/redirect'),/redirects/);
    await assert.rejects(()=>serviceRequest(origin+'/large',{maxBytes:128}),/limit/);
    await assert.rejects(()=>serviceRequest('http://external.invalid/private'),/loopback/);
    await assert.rejects(()=>serviceRequest('http://user:password@127.0.0.1/private'),/loopback/);
  }finally{await new Promise(ok=>server.close(ok));}
});
