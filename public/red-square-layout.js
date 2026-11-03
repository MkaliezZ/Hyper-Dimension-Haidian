// Photo-calibrated art props; rendering and walking consume the same footprints.
// Existing GIS building geometry and the registered plaza boundary are unchanged.
export const RED_PLATFORM_CENTER=[-129.5,46.5];
export const RED_SEATING=[[-138,38],[-121,38],[-121,55],[-138,55]].map(([x,z])=>({x,z,collisionRadius:5.2,angle:Math.atan2(x-RED_PLATFORM_CENTER[0],RED_PLATFORM_CENTER[1]-z)}));
export const RED_TOWERS=[{x:-151,z:10,height:36.6},{x:-146,z:7,height:39.6},{x:-141,z:4,height:42.7}].map(p=>({...p,width:3.4,depth:1.8,collisionRadius:2}));
export const RED_OBELISK={x:-70,z:12,height:7.92,collisionRadius:3};
