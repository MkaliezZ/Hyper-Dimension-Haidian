// MIT javascript-astar search/heap, with our geometry-checked lazy grid adapter.
// No user identity, position, cookie or session is retained by this adapter.
import library from './vendor/javascript-astar/astar.cjs';
const {astar}=library;
export function createSafePathfinder(walking,{cell=2,maxExpanded=60000}={}){
  const [x0,z0,x1,z1]=walking.bounds;
  const point=(x,z)=>[x0+x*cell,walking.height(x0+x*cell,z0+z*cell),z0+z*cell];
  function find(from,to){
    if(!walking.allowed(from[0],from[2])||!walking.allowed(to[0],to[2]))return null;
    if(walking.segmentClear(from,to))return [[...from],[...to]];
    const nodes=new Map(),dirty=[],edges=new Map();let expanded=0;
    const get=(x,z)=>{
      if(x<0||z<0||x0+x*cell>x1||z0+z*cell>z1)return null;
      const key=x+':'+z;if(nodes.has(key))return nodes.get(key);
      const p=point(x,z),weight=walking.allowed(p[0],p[2])?1:0;
      const node={x,y:z,p,weight,isWall(){return !this.weight;},getCost(other){return Math.hypot(this.x-other.x,this.y-other.y)*cell;}};
      astar.cleanNode(node);nodes.set(key,node);return node;
    };
    const attach=p=>{
      const ix=Math.round((p[0]-x0)/cell),iz=Math.round((p[2]-z0)/cell),options=[];
      for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){const n=get(ix+dx,iz+dz);if(n?.weight&&walking.segmentClear(p,n.p))options.push(n);}
      return options.sort((a,b)=>Math.hypot(a.p[0]-p[0],a.p[2]-p[2])-Math.hypot(b.p[0]-p[0],b.p[2]-p[2]))[0];
    };
    const start=attach(from),end=attach(to);if(!start||!end)return null;
    const clear=(a,b)=>{const ak=a.x+':'+a.y,bk=b.x+':'+b.y,key=ak<bk?ak+'|'+bk:bk+'|'+ak;if(!edges.has(key))edges.set(key,walking.segmentClear(a.p,b.p));return edges.get(key);};
    const graph={cleanDirty(){for(const n of dirty)astar.cleanNode(n);dirty.length=0;},markDirty(n){dirty.push(n);},neighbors(n){
      if(++expanded>maxExpanded)return [];
      const out=[];
      for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
        if(!dx&&!dz)continue;const next=get(n.x+dx,n.y+dz);if(!next?.weight)continue;
        if(dx&&dz&&(!get(n.x+dx,n.y)?.weight||!get(n.x,n.y+dz)?.weight))continue;
        if(clear(n,next))out.push(next);
      }return out;
    }};
    const result=start===end?[]:astar.search(graph,start,end,{heuristic:(a,b)=>astar.heuristics.diagonal(a,b)*cell,closest:false});
    if(expanded>maxExpanded||(start!==end&&!result.length))return null;
    const raw=[[...from],start.p,...result.map(n=>n.p),[...to]],path=[raw[0]];
    for(let i=0;i<raw.length-1;){let next=raw.length-1;while(next>i+1&&!walking.segmentClear(raw[i],raw[next]))next--;if(!walking.segmentClear(raw[i],raw[next]))return null;path.push(raw[next]);i=next;}
    return path.filter((p,i)=>!i||Math.hypot(p[0]-path[i-1][0],p[2]-path[i-1][2])>1e-7);
  }
  return {find,cell,maxExpanded};
}
