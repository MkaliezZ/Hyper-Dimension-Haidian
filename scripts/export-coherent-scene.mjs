// Bake a single, metrically registered depth scene. Runtime only loads tiled PNGs.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';import {createHash} from 'node:crypto';
import {projectRoot} from '../src/base.mjs';import {PixelRaster} from '../public/pixel-raster.js';
import {project,projectedBounds} from '../public/oblique-layout.js';
import {surfaceProject,DEPTH_GROUND,HEIGHT_SCALE,encodeSurfaceDepth} from '../public/surface-depth.js';
import {buildArchitecturalMesh,BUILDING_LANGUAGE} from '../src/coherent-buildings.mjs';
import {SurfaceRaster,createArchitecturalShader} from '../src/surface-raster.mjs';
import {encodePng,decodePng} from './png-codec.mjs';import {FOUNTAIN} from '../public/campus-layout.js';
import {campusLandscape,FOUNTAIN_GARDEN} from '../public/campus-landscape.js';
import {drawLandscapeSolids} from '../src/coherent-landscape.mjs';
import {createLandmarkMaterials,drawLandmarkGround,drawRedSquareFeatures,prepareFountainPlume} from '../src/landmark-art.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8')),dir=join(projectRoot,'public/assets/coherent');await mkdir(dir,{recursive:true});
const materials=decodePng(await readFile(join(dir,'materials-v1.png'))),facades=decodePng(await readFile(join(dir,'facade-modules-v1.png'))),shader=createArchitecturalShader(materials,facades),S=4,tileSize=512;
const landmarkMaterialFile='landmark-materials-v2.png',landmarkMaterials=createLandmarkMaterials(decodePng(await readFile(join(dir,landmarkMaterialFile))));
const fountainPlumeFile='fountain-plume-v2.png';landmarkMaterials.plume=prepareFountainPlume(decodePng(await readFile(join(dir,fountainPlumeFile))));
const b=projectedBounds([[[campus.bounds[0],campus.bounds[1]],[campus.bounds[2],campus.bounds[1]],[campus.bounds[2],campus.bounds[3]],[campus.bounds[0],campus.bounds[3]]]]),left=Math.floor(b[0]-25),top=Math.floor(b[1]-55),width=Math.ceil((b[2]-left+25)*S),height=Math.ceil((b[3]-top+25)*S),raster=new SurfaceRaster(width,height,{left,top,pixelsPerMetre:S});
const objects=[],meshes=campus.buildings.map(buildArchitecturalMesh);let owner=0;
const addObject=row=>{const id=++owner;if(id>65535)throw Error('Scene object capacity exceeded');objects.push({owner:id,...row});return id;};
const primary=new Map(campus.landmarks.filter(p=>p.buildingId).map(p=>[p.buildingId,p.id]));
for(let n=0;n<campus.buildings.length;n++){
  const building=campus.buildings[n],mesh=meshes[n],id=addObject({id:building.id,placeId:primary.get(building.id)||null,kind:'building',name:building.name,code:building.code,bounds:mesh.bounds,groundRings:mesh.groundRings,sourceHeight:building.height,heightStatus:building.heightStatus,profile:mesh.profile,footprintArea:mesh.area,triangulationDeviation:mesh.triangulationDeviation,meshVertices:mesh.meshVertices,sourceScale:1,materialLanguage:BUILDING_LANGUAGE});
  // Soft contact and cast shadow is not a solid depth surface or a collision.
  const shadow=mesh.groundRings.map(r=>r.map(([x,z])=>{const [u,v]=project(x+building.height*.23,z+building.height*.17);return [(u-left)*S,(v-top)*S];}));raster.color.polygon(shadow,(46|57<<8|47<<16|48<<24)>>>0);
}
drawLandmarkGround(raster,addObject,landmarkMaterials);
for(let n=0;n<meshes.length;n++)for(const face of meshes[n].faces)raster.triangle(face,objects[n].owner,shader);
const old=JSON.parse(await readFile(join(projectRoot,'public/assets/oblique/manifest.json'),'utf8')),environmentRow=old.files.find(f=>f.id==='environment'),environment=decodePng(await readFile(join(projectRoot,'public/assets/oblique',environmentRow.path))),regions=old.environmentRegions;
const addProp=(id,x,z,w,h,region,placeId=null,extra={})=>{const [u,v]=project(x,z),bounds=[u-w/2,v-h,u+w/2,v],oid=addObject({id,placeId,kind:'prop',bounds,point:[x,z],...extra});raster.billboard(environment,regions[region],{u:bounds[0],v:bounds[1],width:w,height:h,footU:u,footV:v,groundDepth:(z-x)*DEPTH_GROUND},oid);};
const landscape=campusLandscape(campus);
for(const t of landscape.trees){const region=t.kind==='cherry'?2:t.kind==='conifer'?0:1;addProp(t.id,t.x,t.z,t.crownWidth,t.height*HEIGHT_SCALE,region,null,{kind:'tree',positionStatus:t.positionStatus,species:t.species,dimensionsStatus:t.dimensionsStatus});}
for(const [i,x,z]of [[0,-165,8],[1,-85,70],[2,25,203],[3,34,320]])addProp('lamp-'+i,x,z,1.4,5.2,5);
drawRedSquareFeatures(raster,addObject,landmarkMaterials);
for(let q=0;q<4;q++)for(let row=0;row<2;row++)for(let n=0;n<15;n++){const a=FOUNTAIN_GARDEN.axisAngle+q*Math.PI/2+.21+n/14*(Math.PI/2-.42),r=FOUNTAIN_GARDEN.bedInnerRadius+2+row*3.2;addProp('rose-'+q+'-'+row+'-'+n,FOUNTAIN.x+Math.cos(a)*r,FOUNTAIN.z+Math.sin(a)*r,1.6,1.1,3,'fountain');}
const fountain=drawLandscapeSolids(raster,landscape,addObject,landmarkMaterials);
const tiles=[];
const portraits=[];
for(let n=0;n<campus.buildings.length;n++){
  const placeId=primary.get(campus.buildings[n].id);if(!placeId)continue;
  const m=meshes[n],pad=2,L=m.bounds[0]-pad,T=m.bounds[1]-pad,W=Math.ceil((m.bounds[2]-L+pad)*S),H=Math.ceil((m.bounds[3]-T+pad)*S),preview=new SurfaceRaster(W,H,{left:L,top:T,pixelsPerMetre:S});
  for(const face of m.faces)preview.triangle(face,objects[n].owner,shader);
  const path='portrait-'+placeId+'-v1.png',bytes=encodePng(preview.color);await writeFile(join(dir,path),bytes);portraits.push({placeId,path,width:W,height:H,bytes:bytes.length,sha256:sha(bytes)});objects[n].portrait=path;
}
{
  const box=objects.find(o=>o.id==='fountain').bounds,L=Math.floor((box[0]-left)*S)-4,T=Math.floor((box[1]-top)*S)-4,W=Math.ceil((box[2]-box[0])*S)+8,H=Math.ceil((box[3]-box[1])*S)+8,preview=new PixelRaster(W,H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(T+y)*width+L+x;if(raster.owners[i]===fountain)preview.pixels[y*W+x]=raster.color.pixels[i];}
  const path='portrait-fountain-v2.png',bytes=encodePng(preview);await writeFile(join(dir,path),bytes);portraits.push({placeId:'fountain',path,width:W,height:H,bytes:bytes.length,sha256:sha(bytes)});
}
for(let y=0;y<height;y+=tileSize)for(let x=0;x<width;x+=tileSize){
  const w=Math.min(tileSize,width-x),h=Math.min(tileSize,height-y),color=new PixelRaster(w,h),z=new PixelRaster(w,h),ids=new Set();let any=false;
  for(let row=0;row<h;row++){color.pixels.set(raster.color.pixels.subarray((y+row)*width+x,(y+row)*width+x+w),row*w);for(const owner of raster.owners.subarray((y+row)*width+x,(y+row)*width+x+w))if(owner)ids.add(owner);if(!any)any=color.pixels.subarray(row*w,(row+1)*w).some(v=>v>>>24);}
  if(!any)continue;const owners=[0,...[...ids].sort((a,b)=>a-b)];if(owners.length>256)throw Error('A tile contains over 255 visible objects; reduce tileSize before baking.');const codes=new Map(owners.map((id,i)=>[id,i]));
  for(let row=0;row<h;row++)for(let col=0;col<w;col++){const i=(y+row)*width+x+col,owner=raster.owners[i];if(owner)z.pixels[row*w+col]=encodeSurfaceDepth(raster.depth[i],codes.get(owner));}
  const key=x+'-'+y,cp='color-'+key+'-v2.png',dp='depth-'+key+'-v2.png',cb=encodePng(color),db=encodePng(z);await writeFile(join(dir,cp),cb);await writeFile(join(dir,dp),db);tiles.push({x,y,width:w,height:h,color:cp,depth:dp,owners,colorSha256:sha(cb),depthSha256:sha(db),bytes:cb.length+db.length});
}
const manifest={format:'uw.metric-depth-scene/v1',version:'0.9.0',materialLanguage:BUILDING_LANGUAGE,geometryHash:campus.geometryHash,pixelsPerMetre:S,tileSize,left,top,width,height,depthCodec:{range:[-512,511.984375],stepsPerMetre:64,channels:'R=low, G=high, B=tile-local owner code (tile.owners[B]), A=opaque surface; no alpha means no solid'},projection:{ground:[.78,.39],height:HEIGHT_SCALE,sourceScale:1,groundMapScale:1},lighting:'one shared warm daylight and material palette',materialImage:{path:'materials-v1.png',sha256:sha(await readFile(join(dir,'materials-v1.png'))),origin:'OpenAI built-in image_gen, original four-quadrant architectural material library; sampled onto geometry, not building billboards'},facadeImage:{path:'facade-modules-v1.png',sha256:sha(await readFile(join(dir,'facade-modules-v1.png'))),origin:'OpenAI built-in image_gen, four orthographic architectural bays; shared scale, prefiltered material sampling'},styleBoundary:'Source footprints are registered 1:1; all heights and artistic roof/door/window details remain inferred, not surveyed elevations or actual entrance claims.',tiles,portraits,objects,buildingCount:campus.buildings.length,sourcePhotoBillboardsOnMap:0,sourceFootprintsUnmodified:true,allBuildingsUseSameRenderer:true,landscape:{...landscape.metrics,sources:landscape.sources,rejected:landscape.rejected,fountainGarden:FOUNTAIN_GARDEN}};
manifest.landmarkArt={version:'photo-landmarks-2',materialImage:{path:landmarkMaterialFile,sha256:sha(await readFile(join(dir,landmarkMaterialFile))),origin:'OpenAI built-in image_gen; original flat material atlas informed by official UW photographs'},features:['fine red brick paving and thin expansion joints','four photo-calibrated central stepped seating platforms','brick pylons and balanced Broken Obelisk','textured deep pool, stone coping, eight low jets and clustered central spray'],sourcePhotographs:['https://www.washington.edu/visit/campus-highlights-guide/','https://cdn.uw.edu/wp-content/uploads/sites/57/2020/08/10204555/visit-campus-highlightsUniv-of-Washington_Red-Square-e1597119170153.jpg','https://cdn.uw.edu/wp-content/uploads/sites/57/2020/08/10204509/visit-campus-highlights20190613_campus-graduation-77.jpg'],geometryPolicy:'Existing GIS, landmark coordinates, pool radii and actor recipes retained; revised plaza prop positions are shared by art and walking; photo-informed detail shapes are artistic.'};
manifest.landmarkArt.plumeImage={path:fountainPlumeFile,sha256:sha(await readFile(join(dir,fountainPlumeFile))),origin:'OpenAI built-in image_gen; original transparent pixel spray, area-filtered at world pixel density and baked with the fountain owner depth'};
manifest.landmarkArt.multiAngleReview={sources:['https://facilities.uw.edu/services/signs-events/outdoor-venues','https://hasc.washington.edu/explore-programs/transfer-students','https://anthropology.washington.edu/graduation-celebration','https://www.washington.edu/boundless/12-works-uw-campus-public-art/'],pylonHeights:'photo-calibrated 36.6/39.6/42.7m; artistic, not surveyed',plazaProps:'central four-part slab cluster; northeast Broken Obelisk; shared art/collision data',rawUnsafeGraphEdges:31};
await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',buildings:campus.buildings.length,objects:objects.length,tiles:tiles.length,bytes:tiles.reduce((n,t)=>n+t.bytes,0),projectedPixels:width*height,fragments:raster.fragments,maximumRoofDeviation:Math.max(...meshes.map(m=>m.triangulationDeviation))}));
