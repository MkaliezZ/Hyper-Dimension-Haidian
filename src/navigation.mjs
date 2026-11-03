// School-only outdoor adapter. Base's indoor contract and source GIS remain unchanged.
import {createCampusWalking} from '../public/campus-walking.js';
import {createSafePathfinder} from './safe-pathfinding.mjs';
import {campusPlaces} from '../public/campus-places.js';
const noRoute=message=>Object.assign(Error(message||'当前可通行区域中没有连通路线。'),{status:409,code:'no_route'});
const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const length=path=>path.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,j)=>v-path[i][j])),0);
export function createCampusNavigation(campus){
  const {edges}=campus.graph,nodes=[...campus.graph.nodes],originalNodeCount=nodes.length,walking=createCampusWalking(campus),finder=createSafePathfinder(walking),fine=createSafePathfinder(walking,{cell:1,maxExpanded:80000});
  const links=nodes.map(()=>[]),edgeCache=new Map(),routeCache=new Map();
  const places=campusPlaces(campus).map(p=>{
    if(p.arrivalNode!==undefined)return p;
    const building=campus.buildings.find(b=>b.id===p.buildingId),ring=building.rings[0],options=[];
    // An exterior approach point, not an invented entrance or a distant graph node.
    for(let i=1;i<ring.length;i++){
      const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.1)continue;
      for(const side of [-1,1])for(const offset of [1.5,3]){
        const x=(a[0]+b[0])/2+side*dz/length*offset,z=(a[1]+b[1])/2-side*dx/length*offset;
        if(walking.allowed(x,z))options.push({point:[x,walking.height(x,z),z],distance:Math.min(...campus.graph.nodes.map(n=>Math.hypot(n[0]-x,n[2]-z)))});
      }
    }
    const arrival=options.sort((a,b)=>a.distance-b.distance)[0];if(!arrival)throw Error('No safe exterior approach for '+p.id);
    const arrivalNode=nodes.length;nodes.push(arrival.point);links.push([]);return {...p,arrivalNode};
  });
  for(const [a,b,metres]of edges){if(!nodes[a]||!nodes[b]||!Number.isFinite(metres)||metres<=0)throw Error('Invalid outdoor graph edge');links[a].push([b,metres]);links[b].push([a,metres]);}
  const landmark=id=>{const row=places.find(p=>p.id===id);if(!row)throw Object.assign(Error('未找到这处校园地点。'),{status:404,code:'landmark_missing'});return row;};
  function nearest(point,limit=35){if(!finite(point))throw Object.assign(Error('Expected finite XYZ position'),{status:400,code:'invalid_position'});let index=-1,distance=limit;nodes.forEach((n,i)=>{const d=Math.hypot(n[0]-point[0],n[2]-point[2]);if(d<distance&&walking.allowed(n[0],n[2])){distance=d;index=i;}});if(index<0)throw Object.assign(Error('位置不在已核对的导览路径附近。'),{status:400,code:'off_path'});return index;}
  const find=(a,b)=>finder.find(a,b)||fine.find(a,b);
  function edge(a,b){const reverse=a>b,key=reverse?b+':'+a:a+':'+b;if(!edgeCache.has(key)){const path=find(nodes[Math.min(a,b)],nodes[Math.max(a,b)]);edgeCache.set(key,path?{path,distance:length(path),detour:!walking.segmentClear(nodes[a],nodes[b])}:null);}const row=edgeCache.get(key);return row&&{...row,path:reverse?[...row.path].reverse():row.path};}
  function network(start,end){
    const key=start+':'+end;if(routeCache.has(key))return routeCache.get(key);
    if(!nodes[start]||!nodes[end])throw Object.assign(Error('Invalid route endpoint'),{status:400,code:'invalid_endpoint'});
    if(!walking.allowed(nodes[start][0],nodes[start][2])||!walking.allowed(nodes[end][0],nodes[end][2]))throw noRoute();
    const dist=new Float64Array(nodes.length).fill(Infinity),prev=new Int32Array(nodes.length).fill(-1),seen=new Uint8Array(nodes.length);dist[start]=0;
    for(let count=0;count<nodes.length;count++){let best=-1,cost=Infinity;for(let i=0;i<nodes.length;i++)if(!seen[i]&&dist[i]<cost){best=i;cost=dist[i];}if(best<0||best===end)break;seen[best]=1;
      for(const [next]of links[best]){if(seen[next])continue;const safe=edge(best,next);if(safe&&cost+safe.distance<dist[next]){dist[next]=cost+safe.distance;prev[next]=best;}}
    }
    if(!Number.isFinite(dist[end])){const fallback=find(nodes[start],nodes[end]);if(!fallback)throw noRoute();const result={path:fallback,detours:1,networkFallback:true};routeCache.set(key,result);return result;}
    const indices=[];for(let i=end;i!==-1;i=prev[i])indices.push(i);indices.reverse();const path=[[...nodes[start]]];let detours=0;
    for(let i=1;i<indices.length;i++){const row=edge(indices[i-1],indices[i]);path.push(...row.path.slice(1));detours+=Number(row.detour);}
    const result={path,detours,networkFallback:false};routeCache.set(key,result);return result;
  }
  function route(from,to){
    const end=typeof to==='string'?landmark(to).arrivalNode:to;if(!nodes[end])throw Object.assign(Error('Invalid route endpoint'),{status:400,code:'invalid_endpoint'});
    let result,start=Number.isInteger(from)?from:null,connector=false;
    if(end>=originalNodeCount||(start!==null&&start>=originalNodeCount)){
      const source=start===null?from:nodes[start];if(!finite(source)||!walking.allowed(source[0],source[2]))throw noRoute();
      const path=find(source,nodes[end]);if(!path)throw noRoute('此处暂未找到可安全连通的室外路线。地点留言仍可使用。');
      result={path,detours:1,networkFallback:true};connector=start===null;
    }
    else if(start!==null)result=network(start,end);
    else{
      if(!finite(from))throw Object.assign(Error('Expected finite XYZ position'),{status:400,code:'invalid_position'});
      if(!walking.allowed(from[0],from[2]))throw Object.assign(Error('当前位置不在可漫游区域，请沿公共步道返回。'),{status:409,code:'off_path'});
      const candidates=nodes.map((p,index)=>({p,index,d:Math.hypot(p[0]-from[0],p[2]-from[2])})).filter(n=>n.d<160&&walking.allowed(n.p[0],n.p[2])).sort((a,b)=>a.d-b.d).slice(0,16);
      let best=null;
      for(const n of candidates){let tail;try{tail=network(n.index,end);}catch(error){if(error.code==='no_route')continue;throw error;}if(!walking.segmentClear(from,n.p))continue;const path=[[...from],...tail.path],distance=length(path);if(!best||distance<best.distance)best={path,distance,detours:tail.detours,networkFallback:tail.networkFallback};}
      if(!best)for(const n of candidates.slice(0,4)){const head=find(from,n.p);if(!head)continue;let tail;try{tail=network(n.index,end);}catch(error){if(error.code==='no_route')continue;throw error;}const path=[...head,...tail.path.slice(1)],distance=length(path);if(!best||distance<best.distance)best={path,distance,detours:tail.detours+1,networkFallback:tail.networkFallback};}
      if(!best){const path=find(from,nodes[end]);if(!path)throw noRoute('这里与目的地没有可安全连通的室外路线。请先手动走到公共步道。');best={path,detours:1,networkFallback:true};}
      result=best;connector=true;
    }
    const clean=result.path.filter((p,i)=>!i||Math.hypot(p[0]-result.path[i-1][0],p[2]-result.path[i-1][2])>1e-7);
    const path=[{levelId:'outdoors',point:[...clean[0]]}];
    for(let i=1;i<clean.length;i++){const a=clean[i-1],b=clean[i];if(!walking.segmentClear(a,b))throw noRoute('路线校验未通过，已阻止穿越障碍。');const count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])));for(let n=1;n<=count;n++){const t=n/count,x=a[0]+(b[0]-a[0])*t,z=a[2]+(b[2]-a[2])*t;path.push({levelId:'outdoors',point:[x,walking.height(x,z),z]});}}
    const distance=Number(length(path.map(n=>n.point)).toFixed(1));
    return {format:'hyper-dimension.geo-route/v1',sceneId:campus.id,geometryHash:campus.geometryHash,fromNode:start,toNode:end,distance,estimatedWalkingMinutes:distance?Math.max(1,Math.ceil(distance/75)):0,path,freeWalkConnector:connector,obstacleDetours:result.detours,networkFallback:result.networkFallback,planner:'public-graph + MIT javascript-astar; shared swept geometry; no teleport or corner-cutting',provenance:'UW public network with geometry-checked outdoor detours; no accessibility/closure guarantee'};
  }
  return {nodes,links,places,landmark,nearest,route,walking};
}
export function positionAlong(move,now=Date.now()){
  if(!move?.path?.length)return null;let remaining=Math.max(0,(now-move.startedAt)/1000)*move.previewSpeed;
  for(let i=1;i<move.path.length;i++){const a=move.path[i-1].point,b=move.path[i].point,length=Math.hypot(...a.map((v,j)=>b[j]-v));if(remaining<length){const t=length?remaining/length:1;return a.map((v,j)=>v+(b[j]-v)*t);}remaining-=length;}return [...move.path.at(-1).point];
}
