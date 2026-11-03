// Shared navigation boundary. Presentation must not enlarge the trusted GIS extent.
export function explorationBounds(campus){const [x0,z0,x1,z1]=campus.bounds||campus.terrain.bounds;return [x0+2,z0+2,x1-2,z1-2];}
