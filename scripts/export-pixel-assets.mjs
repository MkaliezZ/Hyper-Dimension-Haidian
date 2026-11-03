// Code-native raster export, not a transformation of the generated portrait atlas.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {projectRoot} from '../src/base.mjs';
import {visitorCatalog as currentCatalog} from '../src/visitor-avatar.mjs';
// Preserve the historical v4 export contract; detailed current assets have a separate exporter.
const legacyRecipe=r=>({...structuredClone(r),catalogVersion:currentCatalog.pixel.version,generatorVersion:currentCatalog.pixel.generator});
const visitorCatalog={...currentCatalog,...currentCatalog.pixel,defaultRecipe:legacyRecipe(currentCatalog.defaultRecipe),presets:currentCatalog.presets.map(p=>({...p,recipe:legacyRecipe(p.recipe)}))};
import {PixelRaster} from '../public/pixel-raster.js';
import {pixelAvatar,PIXEL_FRAME} from '../public/pixel-avatar.js';
import {pixelItem} from '../public/pixel-items.js';
import {createPixelCampusArt} from '../public/pixel-campus-art.js';
const dir=join(projectRoot,'public/assets/pixel');await mkdir(dir,{recursive:true});
const table=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(data){let c=0xffffffff;for(const n of data)c=table[(c^n)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length,0);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([name,data])),out.length-4);return out;}
function png(raster){const header=Buffer.alloc(13);header.writeUInt32BE(raster.width);header.writeUInt32BE(raster.height,4);header[8]=8;header[9]=6;const scan=Buffer.alloc((raster.width*4+1)*raster.height);for(let y=0;y<raster.height;y++)Buffer.from(raster.data.buffer,y*raster.width*4,raster.width*4).copy(scan,y*(raster.width*4+1)+1);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scan,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
const records=[];
async function save(name,raster,metadata){const bytes=png(raster);await writeFile(join(dir,name),bytes);records.push({path:name,width:raster.width,height:raster.height,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),origin:'deterministic-original-pixel-code',...metadata});}
const campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8')),art=createPixelCampusArt(campus);
await save('uw-campus-map-v1.png',art.raster,{purpose:'north-up GIS footprint/path tilemap; same generator as browser',geometryHash:campus.geometryHash,bounds:campus.bounds,pixelsPerMetre:2,...art.metrics});
const actions=['idle','walk','wave'],directions=PIXEL_FRAME.directions,frames=[];
for(const preset of visitorCatalog.presets){const sheet=new PixelRaster(96,384);for(let d=0;d<4;d++)for(let a=0;a<3;a++)for(let f=0;f<4;f++){const x=f*24,y=(d*3+a)*32;sheet.blit(pixelAvatar(preset.recipe,visitorCatalog.skins,{direction:directions[d],action:actions[a],frame:f}),x,y);if(preset===visitorCatalog.presets[0])frames.push({direction:directions[d],action:actions[a],frame:f,rect:[x,y,24,32],anchor:[12,31]});}await save('visitor-'+preset.id+'-v1.png',sheet,{purpose:'editable four-direction/three-action avatar spritesheet',preset:preset.id,recipe:preset.recipe,frames:'sprite-layout.json'});}
const parts=new PixelRaster(224,180);for(let i=0;i<visitorCatalog.parts.length;i++){const p=visitorCatalog.parts[i],r=structuredClone(visitorCatalog.defaultRecipe);r.parts[p.slot]=p.id;if(p.slot!=='accessory')r.parts.accessory='accessory-none';parts.blit(pixelAvatar(r,visitorCatalog.skins),i%8*28+2,Math.floor(i/8)*36+2);}await save('visitor-parts-v1.png',parts,{purpose:'38 original part previews; runtime remains composable',parts:visitorCatalog.parts.map((p,i)=>({...p,rect:[i%8*28+2,Math.floor(i/8)*36+2,24,32]}))});
const items=new PixelRaster(120,24);['bookmark','postcard','stamp','wave','note'].forEach((kind,i)=>items.blit(pixelItem(kind),i*24,0));await save('inventory-items-v1.png',items,{purpose:'non-destructive tool pixel icons',items:['bookmark','postcard','stamp','wave','note']});
const portrait=await readFile(join(dir,'uw-landmark-portraits-v1.png'));records.push({path:'uw-landmark-portraits-v1.png',width:1254,height:1254,bytes:portrait.length,sha256:createHash('sha256').update(portrait).digest('hex'),origin:'image_gen original generated transparent PNG; original alpha preserved',tool:'image_gen.imagegen',purpose:'flat UI landmark portraits, not world geometry or reusable UW survey images',prompt:'docs/PIXEL-ATLAS-PROMPT.txt',grid:[3,3],cell:[418,418],order:['denny','suzzallo','raitt','savery','hub','kane','red-square','fountain','quad']});
await writeFile(join(dir,'sprite-layout.json'),JSON.stringify({format:'uw.pixel-sprites/v1',frame:PIXEL_FRAME,actions,directions,frames},null,2)+'\n');
await writeFile(join(dir,'asset-manifest.json'),JSON.stringify({format:'uw.pixel-assets/v1',version:'0.6.0',style:'true-2d-top-down-pixel',created:'2026-10-29',author:'Hyper Campus',licensing:'Original code-native artwork and generated portraits supplied as project artwork; public geodata attribution remains in DATA-MANIFEST.json and LICENSES.md. No UW logo, photograph or official endorsement is claimed.',files:records},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',assets:records.length,map:[art.width,art.height],parts:visitorCatalog.parts.length,framesPerPreset:frames.length,bytes:records.reduce((n,r)=>n+r.bytes,0)}));
