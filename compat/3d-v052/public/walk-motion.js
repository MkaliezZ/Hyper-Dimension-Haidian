export function motionPoint(move,now){
  if(!move?.path?.length)return null;let remaining=Math.max(0,now-move.startedAt)/1000*move.previewSpeed;
  for(let i=1;i<move.path.length;i++){const a=move.path[i-1].point,b=move.path[i].point,length=Math.hypot(...a.map((v,k)=>b[k]-v));if(remaining<length){const t=length?remaining/length:1;return a.map((v,k)=>v+(b[k]-v)*t);}remaining-=length;}
  return [...move.path.at(-1).point];
}

// Rendering prediction only: the backend continues to own durable position and collisions.
export function createWalkPresentation(walking,initial){
  let point=[...initial],error=[0,0,0],lastAck=0,active=false;
  return {reset(position,now){point=[...position];error=[0,0,0];lastAck=now;active=true;},
    acknowledge(position,now){if(!position)return;error=position.map((v,i)=>v-point[i]);lastAck=now;active=true;},
    advance(direction,deltaMs,now){
      if(!active)return [...point];const dt=Math.max(0,Math.min(50,deltaMs));
      if(direction&&now-lastAck<=500&&dt>0)point=walking.step(point,direction,dt).path.at(-1).point;
      const blend=1-Math.exp(-dt/150),next=[point[0]+error[0]*blend,point[1],point[2]+error[2]*blend];
      if(walking.segmentClear(point,next)){point=next;point[1]=walking.height(point[0],point[2]);}error=error.map(v=>v*(1-blend));if(Math.hypot(error[0],error[2])<.000001)error=[0,0,0];
      return [...point];
    },get waiting(){return active;}};
}
