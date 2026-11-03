// Use the same visible owner pixels as picking; never highlight a hidden building.
export function surfaceSelection(rgba,width,height,owners,selectedOwner,neighborSelected=()=>false){
  const data=new Uint8ClampedArray(rgba.length);let pixels=0;
  const selected=(x,y)=>{
    if(x<0||y<0||x>=width||y>=height)return neighborSelected(x,y);
    const i=(y*width+x)*4;return rgba[i+3]>0&&owners[rgba[i+2]]===selectedOwner;
  };
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;if(!selected(x,y))continue;
    // Tile borders are storage boundaries, not building contours.
    const edge=!selected(x-1,y)||!selected(x+1,y)||!selected(x,y-1)||!selected(x,y+1);
    data.set([255,220,122,edge?230:42],i);pixels++;
  }
  return {data,pixels};
}
