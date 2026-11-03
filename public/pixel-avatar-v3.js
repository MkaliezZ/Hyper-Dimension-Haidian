import {PixelRaster,tint} from './pixel-raster.js';
export const PIXEL_AVATAR_VERSION='uw-pixel-3.0.0';
export const PIXEL_FRAME={width:48,height:64,anchor:[24,63],sourcePixelRatio:2,directions:['south','southwest','west','northwest','north','northeast','east','southeast'],frames:4};

// Original eight-view wardrobe. Earlier renderers stay byte-for-byte intact.
export function pixelAvatar(recipe,skins,{direction='south',action='idle',frame=0}={}){
  const mirror=['west','southwest','northwest'].includes(direction);
  const side=['east','west'].includes(direction),front3=['southeast','southwest'].includes(direction),back3=['northeast','northwest'].includes(direction),back=direction==='north',rear=back||back3;
  const p=new PixelRaster(48,64),part=recipe.parts,c=recipe.colors,skin=skins[recipe.skin],skinShade=tint(skin,-.13),skinLight=tint(skin,.11),hair=c.hair,top=c.top,bottom=c.bottom,shoes=c.shoes;
  const ink='#655263',hairEdge=tint(hair,-.24),clothEdge=tint(top,-.31),shoeEdge=tint(shoes,-.32),eye='#392f3b';
  const phase=((frame%4)+4)%4,walk=action==='walk',stride=walk?[0,2,0,-2][phase]:0;
  const dy=(recipe.height==='short'?3:recipe.height==='tall'?-2:0)+(walk&&phase%2?1:0);
  const R=(x,y,w,h,color)=>p.rect(x,y+dy,w,h,color),E=(x,y,rx,ry,color)=>p.ellipse(x,y+dy,rx,ry,color),L=(x,y,x2,y2,color,width=1)=>p.line(x,y+dy,x2,y2+dy,color,width),P=(points,color)=>p.polygon(points.map(([x,y])=>[x,y+dy]),color);
  const broad=part.body==='body-athletic'?2:part.body==='body-slim'?-1:0;
  const half=side?6+(broad>0?1:broad):front3||back3?8+broad:9+broad,left=24-half,right=24+half;
  const long=['hair-bob','hair-long','hair-braids','hair-ponytail'].includes(part.hair);
  if(long){E(side?22:24,24,side?10:14,15,hairEdge);R(side?13:11,22,side?18:26,17,hair);}
  if(part.hair==='hair-ponytail'){
    const x=side||front3||back3?9:37;
    P([[x,14],[x+5,16],[x+6,31],[x+3,38],[x-1,32]],hairEdge);P([[x+1,17],[x+4,18],[x+4,30],[x+2,35]],hair);L(x+1,18,x+2,30,tint(hair,.2));R(x-1,15,7,3,'#c18ba2');
  }
  // Far arm and leg are drawn first for proper profile overlap.
  function leg(x,sign,far=false){
    const shift=sign*stride,shorts=part.bottom==='bottom-shorts',y=50+Math.min(1,dy),footY=59+Math.min(0,shift),footX=x+(side?shift:0);
    if(side){p.polygon([[x,y],[x+6,y],[footX+6,60],[footX,60]],shorts?skinShade:tint(bottom,far?-.23:-.1));p.polygon([[x+1,y+1],[x+5,y+1],[footX+5,59],[footX+1,59]],shorts?skin:bottom);}
    else{p.rect(x,y+shift,6,12-shift,shorts?skinShade:tint(bottom,far?-.23:-.1));p.rect(x+1,y+1+shift,4,9,shorts?skin:bottom);}
    p.rect(footX-1,footY+1,8,4,shoeEdge);p.rect(footX,footY,side?8:6,4,shoes);p.put(footX+1,footY,tint(shoes,.2));
    if(part.shoes==='shoes-sneakers'){p.rect(footX-1,footY+3,side?10:8,1,'#e8dfce');p.line(footX+2,footY+1,footX+4,footY+1,'#dcd7ca');}
    if(part.shoes==='shoes-high'){p.rect(footX+1,footY-3,4,4,shoes);p.line(footX+2,footY-2,footX+2,footY,'#ded3bd');}
    if(part.shoes==='shoes-loafers'){p.rect(footX+2,footY+1,3,1,'#d1b783');}
    if(part.shoes==='shoes-boots'){p.rect(footX,footY-4,6,5,shoes);p.rect(footX+1,footY-4,4,1,tint(shoes,.2));p.rect(footX-1,footY+3,9,1,'#746053');}
  }
  function arm(x,sign,far=false){
    const raised=action==='wave'&&sign===1&&!rear;
    const y=raised?26:37+sign*stride;
    E(x,y+3,3,5,far?tint(top,-.2):clothEdge);R(x-2,y,5,8,far?tint(top,-.13):top);
    E(x,y+(raised?-3:10),2,3,skinShade);E(x,y+(raised?-4:9),2,2,skin);
    if(raised){R(x+1,18+(phase%2),2,5,skin);R(x-1,20,2,4,skin);}
  }
  if(side){leg(20,-1,true);arm(21,-1,true);}else{leg(front3||back3?18:16,-1,true);leg(front3||back3?27:27,1);arm(left-2,-1,true);}
  // A compact rounded coat has a separate neck and softer edge than the hair.
  E(24,39,half,5,clothEdge);R(left,39,half*2,10,clothEdge);R(left+1,38,half*2-2,12,top);E(24,49,half-1,2,top);R(left+1,49,half*2-2,2,tint(top,-.13));L(left+2,48,right-3,48,tint(top,.17));
  if(side){R(right-3,39,2,9,tint(top,-.12));leg(24,1);}
  // Lower garments retain their own silhouettes even in the narrow side view.
  if(['bottom-skirt','bottom-culottes'].includes(part.bottom)){
    P([[left,48],[right,48],[right+2,56],[left-2,56]],tint(bottom,-.25));P([[left+1,49],[right-1,49],[right+1,55],[left-1,55]],bottom);
    for(let x=left+3;x<right;x+=4)L(x,51,x-1,55,tint(bottom,-.14));if(part.bottom==='bottom-culottes')L(24,51,24,56,tint(bottom,-.28));
  }else{R(left,49,half*2,4,tint(bottom,-.2));R(left+1,49,half*2-2,3,bottom);}
  if(part.bottom==='bottom-jeans'){p.line(side?25:18,54,side?25:18,58,'#a0b4bc');if(!side)p.line(29,54,29,58,'#a0b4bc');}
  if(part.bottom==='bottom-cargo'){R(side?28:left+1,51,4,4,tint(bottom,.14));R(side?29:left+2,52,2,1,tint(bottom,-.26));}
  // Clothing decoration belongs to the front plane; profiles use a narrow slice.
  if(!rear){
    const mid=side?30:front3?27:24;
    if(part.top==='top-varsity'){L(mid-2,35,mid-2,48,'#eee2c5',side?1:2);R(mid+3,38,2,4,'#d6b26d');if(!side){L(left+3,47,right-3,47,'#e8d9b8');for(let y=38;y<47;y+=3)R(mid,y,1,1,'#d7b882');}}
    if(part.top==='top-hoodie'){E(mid,35,side?3:6,3,tint(top,.23));if(!side){L(mid-3,37,mid-3,41,'#e2d7c1');L(mid+3,37,mid+3,41,'#e2d7c1');}R(mid-(side?2:5),44,side?4:10,3,tint(top,-.13));}
    if(part.top==='top-polo'){P([[mid-5,34],[mid,37],[mid+4,34],[mid+2,39],[mid,37],[mid-3,39]],'#ede2ce');L(mid,38,mid,42,tint(top,-.23));}
    if(part.top==='top-cardigan'){R(mid-2,35,side?3:5,14,'#e8ddc9');L(mid-3,37,mid-3,48,tint(top,-.21));for(let y=39;y<48;y+=3)R(mid+3,y,1,1,'#af9876');}
    if(part.top==='top-vest'){P([[mid-5,34],[mid,40],[mid+4,34]],'#ece3d0');L(mid-5,35,mid,41,tint(top,-.26));if(!side)L(mid+4,35,mid,41,tint(top,-.26));R(left+1,37,2,7,'#e8dfd0');}
    if(part.top==='top-tee'){E(mid,34,side?3:5,2,tint(top,-.15));R(side?31:right-6,39,2,2,tint(top,.23));}
  }else if(part.top==='top-hoodie'){E(side?23:24,36,5,3,tint(top,-.12));L(20,35,28,35,tint(top,.16));}
  if(part.accessory==='accessory-satchel'){L(side?29:15,34,side?27:32,49,'#be9b68',2);R(side?17:30,47,side?9:11,10,'#735947');R(side?18:31,48,side?7:9,8,'#b68f62');R(side?19:32,49,side?5:7,2,'#d5b58a');R(side?22:35,51,2,2,'#e0c796');}
  // Neck is small and partly covered by the jaw.
  R(side?26:21,29,side?4:6,6,skinShade);R(side?26:21,30,side?3:5,3,skin);
  const headX=side?24:front3||back3?25:24,headRx=side?11:14;
  E(headX,19,headRx,13,ink);E(headX,18,headRx-1,12,skin);E(headX,22,headRx-1,9,skin);E(headX+1,25,headRx-3,5,skinLight);
  if(!side&&!back3){E(10,22,2,3,skinShade);E(38,22,2,3,skinShade);E(10,21,1,2,skin);E(38,21,1,2,skin);}
  if(side||front3){E(side?22:13,22,2,3,skinShade);E(side?22:13,21,1,2,skin);R(35,21,side?3:2,4,skin);R(36,23,2,1,skinShade);}
  function eyeAt(x,width=4){
    const look=side||front3?1:0;
    const slim=width===3;
    R(x-1+look,17,slim?2:3,8,eye);R(x-2+look,18,slim?4:5,6,eye);
    R(x-1+look,18,slim?1:2,2,'#fff8ea');R(x+1+look,23,1,1,'#a8878e');
    L(x-2,15,x,14,tint(hair,.16));
  }
  if(!rear){
    if(side){eyeAt(31,3);L(33,28,35,27,'#ac766d');}
    else if(front3){eyeAt(23,3);eyeAt(33,4);R(30,25,1,1,skinShade);R(27,28,1,1,'#b57874');L(28,29,31,28,'#b57874');}
    else{eyeAt(18);eyeAt(30);R(24,25,1,1,skinShade);R(21,28,1,1,'#b67d77');R(26,28,1,1,'#b67d77');L(22,29,25,29,'#b67d77');R(23,30,2,1,'#d9a29a');}
    if(!side){R(front3?18:13,24,3,1,tint(skin,.05));R(front3?35:32,24,3,1,tint(skin,.05));}
  }
  // Broad hair highlights are deliberate clusters instead of random noise.
  E(side?22:24,10,side?12:14,7,hairEdge);E(side?22:24,10,side?11:13,6,hair);R(side?11:11,10,side?23:26,5,hair);
  L(side?14:15,7,side?25:27,5,tint(hair,.2));L(side?13:13,10,side?19:20,7,tint(hair,.12));
  if(part.hair==='hair-short'){P([[11,12],[18,11],[21,15],[25,12],[30,14],[36,11],[35,17],[31,15],[28,17],[22,15],[18,17],[14,15]],hair);R(side?12:11,13,4,7,hair);}
  if(part.hair==='hair-sidepart'){P([[12,10],[29,6],[32,10],[26,15],[16,17],[12,20]],hair);L(15,11,26,8,tint(hair,.22));P([[31,9],[37,12],[36,23],[33,19]],tint(hair,-.08));}
  if(part.hair==='hair-bob'){R(side?12:10,13,5,17,hair);R(side?33:34,12,4,18,hair);R(13,12,22,4,hair);L(11,17,11,26,tint(hair,.18));L(35,17,35,27,tint(hair,-.13));}
  if(part.hair==='hair-ponytail'){P([[12,12],[24,9],[35,12],[34,17],[29,14],[24,16],[19,14],[13,18]],hair);L(15,12,22,10,tint(hair,.18));}
  if(part.hair==='hair-curly'){for(const [x,y]of [[12,10],[17,6],[24,5],[30,7],[35,11],[36,16],[11,16]]){E(x,y,4,4,hairEdge);E(x,y-1,3,3,hair);R(x-1,y-2,2,1,tint(hair,.19));}}
  if(part.hair==='hair-braids'){R(12,12,22,4,hair);for(const x of side?[12]:[8,36]){for(let y=23;y<38;y+=4){E(x+2,y,3,3,hairEdge);E(x+2,y,2,2,hair);R(x+1,y-1,1,1,tint(hair,.19));}R(x,38,5,2,'#bc8fa4');}}
  if(part.hair==='hair-bun'){E(side?18:24,5,7,5,hairEdge);E(side?18:24,4,6,4,hair);L(side?15:21,2,side?20:26,1,tint(hair,.18));R(14,13,3,8,hair);}
  if(part.hair==='hair-long'){R(side?12:10,13,5,26,hair);R(side?33:34,12,4,27,hair);P([[12,11],[22,10],[30,14],[24,17],[18,14],[13,19]],hair);L(12,19,12,35,tint(hair,.17));L(35,20,35,36,tint(hair,-.15));}
  if(rear){
    E(back3?23:24,21,back3?12:13,11,hair);R(back3?13:14,24,back3?21:20,9,hair);L(17,14,16,28,tint(hair,.16));L(24,14,23,29,tint(hair,.08));L(31,16,32,28,tint(hair,-.13));
    if(back3){E(36,23,2,3,skinShade);E(36,22,1,2,skin);R(35,27,2,2,skin);}
  }
  if(!rear&&part.glasses!=='glasses-none'){
    const color=part.glasses==='glasses-oval'?'#bd9c65':'#65586a',centers=side?[31]:front3?[23,33]:[18,30];
    for(const x of centers){const rx=side?3:4,ry=part.glasses==='glasses-oval'?3:4;if(part.glasses==='glasses-square'){L(x-rx,16,x+rx,16,color);L(x-rx,24,x+rx,24,color);L(x-rx,16,x-rx,24,color);L(x+rx,16,x+rx,24,color);}else for(let i=0;i<32;i++){const a=i/32*Math.PI*2;p.put(x+Math.cos(a)*rx,20+dy+Math.sin(a)*ry,color);}R(x-2,17,2,1,'#e5dfd3');}
    if(!side)L(front3?26:22,19,front3?29:26,19,color);else L(23,18,28,19,color);
  }
  if(part.accessory==='accessory-scarf'){R(side?19:17,32,side?14:15,4,'#bc8e80');P([[side?29:29,35],[side?33:33,35],[side?32:32,46],[side?29:29,45]],'#cda28a');L(29,40,32,40,'#e5c6a6');}
  if(part.accessory==='accessory-cap'){E(side?22:24,8,side?12:14,6,'#65718b');R(side?11:11,8,side?23:26,6,'#65718b');R(side?27:front3?18:9,12,side?13:front3?20:29,3,'#46536d');R(side?30:23,6,3,4,'#dbc58c');L(15,8,19,5,'#8c98b1');}
  if(part.accessory==='accessory-headphones'){L(11,10,11,23,'#cdb78a',2);L(36,10,36,23,'#cdb78a',2);L(16,3,31,3,'#cdb78a',2);for(const x of side?[21]:[8,35]){R(x,19,5,9,'#514855');R(x+1,20,3,7,'#8c7e98');R(x+1,20,1,4,'#b3a5bb');}}
  if(part.accessory==='accessory-bow'){P([[33,10],[33,5],[38,8],[43,5],[43,12],[38,10]],'#bf8da7');R(37,7,3,4,'#dea7bb');L(35,7,36,8,'#efd0d5');}
  if(part.accessory==='accessory-backpack'){
    if(rear||side){const x=side?12:back3?13:15,w=side?9:18;R(x,35,w,19,'#765b50');R(x+1,36,w-2,17,'#b38e70');E(x+w/2,37,w/2-2,3,'#c8a889');R(x+2,43,w-4,7,'#cfac8b');L(x+3,43,x+w-4,43,'#e4cba4');R(x+w/2,44,2,2,'#f1dab1');}
    else{L(left+4,35,left+4,46,'#bd9f7d',2);L(right-4,35,right-4,46,'#bd9f7d',2);}
  }
  // Near arm stays in front of the torso, never as two frontal arms in profile.
  if(side)arm(27,1);else arm(right+1,1);
  if(mirror){const flipped=new PixelRaster(48,64);flipped.blit(p,0,0,true);return flipped;}
  return p;
}

export function pixelPartPreview(recipe,skins,slot){
  const regions={body:[8,5,32,59],hair:[5,0,38,43],top:[8,31,32,22],bottom:[10,47,28,13],shoes:[12,54,25,10],glasses:[9,13,31,16],accessory:[0,0,48,64]},[x,y,w,h]=regions[slot]||regions.body;
  const original=pixelAvatar(recipe,skins,{direction:recipe.parts.accessory==='accessory-backpack'&&slot==='accessory'?'north':'south'}),out=new PixelRaster(64,64),scale=Math.min(58/w,58/h),width=Math.round(w*scale),height=Math.round(h*scale),left=Math.floor((64-width)/2),top=Math.floor((64-height)/2);
  for(let py=0;py<height;py++)for(let px=0;px<width;px++){const sx=Math.min(47,x+Math.floor(px/scale)),sy=Math.min(63,y+Math.floor(py/scale));out.pixels[(top+py)*64+left+px]=original.pixels[sy*48+sx];}return out;
}
