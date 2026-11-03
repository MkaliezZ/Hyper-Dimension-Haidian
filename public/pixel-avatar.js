import {PixelRaster,tint} from './pixel-raster.js';
export const PIXEL_AVATAR_VERSION='uw-pixel-1.0.0';
export const PIXEL_FRAME={width:24,height:32,anchor:[12,31],directions:['south','west','east','north'],frames:4};
export function pixelAvatar(recipe,skins,{direction='south',action='idle',frame=0}={}){
  const p=new PixelRaster(24,32),parts=recipe.parts,c=recipe.colors,skin=skins[recipe.skin],shade=tint(skin,-.18),ink='#353341',hair=c.hair,top=c.top,bottom=c.bottom,shoe=c.shoes;
  const slim=parts.body==='body-slim',athletic=parts.body==='body-athletic',left=slim?8:athletic?6:7,right=24-left,walk=action==='walk',step=walk?[0,1,0,-1][frame%4]:0,bob=walk&&frame%2?1:0,short=recipe.height==='short'?2:recipe.height==='tall'?-1:0;
  const R=(x,y,w,h,col)=>p.rect(x,Math.max(0,y+bob+short),w,h,col),L=(x0,y0,x1,y1,col,w=1)=>p.line(x0,y0+bob+short,x1,y1+bob+short,col,w),C=(x,y,r,col)=>p.circle(x,y+bob+short,r,col);
  const back=direction==='north',side=direction==='east'||direction==='west',hairLong=['hair-long','hair-bob','hair-ponytail','hair-braids'].includes(parts.hair);
  if(hairLong){R(5,8,14,14,ink);R(6,9,12,12,hair);}
  R(left,17,right-left,10,ink);R(left+1,18,right-left-2,8,top);R(left,19,1,6,tint(top,-.2));R(right-1,19,1,6,tint(top,-.3));
  if(parts.bottom==='bottom-skirt'||parts.bottom==='bottom-culottes'){
    p.polygon([[left,24+bob],[right,24+bob],[right+1,28],[left-1,28]],ink);p.rect(left,25+bob,right-left,2,bottom);if(parts.bottom==='bottom-culottes')p.line(12,25,12,27,ink);else{p.put(9,26,tint(bottom,.24));p.put(15,26,tint(bottom,.24));}
  }else{p.rect(left,25,right-left,3,ink);p.rect(left+1,25,Math.floor((right-left)/2)-1,3+step,bottom);p.rect(13,25,Math.ceil((right-left)/2)-2,3-step,bottom);}
  const shorts=parts.bottom==='bottom-shorts';p.rect(8,27+step,4,3,shorts?skin:bottom);p.rect(13,27-step,4,3,shorts?skin:bottom);
  if(parts.bottom==='bottom-jeans'){p.put(9,26,'#8a9faf');p.put(14,27,'#8a9faf');p.line(12,25,12,28,ink);}if(parts.bottom==='bottom-cargo'){p.rect(left,25,2,2,tint(bottom,.22));p.rect(right-2,25,2,2,tint(bottom,.22));}
  for(const [x,y] of [[7,29+Math.min(0,step)],[13,29-Math.max(0,step)]]){p.rect(x,y,5,3,ink);p.rect(x+1,y,4,2,shoe);if(parts.shoes==='shoes-sneakers'){p.rect(x+1,y+2,4,1,'#f8edda');p.put(x+2,y,'#b7b1aa');}if(parts.shoes==='shoes-high')p.rect(x+1,y-2,3,3,shoe);if(parts.shoes==='shoes-loafers')p.rect(x+2,y,2,1,'#cfae62');if(parts.shoes==='shoes-boots'){p.rect(x+1,y-3,3,4,shoe);p.rect(x,y+2,5,1,'#775c48');}}
  for(const [x,arm] of [[left-2,-1],[right,1]]){const raised=action==='wave'&&arm===1;R(x,raised?11:19+arm*step,3,raised?7:6,ink);R(x,raised?12:20+arm*step,2,4,top);R(x,raised?9:24+arm*step,3,3,skin);if(raised)R(x+1,8+(frame%2),2,2,skin);}
  R(9,15,6,3,shade);
  R(6,4,12,12,ink);R(5,6,14,8,ink);R(6,5,12,10,skin);R(7,15,10,1,shade);R(4,9,2,4,shade);R(18,9,2,4,shade);R(6,13,2,2,tint(skin,.1));
  if(!back){if(side){R(14,9,2,3,ink);R(14,9,1,1,'#fff7df');R(18,11,2,2,shade);R(15,14,2,1,'#87594f');}else{R(8,9,2,3,ink);R(14,9,2,3,ink);R(8,9,1,1,'#fff7df');R(14,9,1,1,'#fff7df');R(10,14,4,1,'#8d5c54');R(6,12,2,1,'#d59482');R(16,12,2,1,'#d59482');}}
  R(7,3,10,2,ink);R(5,5,14,3,hair);R(7,4,10,2,tint(hair,.1));
  if(parts.hair==='hair-short'){R(6,7,3,2,hair);R(14,7,4,1,hair);}
  if(parts.hair==='hair-sidepart'){R(6,6,9,2,hair);R(6,8,4,1,hair);L(14,5,18,9,hair,2);}
  if(parts.hair==='hair-bob'){R(5,7,2,9,hair);R(17,7,2,9,hair);R(7,7,10,1,hair);}
  if(parts.hair==='hair-ponytail'){R(18,6,3,10,ink);R(19,7,2,7,hair);R(18,7,2,2,'#b58185');}
  if(parts.hair==='hair-curly'){for(const [x,y] of [[6,4],[9,3],[12,3],[15,4],[17,6]])C(x,y,2,hair);R(5,7,3,2,hair);}
  if(parts.hair==='hair-braids'){for(const x of [4,18])for(let y=9;y<19;y+=3){R(x,y,3,3,ink);R(x+1,y,2,2,hair);}R(4,18,3,1,'#ac7f98');R(18,18,3,1,'#ac7f98');}
  if(parts.hair==='hair-bun'){R(8,0,8,4,ink);R(9,1,6,3,hair);R(10,0,4,1,tint(hair,.17));}
  if(parts.hair==='hair-long'){R(5,7,2,13,hair);R(17,7,2,13,hair);L(7,6,11,8,hair,2);}
  if(back){R(6,6,12,9,hair);R(7,15,10,2,hair);R(9,6,1,7,tint(hair,.16));}
  if(!back){
    if(parts.top==='top-varsity'){L(9,18,9,25,'#eddfbd');R(right-3,20,2,2,'#eddfbd');R(left,23,right-left,1,tint(top,.2));}
    if(parts.top==='top-hoodie'){R(9,17,6,2,tint(top,.28));L(10,19,10,22,'#e7dcc6');L(14,19,14,22,'#e7dcc6');R(9,24,6,1,tint(top,-.25));}
    if(parts.top==='top-polo'){R(9,17,6,1,'#eee3c8');R(11,18,2,3,tint(top,-.4));}
    if(parts.top==='top-cardigan'){R(10,17,4,9,'#efe3cc');L(10,18,10,24,tint(top,-.3));for(let y=19;y<=23;y+=2)R(13,y,1,1,'#8a7051');}
    if(parts.top==='top-vest'){R(8,17,8,2,'#eee5d2');R(left-1,20,2,3,'#eee5d2');R(right-1,20,2,3,'#eee5d2');L(9,18,12,21,tint(top,-.3));L(15,18,12,21,tint(top,-.3));}
    if(parts.top==='top-tee'){R(10,17,4,1,tint(top,-.25));R(right-3,21,1,2,tint(top,.3));}
    if(parts.glasses!=='glasses-none'){
      const gc=parts.glasses==='glasses-oval'?'#c6aa73':'#3e3b43';if(parts.glasses==='glasses-square'){R(7,8,5,1,gc);R(13,8,5,1,gc);R(7,12,5,1,gc);R(13,12,5,1,gc);L(7,8,7,12,gc);L(17,8,17,12,gc);}else{for(const x of [9,15]){R(x-1,8,3,1,gc);R(x-2,9,1,3,gc);R(x+2,9,1,3,gc);R(x-1,12,3,1,gc);}if(parts.glasses==='glasses-oval')R(7,11,11,1,gc);}R(11,10,3,1,gc);
    }
  }
  if(parts.accessory==='accessory-satchel'){L(7,17,16,26,'#d3ac64',2);R(15,24,6,5,ink);R(16,24,4,4,'#c5a168');R(17,25,2,1,'#edd8a4');}
  if(parts.accessory==='accessory-scarf'){R(8,16,8,3,'#b77462');R(14,18,3,6,'#d49b79');R(14,23,3,1,'#eee0b7');}
  if(parts.accessory==='accessory-cap'){R(5,2,14,4,'#4d5a76');R(4,5,16,2,'#313d54');R(10,2,3,2,'#e7ce85');}
  if(parts.accessory==='accessory-headphones'){L(5,5,5,12,'#d1ab70',2);L(18,5,18,12,'#d1ab70',2);R(7,2,10,1,'#d1ab70');R(4,9,3,5,'#4c485c');R(18,9,3,5,'#4c485c');}
  if(parts.accessory==='accessory-backpack'){if(back){R(7,18,11,9,ink);R(8,19,9,7,'#ad7859');R(9,22,7,3,'#c9986d');}else{L(8,18,8,25,'#c59868',2);L(16,18,16,25,'#c59868',2);R(6,20,1,4,'#ad7859');}}
  if(parts.accessory==='accessory-bow'){R(16,5,3,3,'#c67b8d');R(19,6,2,3,'#e5a6b0');R(18,6,1,2,'#8d566f');}
  if(direction==='west'){const flipped=new PixelRaster(24,32);flipped.blit(p,0,0,true);return flipped;}
  return p;
}
