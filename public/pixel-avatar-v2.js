import {PixelRaster,rgba,tint,pixelHash} from './pixel-raster.js';
export const PIXEL_AVATAR_VERSION='uw-pixel-2.0.0';
export const PIXEL_FRAME={width:48,height:64,anchor:[24,63],sourcePixelRatio:2,directions:['south','west','east','north'],frames:4};

// Original higher-detail pixel parts. v1 remains unchanged to verify old saved receipts.
export function pixelAvatar(recipe,skins,{direction='south',action='idle',frame=0}={}){
  const p=new PixelRaster(48,64),parts=recipe.parts,c=recipe.colors,skin=skins[recipe.skin],ink='#443b47',shade=tint(skin,-.18),light=tint(skin,.12),hair=c.hair,top=c.top,bottom=c.bottom,shoe=c.shoes;
  const walk=action==='walk',step=walk?[0,2,0,-2][frame%4]:0,bob=walk&&frame%2?1:0,offset=(recipe.height==='short'?3:recipe.height==='tall'?-2:0)+bob,back=direction==='north',side=direction==='east'||direction==='west';
  const left=parts.body==='body-slim'?17:parts.body==='body-athletic'?13:15,right=48-left;
  const R=(x,y,w,h,col)=>p.rect(x,y+offset,w,h,col),L=(a,b,x,y,col,w=1)=>p.line(a,b+offset,x,y+offset,col,w),E=(x,y,rx,ry,col)=>p.ellipse(x,y+offset,rx,ry,col),C=(x,y,r,col)=>p.circle(x,y+offset,r,col);
  const long=['hair-long','hair-bob','hair-ponytail','hair-braids'].includes(parts.hair);
  if(long){E(24,23,15,15,ink);R(10,20,28,22,hair);L(12,23,12,40,tint(hair,.18));L(35,21,35,40,tint(hair,-.2));}
  // Legs and shoes use a fixed ground anchor; upper-body height never moves a foot below the frame.
  for(const [x,k] of [[16,1],[26,-1]]){const y=51+k*step,shorts=parts.bottom==='bottom-shorts';p.rect(x,y,7,10,ink);p.rect(x+1,y,5,9,shorts?skin:bottom);p.line(x+1,y+1,x+1,y+7,shorts?light:tint(bottom,.16));const fy=59+Math.min(0,k*step);p.rect(x-1,fy,9,5,ink);p.rect(x,fy,7,3,shoe);p.rect(x,fy+3,8,1,tint(shoe,-.25));
    if(parts.shoes==='shoes-sneakers'){p.rect(x,fy+3,8,1,'#efe9d5');for(let j=1;j<6;j+=2)p.put(x+j,fy+1,'#b7b3a9');}
    if(parts.shoes==='shoes-high'){p.rect(x+1,fy-4,5,5,shoe);p.line(x+2,fy-3,x+2,fy,'#e8ddc5');}
    if(parts.shoes==='shoes-loafers'){p.rect(x+1,fy+1,5,1,tint(shoe,.25));p.rect(x+3,fy,2,2,'#cdb16b');}
    if(parts.shoes==='shoes-boots'){p.rect(x+1,fy-5,5,6,shoe);p.line(x+2,fy-4,x+2,fy,tint(shoe,.25));p.rect(x-1,fy+3,9,1,'#725c4a');}
  }
  if(['bottom-skirt','bottom-culottes'].includes(parts.bottom)){p.polygon([[left,49+offset],[right,49+offset],[right+2,57],[left-2,57]],ink);p.polygon([[left+1,50+offset],[right-1,50+offset],[right,56],[left,56]],bottom);for(let x=left+3;x<right;x+=5)p.line(x,51+offset,x-1,55,tint(bottom,-.18));if(parts.bottom==='bottom-culottes')p.line(24,51+offset,24,57,ink);}
  else{R(left,49,right-left,5,ink);R(left+1,50,right-left-2,4,bottom);L(left+2,51,right-2,51,tint(bottom,-.17));}
  if(parts.bottom==='bottom-jeans'){for(const x of [18,28]){p.line(x,53,x,58,'#9aafba');p.put(x+1,56,'#aebbc0');}p.line(24,51,24,56,ink);}
  if(parts.bottom==='bottom-cargo'){for(const x of [left, right-5]){R(x,52,5,4,tint(bottom,.18));L(x+1,53,x+4,53,tint(bottom,-.25));R(x+2,54,1,1,'#bdb997');}}
  // Rounded torso, fabric side shade, hem stitching and separate sleeve/hand shapes.
  R(left+1,34,right-left-2,18,ink);R(left,37,right-left,12,ink);R(left+2,35,right-left-4,16,top);R(left+1,38,2,11,tint(top,-.2));R(right-3,38,2,12,tint(top,-.3));L(left+3,49,right-4,49,tint(top,.24));
  for(const [x,k] of [[left-4,-1],[right,1]]){const raised=action==='wave'&&k===1,y=raised?24:38+k*step;R(x,y,5,12,ink);R(x+1,y+1,3,8,top);R(x+1,raised?20:48+k*step,4,6,shade);R(x,raised?21:48+k*step,4,5,skin);R(x+1,raised?20:49+k*step,2,1,light);if(raised){R(x+2,18+(frame%2),2,4,skin);L(x,23,x+3,23,shade);}}
  R(20,30,8,7,ink);R(21,31,6,5,skin);L(21,35,26,35,shade);
  E(24,20,14,13,ink);E(24,20,13,12,skin);E(10,23,2,4,shade);E(38,23,2,4,shade);E(10,22,1,2,skin);E(38,22,1,2,skin);L(15,30,32,30,shade);E(18,16,6,4,light);
  if(!back){if(side){E(31,21,2,3,ink);R(31,19,1,2,'#fff4dd');R(38,23,3,3,shade);R(39,23,1,1,light);L(31,29,34,29,'#955e55');R(33,25,3,2,tint(skin,-.06));}else{for(const x of [18,30]){E(x,21,2,3,ink);R(x,19,1,2,'#fff5df');L(x-2,17,x+1,17,tint(hair,-.05));}R(23,25,2,2,shade);R(24,24,1,1,light);L(21,29,26,29,'#98675a');R(13,25,3,2,tint(skin,-.06));R(33,25,3,2,tint(skin,-.06));}}
  E(24,11,14,7,ink);E(24,11,13,6,hair);L(15,8,28,6,tint(hair,.18),2);R(11,11,26,5,hair);
  if(parts.hair==='hair-short'){R(11,15,5,3,hair);R(30,14,6,2,hair);R(17,14,5,2,hair);L(13,11,18,9,tint(hair,.15));}
  if(parts.hair==='hair-sidepart'){p.polygon([[12,11+offset],[29,8+offset],[22,17+offset],[12,18+offset]],hair);L(28,9,36,18,hair,3);L(14,13,24,10,tint(hair,.2));}
  if(parts.hair==='hair-bob'){R(10,14,4,19,hair);R(34,14,4,19,hair);R(13,14,22,3,hair);L(11,17,11,29,tint(hair,.18));L(35,18,35,31,tint(hair,-.16));}
  if(parts.hair==='hair-ponytail'){const x=side?7:38;R(x-1,13,6,18,ink);R(x,14,4,15,hair);L(x+1,17,x+1,27,tint(hair,.16));R(x-1,14,6,3,'#bb8590');}
  if(parts.hair==='hair-curly'){for(const [x,y] of [[12,10],[17,7],[23,6],[29,7],[34,10],[36,15],[11,16]]){C(x,y,4,ink);C(x,y,3,hair);R(x-1,y-2,2,1,tint(hair,.2));}}
  if(parts.hair==='hair-braids'){for(const x of [8,36]){for(let y=24;y<41;y+=5){R(x,y,5,5,ink);R(x+1,y,3,4,hair);R(x+1,y+1,1,1,tint(hair,.22));}R(x,40,5,2,'#b581a0');}}
  if(parts.hair==='hair-bun'){E(24,7,7,5,ink);E(24,7,6,4,hair);L(21,3,27,2,tint(hair,.2));L(19,8,29,8,tint(hair,-.2));}
  if(parts.hair==='hair-long'){R(10,14,4,27,hair);R(34,14,4,27,hair);L(12,19,12,38,tint(hair,.16));L(35,20,35,39,tint(hair,-.16));L(14,13,22,18,hair,3);}
  if(back){E(24,22,13,10,hair);R(14,26,20,8,hair);L(18,14,17,30,tint(hair,.17));L(24,16,23,31,tint(hair,.08));L(31,17,32,31,tint(hair,-.12));}
  if(!back){
    if(parts.top==='top-varsity'){L(19,36,19,49,'#f0e1ba',2);R(right-6,39,3,4,'#e9dab7');R(right-5,40,1,2,top);L(left+3,48,right-4,48,'#dfcd9f');for(let y=38;y<48;y+=3)R(22,y,1,1,'#d2bd86');}
    if(parts.top==='top-hoodie'){E(24,35,6,3,tint(top,.27));L(21,38,21,43,'#eadbc1');L(27,38,27,43,'#eadbc1');R(19,45,11,4,tint(top,-.12));L(20,45,28,45,tint(top,.22));L(23,46,25,46,top);}
    if(parts.top==='top-polo'){p.polygon([[19,35+offset],[24,38+offset],[29,35+offset],[27,40+offset],[24,38+offset],[21,40+offset]],'#eadfc5');R(24,38,1,6,tint(top,-.35));R(25,40,1,1,'#e9dfcd');R(25,43,1,1,'#e9dfcd');}
    if(parts.top==='top-cardigan'){R(21,35,7,16,'#e9dfc9');L(20,36,20,49,tint(top,-.2));L(28,36,28,49,tint(top,-.18));for(let y=39;y<49;y+=3)R(27,y,1,1,'#8d7555');R(left+4,43,4,3,tint(top,.13));}
    if(parts.top==='top-vest'){p.polygon([[18,35+offset],[24,42+offset],[30,35+offset]],'#ece3cd');L(18,36,24,43,tint(top,-.3));L(30,36,24,43,tint(top,-.3));R(left-1,38,3,9,'#eee6d3');R(right-2,38,3,9,'#eee6d3');for(let y=44;y<49;y+=3)L(left+4,y,right-4,y,tint(top,.14));}
    if(parts.top==='top-tee'){E(24,35,5,2,tint(top,-.18));R(right-7,40,3,3,tint(top,.17));L(left+3,39,left+3,45,tint(top,.12));}
    if(parts.glasses!=='glasses-none'){const gc=parts.glasses==='glasses-oval'?'#c6a869':'#524b55',centers=side?[31]:[18,30];for(const x of centers){if(parts.glasses==='glasses-square'){L(x-4,17,x+4,17,gc);L(x-4,25,x+4,25,gc);L(x-4,17,x-4,25,gc);L(x+4,17,x+4,25,gc);}else for(let i=0;i<40;i++){const a=i/40*Math.PI*2;p.put(x+Math.cos(a)*4,21+offset+Math.sin(a)*(parts.glasses==='glasses-oval'?3:4),gc);}R(x-2,18,2,1,'#d6d9c4');}if(!side)L(22,20,26,20,gc);else L(35,20,38,19,gc);}
  }
  if(parts.accessory==='accessory-satchel'){L(14,35,32,53,'#d1aa68',2);R(31,49,11,11,ink);R(32,50,9,8,'#b99461');L(33,51,39,51,'#dfc48e');R(36,52,2,2,'#e9ce8d');L(33,57,39,57,'#8b6b4c');}
  if(parts.accessory==='accessory-scarf'){R(17,33,15,5,'#b87568');R(29,37,5,12,'#c68d72');for(let y=39;y<48;y+=3)R(29,y,5,1,'#e5c5a2');R(29,48,1,2,'#c68d72');R(32,48,1,2,'#c68d72');}
  if(parts.accessory==='accessory-cap'){E(24,8,14,6,'#54617c');R(11,9,27,6,'#53617c');R(side?25:9,13,side?17:30,3,'#3c4863');R(22,6,4,4,'#e6ca85');L(15,9,18,6,'#7b8ba1');}
  if(parts.accessory==='accessory-headphones'){L(10,11,11,25,'#d4b57c',2);L(37,11,37,25,'#d4b57c',2);L(15,4,32,4,'#d4b57c',2);R(8,20,6,10,ink);R(9,21,4,8,'#655c75');R(35,20,6,10,ink);R(36,21,4,8,'#655c75');R(10,22,1,5,'#968aa0');}
  if(parts.accessory==='accessory-backpack'){if(back){R(15,37,20,18,ink);R(16,38,18,16,'#ac795c');E(25,39,7,3,'#c5966d');R(18,45,14,7,'#c59871');L(19,45,30,45,'#e1ba83');L(24,39,26,39,'#735b49');R(24,46,2,2,'#e1c58d');}else{L(17,36,17,49,'#c49c6c',2);L(31,36,31,49,'#c49c6c',2);R(13,41,2,7,'#aa7c59');}}
  if(parts.accessory==='accessory-bow'){p.polygon([[34,12+offset],[33,7+offset],[39,10+offset],[43,7+offset],[43,14+offset],[38,12+offset]],'#bd7f96');R(37,10,3,4,'#e2a3b0');L(35,9,36,10,'#e9b4bc');}
  // Single-pixel fibers and specular points add detail without changing part silhouettes or introducing blur.
  const hairValue=rgba(hair),topValue=rgba(top),hairHighlight=rgba(tint(hair,.11)),clothLight=rgba(tint(top,.07));for(let y=1;y<63;y++)for(let x=1;x<47;x++){const i=y*48+x,hash=pixelHash(x,y);if(p.pixels[i]===hairValue&&hash%17===0)p.pixels[i]=hairHighlight;else if(p.pixels[i]===topValue&&hash%29===0)p.pixels[i]=clothLight;}
  if(direction==='west'){const flipped=new PixelRaster(48,64);flipped.blit(p,0,0,true);return flipped;}return p;
}

// The chooser enlarges the relevant part instead of making every tile a tiny full-body portrait.
export function pixelPartPreview(recipe,skins,slot){
  const regions={body:[9,9,30,53],hair:[6,0,36,43],top:[8,32,32,22],bottom:[10,47,28,13],shoes:[12,54,25,10],glasses:[9,14,31,15],accessory:[0,0,48,64]},[x,y,w,h]=regions[slot]||regions.body;
  const original=pixelAvatar(recipe,skins,{direction:recipe.parts.accessory==='accessory-backpack'&&slot==='accessory'?'north':'south'}),out=new PixelRaster(64,64),scale=Math.min(58/w,58/h),width=Math.round(w*scale),height=Math.round(h*scale),left=Math.floor((64-width)/2),top=Math.floor((64-height)/2);
  for(let py=0;py<height;py++)for(let px=0;px<width;px++){const sx=Math.min(47,x+Math.floor(px/scale)),sy=Math.min(63,y+Math.floor(py/scale));out.pixels[(top+py)*64+left+px]=original.pixels[sy*48+sx];}return out;
}
