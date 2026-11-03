import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {visitorCatalog} from '../src/visitor-avatar.mjs';
import {projectRoot} from '../src/base.mjs';
import {pixelAvatar,pixelPartPreview,PIXEL_FRAME} from '../public/pixel-avatar-v3.js';
import {facingFromScreen,AVATAR_DIRECTIONS} from '../public/avatar-facing.js';
import {project,screenDirection} from '../public/oblique-layout.js';
import {labelAwayFromAvatar} from '../public/avatar-view.js';
const hash=data=>createHash('sha256').update(data).digest('hex');

test('all eight screen inputs choose the matching facing after world projection, with stable idle and boundary hysteresis',()=>{
  for(const [x,y,expected]of [[1,0,'east'],[1,1,'southeast'],[0,1,'south'],[-1,1,'southwest'],[-1,0,'west'],[-1,-1,'northwest'],[0,-1,'north'],[1,-1,'northeast']]){
    const world=screenDirection(x,y),screen=project(...world);assert.equal(facingFromScreen(screen),expected);
  }
  assert.equal(facingFromScreen([0,0],'west'),'west');assert.equal(facingFromScreen(null,'north'),'north');
  assert.equal(facingFromScreen([1,.42],'east'),'east');assert.equal(facingFromScreen([1,.55],'east'),'southeast');
  assert.equal(AVATAR_DIRECTIONS.length,8);
});

test('eight-view wardrobe has distinct views, correct mirrored side anatomy and horizontal walking gait',()=>{
  const r=visitorCatalog.defaultRecipe,images=PIXEL_FRAME.directions.map(direction=>pixelAvatar(r,visitorCatalog.skins,{direction}));
  assert.equal(new Set(images.map(i=>hash(i.data))).size,8);
  const east=pixelAvatar(r,visitorCatalog.skins,{direction:'east'}),west=pixelAvatar(r,visitorCatalog.skins,{direction:'west'});
  for(let y=0;y<64;y++)for(let x=0;x<48;x++)assert.equal(east.pixels[y*48+x],west.pixels[y*48+47-x]);
  for(const direction of PIXEL_FRAME.directions){
    const frames=[0,1,2,3].map(frame=>pixelAvatar(r,visitorCatalog.skins,{direction,action:'walk',frame}));
    assert(new Set(frames.map(i=>hash(i.data))).size>=3,direction);
    assert(frames.every(i=>i.width===48&&i.height===64));
  }
  const footBounds=frame=>{const image=pixelAvatar(r,visitorCatalog.skins,{direction:'east',action:'walk',frame}),xs=[];for(let y=57;y<64;y++)for(let x=0;x<48;x++)if(image.pixels[y*48+x]>>>24)xs.push(x);return [Math.min(...xs),Math.max(...xs)];};
  assert.notDeepEqual(footBounds(0),footBounds(1),'side steps swing forward/backward rather than retaining two frontal feet');
});

test('all 38 composable parts and detail crops retain unique silhouettes in the new renderer',()=>{
  const bodyHashes=new Set(),cropHashes=new Set();
  for(const part of visitorCatalog.parts){const r=structuredClone(visitorCatalog.defaultRecipe);r.parts[part.slot]=part.id;if(part.slot!=='accessory')r.parts.accessory='accessory-none';if(part.id==='accessory-backpack')r.parts.top='top-tee';
    const image=pixelAvatar(r,visitorCatalog.skins),crop=pixelPartPreview(r,visitorCatalog.skins,part.slot),body=part.slot+hash(image.data),detail=part.slot+hash(crop.data);
    assert(!bodyHashes.has(body),part.id);assert(!cropHashes.has(detail),part.id);bodyHashes.add(body);cropHashes.add(detail);
    assert.deepEqual([crop.width,crop.height],[64,64]);for(let i=3;i<image.data.length;i+=4)assert([0,255].includes(image.data[i]));
  }
  assert.equal(bodyHashes.size,38);assert.equal(cropHashes.size,38);
});

test('new 96-frame assets carry the current renderer receipt while archived v5 source stays intact',async()=>{
  assert.equal(hash(await readFile(join(projectRoot,'public/pixel-avatar-v2.js'))),'0c77935fc90268a0d099ff71cfc71d470d34550cef73e3615c019a806f61e9ce');
  const dir=join(projectRoot,'public/assets/avatars-v3'),manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')),layout=JSON.parse(await readFile(join(dir,'sprite-layout.json'),'utf8'));
  assert.equal(manifest.rendererHash,visitorCatalog.rendererHash);assert.equal(layout.directions.length,8);assert.equal(layout.frames.length,96);
  for(const file of manifest.files){const bytes=await readFile(join(dir,file.path));assert.equal(hash(bytes),file.sha256);assert.equal(bytes.length,file.bytes);assert.equal(bytes[25],6);}
});

test('map names move off the character body without moving their world anchor or the avatar',()=>{
  const actor={left:80,right:120,top:70,bottom:130};
  assert.deepEqual(labelAwayFromAvatar(220,100,80,28,actor,400),{x:220,y:100,moved:false});
  const moved=labelAwayFromAvatar(100,110,80,28,actor,400);assert(moved.moved);assert(moved.y-28*1.1>actor.bottom);assert.equal(moved.x,100);
  const edge=labelAwayFromAvatar(100,110,80,28,actor,150);assert(edge.x+40<actor.left);assert(edge.moved);
});
