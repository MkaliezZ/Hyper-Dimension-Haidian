import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {baseRoot,projectRoot} from '../src/base.mjs';
import {ROOF_PROFILES,buildFoldedRoof,roofFrame,pointInBuilding,towerSupport} from '../compat/3d-v052/public/building-roofs.js';
const THREE=await import(pathToFileURL(join(baseRoot,'node_modules/three/build/three.module.js')).href);
const campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8'));

test('folded roofs remain over the owning GIS footprint, avoid courtyards and meet the actual roof height',()=>{
  for(const profile of ROOF_PROFILES){
    const b=campus.buildings.find(row=>row.code===profile.code),model=buildFoldedRoof(THREE,b,profile);
    assert.equal(model.baseY,b.baseY+b.height);
    const p=model.geometry.attributes.position,n=model.geometry.attributes.normal;
    assert(model.topVertexCount>0);assert.equal(p.count%3,0);
    for(let i=0;i<model.topVertexCount;i+=3){
      let x=0,z=0;
      for(let j=0;j<3;j++){
        const k=i+j;x+=p.getX(k)/3;z+=p.getZ(k)/3;
        assert(Number.isFinite(p.getY(k)));assert(p.getY(k)>=model.baseY-1e-5);assert(p.getY(k)<=model.baseY+profile.rise+1e-5);
        assert(n.getY(k)>0,profile.code+' inverted roof face');
      }
      assert(pointInBuilding(x,z,b.rings),profile.code+' roof floats outside its building or over a courtyard');
    }
    assert(p.count>model.topVertexCount,profile.code+' end faces must be sealed');model.geometry.dispose();
  }
  // Synthetic courtyard crossing the ridge catches accidental hole removal.
  const courtyard={code:'TEST',id:'test',baseY:4,height:9,rings:[[[0,0],[20,0],[20,20],[0,20],[0,0]],[[6,6],[6,14],[14,14],[14,6],[6,6]]]};
  const model=buildFoldedRoof(THREE,courtyard,{code:'TEST',id:'courtyard',a:[0,10],b:[20,10],width:20,rise:5});
  for(const panel of model.panels){const x=panel.reduce((a,p)=>a+p[0],0)/panel.length,z=panel.reduce((a,p)=>a+p[2],0)/panel.length;assert(pointInBuilding(x,z,courtyard.rings));}model.geometry.dispose();
  assert.throws(()=>buildFoldedRoof(THREE,courtyard,{code:'OTHER',a:[0,10],b:[20,10],width:20,rise:5}),/identity/);
});

test('tower attachments share Three.js rotation and are supported by their own building',()=>{
  const b=campus.buildings.find(row=>row.code==='GRB'),model=towerSupport(b);
  assert.equal(model.bottom,b.baseY);assert(model.top>b.baseY+b.height);
  for(const p of model.points)assert(pointInBuilding(p[0],p[2],b.rings));
  for(const angle of [-Math.PI/2,-.44,0,.455,Math.PI/2]){
    const at=roofFrame({x:13,z:27,angle});
    for(const u of [-4,0,4])for(const v of [-4,0,4]){
      const expected=new THREE.Vector3(u,9,v).applyAxisAngle(new THREE.Vector3(0,1,0),angle).add(new THREE.Vector3(13,0,27));
      assert(expected.distanceTo(new THREE.Vector3(...at(u,v,9)))<1e-10,'crown and body rotation differ');
    }
  }
  assert.throws(()=>towerSupport(b,{code:'GRB',x:999,z:999,width:8,depth:8,angle:0,heightAboveRoof:19}),/outside/);
});
