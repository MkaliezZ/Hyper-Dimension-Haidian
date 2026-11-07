import {LANDSCAPE_SOURCE} from './campus-landscape-data.js';
export const FOUNTAIN_GARDEN={walkOuterRadius:0,bedInnerRadius:0,bedOuterRadius:0,axisAngle:0,gateHalfAngle:0};
export const pathDistance=(x,z,paths)=>({distance:0,angle:0});
export function campusLandscape(campus){
 if(campus.geometryHash!==LANDSCAPE_SOURCE.geometryHash)throw Error('Landscape belongs to another school geometry');
 return {trees:LANDSCAPE_SOURCE.trees,benches:[],rejected:[],sources:LANDSCAPE_SOURCE.sources,metrics:{sourceTrees:LANDSCAPE_SOURCE.trees.length,sourceBenches:0,displayedTrees:LANDSCAPE_SOURCE.trees.length,displayedBenches:0,rejected:0,randomlyPlacedTrees:0,positions:'deliberate-schematic-planting; not surveyed',canopiesAndBenchOrientations:'inferred'}};
}
