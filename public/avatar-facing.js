// Facing follows projected screen motion, independently of the GIS world axes.
export const AVATAR_DIRECTIONS=Object.freeze(['east','southeast','south','southwest','west','northwest','north','northeast']);
export function facingFromScreen(vector,previous='south'){
  if(!vector||!vector.every(Number.isFinite)||Math.hypot(...vector)<1e-5)return previous;
  const angle=Math.atan2(vector[1],vector[0]),step=Math.PI/4;
  const prior=AVATAR_DIRECTIONS.indexOf(previous);
  if(prior>=0){const delta=Math.atan2(Math.sin(angle-prior*step),Math.cos(angle-prior*step));if(Math.abs(delta)<=step/2+.045)return previous;}
  return AVATAR_DIRECTIONS[(Math.round(angle/step)+8)%8];
}
