import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {projectRoot,protocol} from '../src/base.mjs';
import {visitorCatalog} from '../src/visitor-avatar.mjs';
import {PixelRaster} from '../public/pixel-raster.js';
import {pixelAvatar,pixelPartPreview,PIXEL_FRAME,PIXEL_AVATAR_VERSION} from '../public/pixel-avatar-v3.js';
const table=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(data){let c=0xffffffff;for(const n of data)c=table[(c^n)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length,0);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([name,data])),out.length-4);return out;}
function png(raster){const header=Buffer.alloc(13);header.writeUInt32BE(raster.width);header.writeUInt32BE(raster.height,4);header[8]=8;header[9]=6;const scan=Buffer.alloc((raster.width*4+1)*raster.height);for(let y=0;y<raster.height;y++)Buffer.from(raster.data.buffer,y*raster.width*4,raster.width*4).copy(scan,y*(raster.width*4+1)+1);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scan,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
const dir=join(projectRoot,'public/assets/avatars-v3');await mkdir(dir,{recursive:true});
const rendererHash=protocol.digest({avatar:await readFile(join(projectRoot,'public/pixel-avatar-v3.js'),'utf8'),raster:await readFile(join(projectRoot,'public/pixel-raster.js'),'utf8')});
const files=[],actions=['idle','walk','wave'];
async function save(path,raster,metadata={}){const bytes=png(raster);await writeFile(join(dir,path),bytes);files.push({path,width:raster.width,height:raster.height,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...metadata});}
const frames=[];
for(const preset of visitorCatalog.presets){
  const sheet=new PixelRaster(192,64*8*3);
  for(let d=0;d<8;d++)for(let a=0;a<3;a++)for(let f=0;f<4;f++){
    const x=f*48,y=(d*3+a)*64;sheet.blit(pixelAvatar(preset.recipe,visitorCatalog.skins,{direction:PIXEL_FRAME.directions[d],action:actions[a],frame:f}),x,y);
    if(preset===visitorCatalog.presets[0])frames.push({direction:PIXEL_FRAME.directions[d],action:actions[a],frame:f,rect:[x,y,48,64],anchor:[24,63]});
  }
  await save('visitor-'+preset.id+'-v3.png',sheet,{preset:preset.id,purpose:'eight-direction wardrobe sprite receipt'});
}
const parts=new PixelRaster(512,320);const entries=[];
for(let i=0;i<visitorCatalog.parts.length;i++){
  const part=visitorCatalog.parts[i],r=structuredClone(visitorCatalog.defaultRecipe);r.parts[part.slot]=part.id;
  if(part.slot!=='accessory')r.parts.accessory='accessory-none';if(part.id==='accessory-backpack')r.parts.top='top-tee';
  const x=i%8*64,y=Math.floor(i/8)*64;parts.blit(pixelPartPreview(r,visitorCatalog.skins,part.slot),x,y);entries.push({...part,rect:[x,y,64,64]});
}
await save('parts-v3.png',parts,{parts:entries});
const board=new PixelRaster(48*3*8,64*3*visitorCatalog.presets.length).fill('#f2ead8');
for(let r=0;r<visitorCatalog.presets.length;r++)for(let c=0;c<8;c++){
  const sprite=pixelAvatar(visitorCatalog.presets[r].recipe,visitorCatalog.skins,{direction:PIXEL_FRAME.directions[c]});
  for(let y=0;y<64;y++)for(let x=0;x<48;x++)if(sprite.pixels[y*48+x]>>>24)board.rect(c*144+x*3,r*192+y*3,3,3,sprite.pixels[y*48+x]);
}
await save('eight-view-board-v3.png',board,{purpose:'visual review of all presets and directions'});
await writeFile(join(dir,'sprite-layout.json'),JSON.stringify({format:'uw.pixel-sprites/v3',frame:PIXEL_FRAME,actions,directions:PIXEL_FRAME.directions,frames},null,2)+'\n');
await writeFile(join(dir,'manifest.json'),JSON.stringify({version:PIXEL_AVATAR_VERSION,rendererHash,author:'Hyper Campus original procedural pixel art',license:'MIT',provenance:'Code-authored eight-view characters. Softer facial clusters, profile torso and limbs, separate front/back three-quarter views. No photo or generated bitmap source.',files},null,2)+'\n');
console.log(JSON.stringify({version:PIXEL_AVATAR_VERSION,files:files.length,frames:frames.length,rendererHash}));
