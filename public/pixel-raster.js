// Deterministic, palette-only pixel drawing shared by the browser and asset exporter.
const colors=new Map();
export function rgba(color){if(typeof color==='number')return color>>>0;if(!color||color==='transparent')return 0;if(colors.has(color))return colors.get(color);const h=color.replace('#',''),r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16),value=(r|g<<8|b<<16|255<<24)>>>0;colors.set(color,value);return value;}
export function tint(color,amount){const c=rgba(color),mix=v=>Math.max(0,Math.min(255,Math.round(v+(amount>=0?255-v:v)*amount)));return '#'+[c&255,c>>>8&255,c>>>16&255].map(v=>mix(v).toString(16).padStart(2,'0')).join('');}
export function pixelHash(x,y,seed=17){let n=Math.imul(x+seed,374761393)^Math.imul(y-seed,668265263);n=Math.imul(n^(n>>>13),1274126177);return (n^(n>>>16))>>>0;}
export class PixelRaster{
  constructor(width,height){this.width=width;this.height=height;this.pixels=new Uint32Array(width*height);this.data=new Uint8ClampedArray(this.pixels.buffer);}
  put(x,y,color){x=Math.round(x);y=Math.round(y);if(x>=0&&y>=0&&x<this.width&&y<this.height)this.pixels[y*this.width+x]=rgba(color);}
  fill(color){this.pixels.fill(rgba(color));return this;}
  rect(x,y,w,h,color){const c=rgba(color),x0=Math.min(this.width,Math.max(0,Math.round(x))),x1=Math.max(0,Math.min(this.width,Math.round(x+w))),y0=Math.min(this.height,Math.max(0,Math.round(y))),y1=Math.max(0,Math.min(this.height,Math.round(y+h)));if(x1>x0&&y1>y0)for(let yy=y0;yy<y1;yy++)this.pixels.fill(c,yy*this.width+x0,yy*this.width+x1);return this;}
  line(x0,y0,x1,y1,color,width=1){x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;let error=dx+dy;for(;;){this.rect(x0-Math.floor(width/2),y0-Math.floor(width/2),width,width,color);if(x0===x1&&y0===y1)break;const e=2*error;if(e>=dy){error+=dy;x0+=sx;}if(e<=dx){error+=dx;y0+=sy;}}return this;}
  circle(cx,cy,r,color){for(let y=-r;y<=r;y++){const span=Math.floor(Math.sqrt(Math.max(0,r*r-y*y)));this.rect(cx-span,cy+y,span*2+1,1,color);}return this;}
  ellipse(cx,cy,rx,ry,color){for(let y=-ry;y<=ry;y++){const span=Math.floor(rx*Math.sqrt(Math.max(0,1-y*y/(ry*ry||1))));this.rect(cx-span,cy+y,span*2+1,1,color);}return this;}
  polygon(input,color){const rings=typeof input[0]?.[0]==='number'?[input]:input,c=rgba(color),ys=rings.flat().map(p=>p[1]),min=Math.max(0,Math.floor(Math.min(...ys))),max=Math.min(this.height-1,Math.ceil(Math.max(...ys)));for(let y=min;y<=max;y++){const crossings=[];for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y+.5)!==(b[1]>y+.5))crossings.push(a[0]+(b[0]-a[0])*(y+.5-a[1])/(b[1]-a[1]));}crossings.sort((a,b)=>a-b);for(let i=0;i+1<crossings.length;i+=2){const x0=Math.max(0,Math.ceil(crossings[i]-.5)),x1=Math.min(this.width,Math.ceil(crossings[i+1]-.5));if(x1>x0)this.pixels.fill(c,y*this.width+x0,y*this.width+x1);}}return this;}
  stroke(ring,color,width=1){for(let i=0;i<ring.length;i++)this.line(...ring[i],...ring[(i+1)%ring.length],color,width);return this;}
  blit(source,x,y,flip=false){for(let yy=0;yy<source.height;yy++)for(let xx=0;xx<source.width;xx++){const c=source.pixels[yy*source.width+xx];if(c>>>24)this.put(x+(flip?source.width-1-xx:xx),y+yy,c);}return this;}
}

export function rasterCanvas(raster,canvas=document.createElement('canvas')){canvas.width=raster.width;canvas.height=raster.height;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.putImageData(new ImageData(raster.data,raster.width,raster.height),0,0);return canvas;}
