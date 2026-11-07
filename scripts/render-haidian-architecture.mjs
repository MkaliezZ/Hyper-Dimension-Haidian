// Four-view geometry review using the production mesh, shader and depth raster.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {projectRoot} from '../src/base.mjs';
import {buildArchitecturalMesh} from '../src/coherent-buildings.mjs';
import {SurfaceRaster} from '../src/surface-raster.mjs';
import {createHaidianShader} from '../src/haidian-shader.mjs';
import {surfaceProject} from '../public/surface-depth.js';
import {encodePng} from './png-codec.mjs';
const at=process.argv.indexOf('--out'),dir=at>=0?resolve(process.argv[at+1]):join(projectRoot,'evidence/haidian/architecture/views');
await mkdir(dir,{recursive:true});
const campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8')),shader=createHaidianShader(),records=[];
for(const building of campus.buildings){
 const mesh=buildArchitecturalMesh(building),views=[];
 for(let index=0;index<4;index++){
  const angle=index*Math.PI/2,c=Math.cos(angle),s=Math.sin(angle),[cx,cz]=building.centroid;
  const faces=mesh.faces.map(f=>({...f,points:f.points.map(([x,y,z])=>[cx+(x-cx)*c-(z-cz)*s,y,cz+(x-cx)*s+(z-cz)*c]),normal:f.normal&&[f.normal[0]*c-f.normal[2]*s,f.normal[1],f.normal[0]*s+f.normal[2]*c]}));
  const projected=faces.flatMap(f=>f.points.map(surfaceProject)),left=Math.min(...projected.map(p=>p[0]))-1.5,top=Math.min(...projected.map(p=>p[1]))-1.5,w=Math.max(...projected.map(p=>p[0]))-left+1.5,h=Math.max(...projected.map(p=>p[1]))-top+1.5,scale=Math.min(12,560/w,360/h);
  const raster=new SurfaceRaster(Math.ceil(w*scale),Math.ceil(h*scale),{left,top,pixelsPerMetre:scale});for(const face of faces)raster.triangle(face,1,shader);
  const path=building.id+'-'+index+'.png';await writeFile(join(dir,path),encodePng(raster.color));views.push({path,rotationDegrees:index*90,width:raster.width,height:raster.height,scale});
 }
 records.push({id:building.id,name:building.name,code:building.code,kind:building.architecture.kind,confidence:building.architecture.confidence,meshVertices:mesh.meshVertices,views});
}
await writeFile(join(dir,'manifest.json'),JSON.stringify({geometryHash:campus.geometryHash,method:'Production triangle mesh/shader/depth raster, rotated for inspection; source camera registration is not claimed.',buildings:records},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',buildings:records.length,renderedViews:records.length*4,output:dir}));
