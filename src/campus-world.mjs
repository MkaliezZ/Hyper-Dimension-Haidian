import {protocol} from './base.mjs';
import {positionAlong} from './navigation.mjs';
export const UW_SCENE='uw-outdoors';

export function createCampusWorld(campus, nav, pack, receptionSessions) {
  const requireSpace=id=>{if(id!==campus.id)protocol.fail('space_missing','School space not found',404);};
  const publicPlaces=spaceId=>{requireSpace(spaceId);return nav.places.map(p=>({
    sceneId:UW_SCENE,entityId:p.id,label:p.name,name:p.name,sceneName:'UW Seattle · 户外校园',
    kind:'outdoor-landmark',geometryHash:campus.geometryHash,
  }));};
  const position=(state,principal)=>{
    const move=state.positions?.[protocol.digest([principal.id,campus.id])];
    const point=positionAlong(move)||[...nav.nodes[nav.landmark('red-square').arrivalNode]];
    const last=move?.path?.at(-1)?.point;
    const moving=Boolean(move&&!move.stopped&&last&&Math.hypot(...point.map((v,i)=>v-last[i]))>.01);
    return {sceneId:UW_SCENE,levelId:'outdoors',point,moving};
  };
  return {receptionSessions,position,packFor(id){requireSpace(id);return pack;},
    placeAdapter:{contract:'hyper-dimension.geo-campus/v1',supports:id=>id===campus.id,publicPlaces,
      toolPlace(spaceId,pos,sceneId,entityId,action){
        requireSpace(spaceId);
        if(sceneId!==UW_SCENE||pos.sceneId!==UW_SCENE||pos.levelId!=='outdoors')protocol.fail('tool_scene_denied','Wrong outdoor scene',403);
        const p=nav.places.find(p=>p.id===entityId);
        if(action!=='wave'&&!p)protocol.fail('tool_public_place_required','Choose a published outdoor landmark',403);
        if(['postcard','stamp','note'].includes(action)){
          const arrival=nav.nodes[p.arrivalNode];
          if(pos.moving||!Array.isArray(pos.point)||pos.point.length!==3||!pos.point.every(Number.isFinite)||Math.hypot(...pos.point.map((v,i)=>v-arrival[i]))>3)
            protocol.fail('tool_arrival_required','Walk to this landmark before using the item',409);
        }
        return {sceneId:UW_SCENE,entityId:p?.id||null,name:p?.name||null,levelName:'户外校园',geometryHash:campus.geometryHash};
      },
    },
  };
}
