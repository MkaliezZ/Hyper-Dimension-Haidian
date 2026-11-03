import {protocol} from './base.mjs';
import {UW_SCENE} from './campus-world.mjs';

// Native Base discovery contract, using the explicit outdoor scene adapter.
// Only package metadata is projected: no profiles, conversations or knowledge
// documents are read or returned through this catalog.
export function campusCatalog({principal,pack,platform,reception,knowledge,geometryHash,schoolId}){
  const visible=Array.isArray(principal.spaces)&&principal.spaces.includes(pack.spaceId);
  const agents=pack.agents.filter(a=>!principal.allowedAgents||principal.allowedAgents.includes(a.agentId));
  return {
    version:protocol.BASE_VERSION,platform:platform?'m0':null,extensions:platform?.extensions||[],
    spaces:visible?[{spaceId:pack.spaceId,...(schoolId?{schoolId}:{}),name:pack.name,description:pack.description,
      agents:structuredClone(agents),sceneContract:'hyper-dimension.geo-campus/v1',geometryHash,
      scenes:[{sceneId:UW_SCENE,name:'UW Seattle · 户外校园'}]}]:[],
    receptionMode:reception.live?'live-model':'knowledge-only',receptionProvider:reception.provider,
    generalConversation:reception.general,knowledge:knowledge?knowledge.mode+'-pgvector':'published-keyword',
  };
}
