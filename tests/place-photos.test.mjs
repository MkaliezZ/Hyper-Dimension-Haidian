import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const load=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const registry=await load('data/haidian-place-photos.json');
const manifest=await load('public/assets/place-photos/manifest.json');
const campus=await load('data/campus.json');

function jpegSize(bytes){
  assert.equal(bytes.readUInt16BE(0),0xffd8);
  let at=2;
  while(at<bytes.length){
    assert.equal(bytes[at],255);
    while(bytes[at]===255)at++;
    const marker=bytes[at++];
    if(marker===0xd8||marker===0xd9||(marker>=0xd0&&marker<=0xd7))continue;
    const length=bytes.readUInt16BE(at);
    if([0xc0,0xc1,0xc2].includes(marker))return [bytes.readUInt16BE(at+5),bytes.readUInt16BE(at+3)];
    at+=length;
  }
  throw new Error('Missing JPEG dimensions');
}

test('every selectable Haidian place has a reviewed photo or an explicit unresolved reason',()=>{
  const ids=new Set([...campus.buildings,...campus.landmarks].map(p=>p.id));
  assert.deepEqual(new Set(Object.keys(registry.places)),ids);
  assert.deepEqual(new Set(Object.keys(manifest)),ids);
  assert.equal(registry.campusId,campus.id);
  assert.match(registry.collection.title,/海淀校区/);
  const sources=new Map(registry.photos.map(photo=>[photo.id,photo]));
  for(const [id,match] of Object.entries(registry.places)){
    const published=manifest[id];
    if(match.status==='unavailable'){
      assert.equal(published.status,'unavailable');
      assert.equal(published.note,match.reason);
      assert.ok(match.reason.length>10);
      assert.equal(published.path,undefined,'No substitute photo for an unidentified building');
    }else{
      const photo=sources.get(match.photoId);assert.ok(photo,id);
      assert.equal(published.path,photo.path);
      assert.equal(published.viewLabel,match.viewLabel);
      assert.equal(published.sceneId,photo.sceneId);
      assert.equal(published.sha256,photo.sha256);
      assert.equal(published.source,photo.source);
      assert.equal(published.license,'原作者保留权利');
      assert.equal(published.date,null,'Unknown capture dates stay unknown');
      assert.ok(match.evidence.length>20);
      if(match.match==='shared-complex')assert.match(published.viewLabel,/楼群/);
    }
  }
});

test('published photos are unchanged, locally available original frames from the official Haidian collection',async()=>{
  for(const photo of registry.photos){
    assert.match(photo.path,/^\/assets\/place-photos\/haidian-vr-\d+-[frbl]\.jpg$/);
    assert.equal(photo.source,`https://720yun.com/t/b2vkue1es1q?scene_id=${photo.sceneId}`);
    const original=new URL(photo.original);
    assert.match(original.hostname,/^ssl-panoimg\d+\.720static\.com$/);
    assert.match(original.pathname,/\/833jOgyaey0\/\d+\/imgs\/mobile_[frbl]\.jpg$/);
    assert.ok(photo.sceneGroup&&!photo.sceneGroup.includes('幼儿园'));
    const bytes=await readFile(new URL('public'+photo.path,root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),photo.sha256,photo.id);
    assert.deepEqual(jpegSize(bytes),[photo.width,photo.height],photo.id);
  }
});
