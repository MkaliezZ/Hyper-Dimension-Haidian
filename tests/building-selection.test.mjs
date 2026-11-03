import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceSelection} from '../public/surface-selection.js';

test('selection follows visible per-tile owners, excludes foreground objects and transparent pixels',()=>{
  // Local owner 1 is building 314; local owner 2 is the foreground tree 88.
  const rgba=Uint8ClampedArray.from([0,0,1,255,0,0,2,255,0,0,1,0,0,0,1,255]);
  const mask=surfaceSelection(rgba,2,2,[0,314,88],314);
  assert.equal(mask.pixels,2);
  assert(mask.data[3]>0);assert.equal(mask.data[7],0);assert.equal(mask.data[11],0);assert(mask.data[15]>0);
  assert.equal(surfaceSelection(rgba,2,2,[0,314,88],999).pixels,0);
});

test('selection edge is strong and interior is a light tint without modifying depth bytes',()=>{
  const rgba=new Uint8ClampedArray(5*5*4);for(let i=0;i<rgba.length;i+=4)rgba.set([128,12,1,255],i);
  const original=rgba.slice(),mask=surfaceSelection(rgba,5,5,[0,75],75);
  assert.equal(mask.pixels,25);assert.equal(mask.data[3],230);assert.equal(mask.data[(2*5+2)*4+3],42);
  assert.deepEqual(rgba,original);
});

test('a building crossing four tiles has no internal grid, even when tile owner palettes differ',()=>{
  const size=4,worldSize=8,world=new Array(64).fill(75),read=(x,y)=>x>=0&&y>=0&&x<8&&y<8?world[y*8+x]:null;
  function render(){const result=new Uint8ClampedArray(64);for(let ty=0;ty<2;ty++)for(let tx=0;tx<2;tx++){
    const owners=(tx+ty)%2?[0,999,75]:[0,75,999],rgba=new Uint8ClampedArray(64);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)rgba.set([0,0,owners.indexOf(read(tx*4+x,ty*4+y)),255],(y*4+x)*4);
    const mask=surfaceSelection(rgba,size,size,owners,75,(x,y)=>read(tx*4+x,ty*4+y)===75);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)result[(ty*4+y)*8+tx*4+x]=mask.data[(y*4+x)*4+3];
  }return result;}
  const mask=render();for(let y=1;y<7;y++)for(let x=1;x<7;x++)assert.equal(mask[y*8+x],42,`interior ${x},${y}`);
  assert.equal(mask[0],230);assert.equal(mask[63],230);
  world[2*8+4]=999;const occluded=render();assert.equal(occluded[2*8+4],0);assert.equal(occluded[2*8+3],230);assert.equal(occluded[5*8+3],42);
});
