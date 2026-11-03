// Presentation coordinates only. The server's GIS positions and collisions never change.
export const OBLIQUE={x:.78,y:.39,pixelsPerMetre:2};
export const ZOOM_LEVELS=Object.freeze([.0625,.09375,.125,.1875,.25,.375,.5,.75,1,1.25,1.5,2]);
export const project=(x,z)=>[OBLIQUE.x*(x+z),OBLIQUE.y*(z-x)];
export const unproject=(u,v)=>[(u/OBLIQUE.x-v/OBLIQUE.y)/2,(u/OBLIQUE.x+v/OBLIQUE.y)/2];
export function screenDirection(x,y){const [wx,wz]=unproject(x,y),n=Math.hypot(wx,wz);return n?[wx/n,wz/n]:[0,0];}
export function nextZoom(value,factor){if(factor>1)return ZOOM_LEVELS.find(n=>n>value+.001)??ZOOM_LEVELS.at(-1);return [...ZOOM_LEVELS].reverse().find(n=>n<value-.001)??ZOOM_LEVELS[0];}
export function nearestZoom(value){return ZOOM_LEVELS.reduce((a,b)=>Math.abs(b-value)<Math.abs(a-value)?b:a);}
export function projectedBounds(rings){const points=rings.flat().map(p=>project(...p)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];}
// Front-most ground edge at a sprite column, rather than a single depth for a whole wide building.
export function frontDepthAtU(rings,u){let front=-Infinity;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=project(...ring[i]),b=project(...ring[j]);if(u<Math.min(a[0],b[0])-.001||u>Math.max(a[0],b[0])+.001)continue;const du=b[0]-a[0];if(Math.abs(du)<.001){front=Math.max(front,a[1],b[1]);continue;}const t=(u-a[0])/du;front=Math.max(front,a[1]+(b[1]-a[1])*t);}return front;}
export function groundChunks(width,height,size=256,bleed=1){const chunks=[];for(let y=0;y<height;y+=size)for(let x=0;x<width;x+=size){const left=Math.max(0,x-bleed),top=Math.max(0,y-bleed),right=Math.min(width,x+size+bleed),bottom=Math.min(height,y+size+bleed);chunks.push({x,y,width:Math.min(size,width-x),height:Math.min(size,height-y),source:[left,top,right-left,bottom-top]});}return chunks;}
export function minimapWorld(x,y,width,height,bounds){return [bounds[0]+Math.max(0,Math.min(1,x/width))*(bounds[2]-bounds[0]),bounds[1]+Math.max(0,Math.min(1,y/height))*(bounds[3]-bounds[1])];}
