import {PixelRaster} from './pixel-raster.js';
export function pixelItem(kind){
  const p=new PixelRaster(24,24),ink='#494652',paper='#eee0b9',gold='#c5a166',green='#8aab7b',purple='#8e75a2';
  if(kind==='bookmark'){p.rect(4,3,16,18,ink);p.rect(5,4,14,16,paper);p.line(9,4,9,19,'#baae8c');p.line(15,4,15,19,'#baae8c');p.polygon([[6,14],[10,9],[14,14],[18,8],[18,17],[6,17]],green);p.rect(16,4,2,5,purple);}
  else if(kind==='postcard'){p.rect(2,5,20,15,ink);p.rect(3,6,18,13,paper);p.rect(4,7,9,11,'#a8cfce');p.polygon([[4,17],[8,10],[13,17]],green);p.rect(16,8,3,3,purple);p.line(15,14,19,14,gold);p.line(15,16,18,16,gold);}
  else if(kind==='stamp'){p.rect(3,15,18,6,ink);p.rect(4,16,16,3,purple);p.rect(9,8,6,8,ink);p.circle(12,7,5,ink);p.circle(12,6,3,gold);p.rect(9,12,6,2,gold);p.rect(6,20,12,1,gold);}
  else if(kind==='wave'){p.rect(5,3,2,19,ink);p.polygon([[7,3],[21,5],[19,13],[7,11]],purple);p.rect(10,5,2,5,paper);p.rect(16,6,2,4,paper);p.rect(12,9,4,2,paper);p.rect(4,21,5,1,gold);}
  else{p.rect(5,3,15,19,ink);p.rect(6,4,13,16,paper);for(let y=8;y<=16;y+=4)p.line(8,y,16,y,gold);p.line(3,18,15,6,ink,3);p.line(4,17,15,6,purple,2);p.put(2,20,ink);}
  return p;
}
