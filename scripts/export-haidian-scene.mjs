// Bake a single, metrically registered depth scene. Runtime only loads tiled PNGs.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';import {createHash} from 'node:crypto';
import {projectRoot} from '../src/base.mjs';import {PixelRaster} from '../public/pixel-raster.js';
import {project,projectedBounds} from '../public/oblique-layout.js';
import {surfaceProject,DEPTH_GROUND,HEIGHT_SCALE,encodeSurfaceDepth} from '../public/surface-depth.js';
import {buildArchitecturalMesh,BUILDING_LANGUAGE} from '../src/coherent-buildings.mjs';
import {SurfaceRaster} from '../src/surface-raster.mjs';
import {createHaidianShader} from '../src/haidian-shader.mjs';
import {pixelTree} from '../public/pixel-campus-art.js';
import {encodePng,decodePng} from './png-codec.mjs';import {FOUNTAIN} from '../public/campus-layout.js';
import {campusLandscape,FOUNTAIN_GARDEN} from '../public/campus-landscape.js';
import {drawLandscapeSolids} from '../src/coherent-landscape.mjs';
import {createLandmarkMaterials,drawLandmarkGround,drawRedSquareFeatures,prepareFountainPlume} from '../src/landmark-art.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8')),dir=join(projectRoot,'public/assets/coherent');await mkdir(dir,{recursive:true});
const shader=createHaidianShader(),S=4,tileSize=512;
const b=projectedBounds([[[campus.bounds[0],campus.bounds[1]],[campus.bounds[2],campus.bounds[1]],[campus.bounds[2],campus.bounds[3]],[campus.bounds[0],campus.bounds[3]]]]),left=Math.floor(b[0]-25),top=Math.floor(b[1]-55),width=Math.ceil((b[2]-left+25)*S),height=Math.ceil((b[3]-top+25)*S),raster=new SurfaceRaster(width,height,{left,top,pixelsPerMetre:S});
const objects=[],meshes=campus.buildings.map(buildArchitecturalMesh);let owner=0;
const addObject=row=>{const id=++owner;if(id>65535)throw Error('Scene object capacity exceeded');objects.push({owner:id,...row});return id;};
const primary=new Map(campus.landmarks.filter(p=>p.buildingId).map(p=>[p.buildingId,p.id]));
for(let n=0;n<campus.buildings.length;n++){
  const building=campus.buildings[n],mesh=meshes[n],id=addObject({id:building.id,placeId:primary.get(building.id)||building.id,kind:'building',name:building.name,code:building.code,bounds:mesh.bounds,groundRings:mesh.groundRings,sourceHeight:building.height,heightStatus:building.heightStatus,profile:mesh.profile,architectureKind:building.architecture?.kind,appearanceConfidence:building.architecture?.confidence,architectureSources:building.architecture?.review?.map(r=>r.source),footprintArea:mesh.area,triangulationDeviation:mesh.triangulationDeviation,meshVertices:mesh.meshVertices,sourceScale:1,materialLanguage:BUILDING_LANGUAGE});
  // Soft contact and cast shadow is not a solid depth surface or a collision.
  const shadow=mesh.groundRings.map(r=>r.map(([x,z])=>{const [u,v]=project(x+building.height*.23,z+building.height*.17);return [(u-left)*S,(v-top)*S];}));raster.color.polygon(shadow,(46|57<<8|47<<16|48<<24)>>>0);
}

for(let n=0;n<meshes.length;n++)for(const face of meshes[n].faces)raster.triangle(face,objects[n].owner,shader);
const environment=new PixelRaster(72,32);environment.blit(pixelTree('conifer',1),0,0);environment.blit(pixelTree('broadleaf',1),24,0);environment.blit(pixelTree('broadleaf',4),48,0);const regions=[[0,0,21,27],[24,0,21,27],[48,0,21,27]];
await writeFile(join(dir,'haidian-trees-v1.png'),encodePng(environment));
const addProp=(id,x,z,w,h,region,placeId=null,extra={})=>{const [u,v]=project(x,z),bounds=[u-w/2,v-h,u+w/2,v],oid=addObject({id,placeId,kind:'prop',bounds,point:[x,z],...extra});raster.billboard(environment,regions[region],{u:bounds[0],v:bounds[1],width:w,height:h,footU:u,footV:v,groundDepth:(z-x)*DEPTH_GROUND},oid);};
const landscape=campusLandscape(campus);
for(const t of landscape.trees){const region=t.kind==='conifer'?0:Number(t.id.split('-').at(-1))%4===0?2:1;addProp(t.id,t.x,t.z,t.crownWidth,t.height*HEIGHT_SCALE,region,null,{kind:'tree',positionStatus:t.positionStatus,species:t.species,dimensionsStatus:t.dimensionsStatus});}


const tiles=[];
const portraits=[];
for(let n=0;n<campus.buildings.length;n++){
  const placeId=primary.get(campus.buildings[n].id)||campus.buildings[n].id;
  const m=meshes[n],pad=2,L=m.bounds[0]-pad,T=m.bounds[1]-pad,W=Math.ceil((m.bounds[2]-L+pad)*S),H=Math.ceil((m.bounds[3]-T+pad)*S),preview=new SurfaceRaster(W,H,{left:L,top:T,pixelsPerMetre:S});
  for(const face of m.faces)preview.triangle(face,objects[n].owner,shader);
  const path='portrait-'+placeId+'-v1.png',bytes=encodePng(preview.color);await writeFile(join(dir,path),bytes);portraits.push({placeId,path,width:W,height:H,bytes:bytes.length,sha256:sha(bytes)});objects[n].portrait=path;
}
for(let y=0;y<height;y+=tileSize)for(let x=0;x<width;x+=tileSize){
  const w=Math.min(tileSize,width-x),h=Math.min(tileSize,height-y),color=new PixelRaster(w,h),z=new PixelRaster(w,h),ids=new Set();let any=false;
  for(let row=0;row<h;row++){color.pixels.set(raster.color.pixels.subarray((y+row)*width+x,(y+row)*width+x+w),row*w);for(const owner of raster.owners.subarray((y+row)*width+x,(y+row)*width+x+w))if(owner)ids.add(owner);if(!any)any=color.pixels.subarray(row*w,(row+1)*w).some(v=>v>>>24);}
  if(!any)continue;const owners=[0,...[...ids].sort((a,b)=>a-b)];if(owners.length>256)throw Error('A tile contains over 255 visible objects; reduce tileSize before baking.');const codes=new Map(owners.map((id,i)=>[id,i]));
  for(let row=0;row<h;row++)for(let col=0;col<w;col++){const i=(y+row)*width+x+col,owner=raster.owners[i];if(owner)z.pixels[row*w+col]=encodeSurfaceDepth(raster.depth[i],codes.get(owner));}
  const key=x+'-'+y,cp='haidian-color-'+key+'-v1.png',dp='haidian-depth-'+key+'-v1.png',cb=encodePng(color),db=encodePng(z);await writeFile(join(dir,cp),cb);await writeFile(join(dir,dp),db);tiles.push({x,y,width:w,height:h,color:cp,depth:dp,owners,colorSha256:sha(cb),depthSha256:sha(db),bytes:cb.length+db.length});
}
const manifest={format:'uw.metric-depth-scene/v1',version:'haidian-1.1.0',materialLanguage:BUILDING_LANGUAGE,geometryHash:campus.geometryHash,pixelsPerMetre:S,tileSize,left,top,width,height,depthCodec:{range:[-512,511.984375],stepsPerMetre:64,channels:'UW depth/owner codec retained'},projection:{ground:[.78,.39],height:HEIGHT_SCALE,sourceScale:1,groundMapScale:1},lighting:'shared warm daylight',tiles,portraits,objects,buildingCount:campus.buildings.length,sourcePhotoBillboardsOnMap:0,sourceFootprintsUnmodified:false,allBuildingsUseSameRenderer:true,footprintPolicy:'Historical locations with photo-informed body/roof refinements; collision uses the same resolved architectural parts.',styleBoundary:'Reviewed photo features, not measured dimensions; hidden/unidentified exteriors remain explicit estimates.',assetProvenance:'School-specific procedural architectural meshes reviewed against official multi-view photographs. UW projection/raster/depth engine reused.',landscape:{...landscape.metrics,sources:landscape.sources,rejected:[]}};
for(const p of campus.landmarks.filter(p=>!p.buildingId)){
 const q=new PixelRaster(240,160);q.rect(0,0,240,160,'#b7c99a');q.polygon([[0,130],[120,75],[240,130],[120,185]],'#c8c5a1');q.line(0,128,240,12,'#74b8be',20);
 if(p.id==='river-bridge')q.polygon([[75,80],[143,44],[165,58],[95,95]],'#e9dcc0');
 else if(p.id==='athletics-field'){q.polygon([[30,90],[123,40],[215,90],[121,140]],'#b97562');q.polygon([[46,89],[123,52],[200,89],[123,128]],'#6c9a68');}
 else if(p.id==='main-gate'){q.rect(80,40,9,67,'#a97258');q.rect(175,20,9,67,'#a97258');q.line(83,41,179,21,'#d9caaa',10);}
 const path='portrait-'+p.id+'-v1.png',bytes=encodePng(q);await writeFile(join(dir,path),bytes);portraits.push({placeId:p.id,path,width:q.width,height:q.height,bytes:bytes.length,sha256:sha(bytes)});
}
await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',buildings:campus.buildings.length,objects:objects.length,tiles:tiles.length,bytes:tiles.reduce((n,t)=>n+t.bytes,0),projectedPixels:width*height,maximumRoofDeviation:Math.max(...meshes.map(m=>m.triangulationDeviation))}));
