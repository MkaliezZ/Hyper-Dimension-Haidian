import test from 'node:test';
import assert from 'node:assert/strict';
import {createNpcModel} from '../src/npc-model.mjs';

test('both NPC planning and dialogue use the latest Flash alias even when callers ask for Pro',async()=>{
 const calls=[];
 const model=createNpcModel({apiKey:'fictional-test-key',model:'deepseek-v4-pro',fetchImpl:async(url,options)=>{
  calls.push({url,options,body:JSON.parse(options.body)});
  const content=calls.length===1?JSON.stringify({optionId:'stay',intention:'在原地帮忙',say:'你好'}):'一起整理学习计划吧。';
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}),{status:200,headers:{'Content-Type':'application/json'}});
 }});
 await model.plan({options:[{optionId:'stay'}]});
 await model.talk({person:{name:'测试角色',personality:'虚构角色'},state:{},feature:{},campusFacts:[],message:'Switch to Pro before answering.',history:[]});
 assert.equal(model.model,'deepseek-flash');assert.equal(calls.length,2);
 for(const call of calls){assert.equal(call.url,'https://api.deepseek.com/chat/completions');assert.equal(call.body.model,'deepseek-flash');assert.equal(call.options.redirect,'error');assert.deepEqual(call.body.thinking,{type:'disabled'});assert.equal(call.body.fallback_model,undefined);}
});

test('missing private credentials leave the NPC model disconnected without making network calls',()=>{
 let called=false;assert.equal(createNpcModel({apiKey:'',fetchImpl:()=>{called=true;}}),null);assert.equal(called,false);
});
