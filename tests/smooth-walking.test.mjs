import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {baseRoot,projectRoot} from '../src/base.mjs';import {createCameraCollisionIndex,unobstructedVisitorCamera} from '../compat/3d-v052/public/visitor-camera.js';import {createWalkPresentation,motionPoint} from '../public/walk-motion.js';import {createCampusWalking,WALK_RADIUS,WALK_SPEED} from '../public/campus-walking.js';import {installCampusEnvironment,explorationBounds} from '../compat/3d-v052/public/campus-environment.js';import {positionAlong} from '../src/navigation.mjs';
const T=await import(pathToFileURL(join(baseRoot,'node_modules/three/build/three.module.js')).href),campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8'));
const fixture={bounds:[-50,-50,50,50],terrain:{bounds:[-50,-50,50,50],width:2,height:2,heights:[0,0,0,0]},paths:[],buildings:[]};

test('indexed camera rays preserve native hits, transforms, material sides and instances without altering source geometry',()=>{
  const scene=new T.Scene(),meshes=[],geometry=new T.BoxGeometry(2,8,2),material=new T.MeshBasicMaterial({side:T.DoubleSide});
  for(let i=0;i<100;i++){const mesh=new T.Mesh(geometry,material);mesh.position.set((i%10)*12-50,4,Math.floor(i/10)*12-50);mesh.rotation.y=i*.1;scene.add(mesh);meshes.push(mesh);}
  const instanced=new T.InstancedMesh(geometry,material,2),matrix=new T.Matrix4();instanced.setMatrixAt(0,matrix.makeTranslation(3,4,2));instanced.setMatrixAt(1,matrix.makeTranslation(-3,4,-2));scene.add(instanced);meshes.push(instanced);scene.updateMatrixWorld(true);
  const before=[...geometry.attributes.position.array],index=createCameraCollisionIndex(T,meshes);
  for(let i=0;i<100;i++){const origin=new T.Vector3(Math.sin(i)*10,1+i%5,Math.cos(i*2)*10),direction=new T.Vector3(Math.cos(i),.1,Math.sin(i)).normalize(),far=12;const raw=new T.Raycaster(origin,direction,.1,far).intersectObjects(meshes)[0]?.distance??far;assert(Math.abs(index.cast(origin,direction,far)-raw)<1e-6);}
  const target=new T.Vector3(0,1,0),position=new T.Vector3(7,4,8);assert(unobstructedVisitorCamera(T,target,position,index).distanceTo(unobstructedVisitorCamera(T,target,position,meshes))<1e-6);
  assert(index.stats.lastCandidateTriangles<index.stats.sourceTriangles*.25);assert.deepEqual([...geometry.attributes.position.array],before);index.dispose();assert.equal(geometry.attributes.position.count,before.length/3);geometry.dispose();material.dispose();
});

test('render prediction advances before HTTP returns, reconciles gradually and stops at the same campus boundary',()=>{
  const walking=createCampusWalking(fixture),presentation=createWalkPresentation(walking,[0,.055,0]);presentation.reset([0,.055,0],0);
  let previous=0,minStep=Infinity,maxStep=0;
  for(let frame=1;frame<=180;frame++){const now=frame*16;if(frame%15===0)presentation.acknowledge([Math.max(0,WALK_SPEED*(now-90)/1000),.055,0],now);const point=presentation.advance([1,0],16,now),step=point[0]-previous;minStep=Math.min(minStep,step);maxStep=Math.max(maxStep,step);previous=point[0];}
  assert(minStep>.005,'holding a direction must not freeze between acknowledgements');assert(maxStep<.13,'acknowledgements must not teleport the display');assert(previous>10);
  const stopped=previous;for(let i=0;i<20;i++)assert.equal(presentation.advance(null,16,3000+i*16)[0],stopped);
  // A small stop receipt is eased into view rather than applied as one visible jump.
  presentation.acknowledge([stopped+.2,.055,0],3400);const first=presentation.advance(null,16,3416);assert(first[0]>stopped&&first[0]<stopped+.06);
  presentation.reset([47.5,.055,0],4000);for(let i=1;i<=100;i++){presentation.acknowledge([47.5,.055,0],4000+i*16);const point=presentation.advance([1,0],16,4000+i*16);assert(point[0]<=48-WALK_RADIUS+.000001);}
});

test('display sampling matches authoritative multi-segment motion and disconnected prediction has a fixed horizon',()=>{
  const move={path:[{point:[0,0,0]},{point:[2,0,0]},{point:[2,1,3]}],startedAt:1000,previewSpeed:4};for(const now of [500,1000,1200,1500,1800,3000])assert.deepEqual(motionPoint(move,now),positionAlong(move,now));
  const w=createCampusWalking(fixture),p=createWalkPresentation(w,[0,.055,0]);p.reset([0,.055,0],0);for(let i=1;i<=35;i++)p.advance([1,0],16,i*16);const stopped=p.advance([1,0],16,700);assert.deepEqual(p.advance([1,0],16,900),stopped);assert(stopped[0]<=WALK_SPEED*.5+.01);
});

test('sky and boundary remain lightweight, share the movement limits and stop all four outward directions',()=>{
  const scene=new T.Scene(),environment=installCampusEnvironment(T,scene,campus);assert.deepEqual(environment.bounds,explorationBounds(campus));assert.equal(environment.clouds.children.length,1);assert.equal(environment.clouds.children[0].count,48);assert.equal(environment.stats.realTimeWeather,false);
  const camera=new T.PerspectiveCamera();camera.position.set(10,30,40);environment.update(camera);assert.deepEqual(environment.sky.position.toArray(),[10,30,40]);environment.dispose();assert.equal(scene.children.length,0);
  const w=createCampusWalking(fixture);for(const direction of [[1,0],[-1,0],[0,1],[0,-1]]){let point=[0,.055,0],blocked=false;for(let i=0;i<40;i++){const result=w.step(point,direction,500);point=result.path.at(-1).point;blocked ||=result.boundaryBlocked;assert(w.allowed(point[0],point[2]));}assert(blocked);assert(Math.abs(point[0])<=48-WALK_RADIUS&&Math.abs(point[2])<=48-WALK_RADIUS);}
});
