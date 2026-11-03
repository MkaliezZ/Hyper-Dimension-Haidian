// Cache planning stays independent of Canvas so containment, invalidation and subpixel motion are testable.
export function createViewportCache({margin=160,inset=24}={}){
  let box=null,revision=0;
  return {invalidate(){revision++;},plan({width,height,centerX,centerY,key}){
    const left=centerX-width/2,top=centerY-height/2,token=key+':'+revision;
    const rebuild=!box||box.key!==token||box.viewWidth!==width||box.viewHeight!==height||left<box.left+inset||top<box.top+inset||left+width>box.left+box.width-inset||top+height>box.top+box.height-inset;
    if(rebuild)box={key:token,viewWidth:width,viewHeight:height,left:Math.floor(left)-margin,top:Math.floor(top)-margin,width:Math.ceil(width)+margin*2,height:Math.ceil(height)+margin*2};
    return {...box,rebuild,dx:box.left-left,dy:box.top-top};
  },dispose(){box=null;}};
}
