// School-specific, source-reviewed massing. All dimensions are visual estimates.
// The resolved parts are shared by the baked mesh, minimap and walking collision.
const close=ring=>[...ring,ring[0]];
const rect=(u0,v0,u1,v1)=>[[u0,v0],[u1,v0],[u1,v1],[u0,v1]];
const roundFront=(u0=0,v0=0,u1=1,v1=1)=>{
  const points=[[u0,v0],[u1,v0],[u1,v0+(v1-v0)*.62]];
  for(let n=1;n<=16;n++){const t=n/16;points.push([u1-(u1-u0)*t,v0+(v1-v0)*(.62+.38*Math.sin(t*Math.PI))]);}
  return points;
};
const roundWest=()=>[[.40,0],[1,0],[1,1],[.40,1],...Array.from({length:16},(_,n)=>{const t=Math.PI/2+(n+1)/16*Math.PI;return [.4+.4*Math.cos(t),.5+.5*Math.sin(t)];})];
const capsule=radius=>Array.from({length:48},(_,n)=>{const a=n/48*Math.PI*2,c=Math.cos(a);return [.5+Math.sign(c)*(.5-radius)+radius*c,.5+.5*Math.sin(a)];});

export function resolveHaidianArchitecture(building,recipe){
  const original=building.rings[0].slice(0,-1),angle=recipe.axis??Math.atan2(original[1][1]-original[0][1],original[1][0]-original[0][0]),c=Math.cos(angle),s=Math.sin(angle);
  const uu=original.map(([x,z])=>x*c+z*s),vv=original.map(([x,z])=>-x*s+z*c),u0=Math.min(...uu),u1=Math.max(...uu),v0=Math.min(...vv),v1=Math.max(...vv),W=u1-u0,D=v1-v0;
  const world=([u,v])=>{const a=u0+u*W,b=v0+v*D;return [+(a*c-b*s).toFixed(5),+(a*s+b*c).toFixed(5)];};
  const parts=[];let seq=0;
  function add(outline,bottom,eave,material='brick',extra={}){
    const ring=extra.world?outline:outline.map(world);
    const part={id:building.id+'-'+(++seq),shape:'prism',rings:[close(ring)],bottom,eave,material,roof:'flat',rise:0,window:'regular',floors:recipe.floors||1,bay:recipe.bay||3.6,solid:bottom<1.2,...extra};delete part.world;parts.push(part);return part;
  }
  const box=(u0,v0,u1,v1,bottom,top,material,extra={})=>add(rect(u0,v0,u1,v1),bottom,top,material,extra);
  function column(u,v,bottom,top,radius=.3,material='red-column'){
    const [x,z]=world([u,v]);add(Array.from({length:8},(_,i)=>[x+Math.cos(i*Math.PI/4)*radius,z+Math.sin(i*Math.PI/4)*radius]),bottom,top,material,{world:true,window:'none',role:'column'});
  }
  const main=(outline=original,extra={})=>add(outline,0,recipe.height,recipe.material||'brick',{world:outline===original,window:recipe.window||'regular',floors:recipe.floors,...extra});
  function parapet(outline=original,height=recipe.height,extra={}){add(outline,height-.16,height+.42,'brick',{world:outline===original,window:'none',roofMaterial:'flat-roof',role:'parapet',...extra});}
  function entrance(u=.5,v=1,width=.20,height=3.4,depth=.085){
    box(u-width/2,v-.03,u+width/2,v+depth,0,height,'glass',{window:'curtain',bay:1.5,floors:1,role:'entrance'});
    box(u-width/2-.012,v-.04,u+width/2+.012,v+depth+.012,height,height+.22,'stone',{window:'none',solid:false,role:'canopy'});
  }
  const kind=recipe.kind;
  if(kind==='chinese-courtyard'){
    // A pavilion, two galleries and an open paved court, rather than an enclosure.
    const floor=.42;
    box(0,0,1,1,0,floor,'stone',{window:'none',solid:false,role:'platform'});
    function hall(a,b,c,d,eave,rise,bays){
      const postV=[b+.05,d-.05];
      for(let i=0;i<=bays;i++)for(const v of postV)column(a+.035+(c-a-.07)*i/bays,v,floor,eave,.23);
      for(const v of postV){box(a,v-.016,c,v+.016,eave-.33,eave+.1,'painted-beam',{window:'none',solid:false,role:'beam'});box(a,v-.018,c,v+.018,eave-.38,eave-.31,'gold',{window:'none',solid:false});}
      for(const u of [a+.035,c-.035])box(u-.01,b,u+.01,d,eave-.27,eave+.1,'painted-beam',{window:'none',solid:false,role:'beam'});
      // Roof dimensions include eaves and turn upward at the four hips.
      add(rect(a-.025,b-.04,c+.025,d+.04),eave-.08,eave,'chinese-tile',{shape:'chinese-roof',rise,window:'none',solid:false,role:'upturned-roof'});
      for(let i=0;i<=bays;i++)for(const v of postV){const u=a+.035+(c-a-.07)*i/bays;box(u-.022,v-.025,u+.022,v+.025,eave-.14,eave+.2,'painted-beam',{window:'none',solid:false,role:'bracket'});}
    }
    hall(.23,.05,.77,.51,3.8,2.1,4);
    hall(.025,.42,.20,.97,2.9,1.15,3);
    hall(.80,.42,.975,.97,2.9,1.15,3);
    // Painted gallery rails and white backing, with clear central entrances.
    for(const [a,c]of [[.025,.20],[.80,.975]]){
      box(a,.45,a+.012,.97,floor,floor+.82,'red-column',{window:'none',role:'rail'});
      box(c-.012,.45,c,.97,floor,floor+.82,'painted-beam',{window:'lattice',role:'rail'});
    }
    box(.30,.495,.70,.51,3.30,3.65,'plaque',{window:'none',solid:false,role:'plaque'});
    for(let n=0;n<3;n++)box(.34,.97+n*.025,.66,1.075-n*.018,0,.14*(3-n),'stone',{window:'none',solid:false,role:'step'});
  }else if(kind==='air-dome'){
    main(capsule(Math.min(D*.42,W*.24)/W),{world:false,shape:'air-dome',eave:.45,rise:recipe.height-.45,material:'membrane',window:'none',role:'inflated-shell'});
    entrance(.45,1,.16,2.6,.055);
  }else if(kind==='round-library'){
    const ring=roundWest();main(ring,{world:false,window:'ribbon',role:'rounded-library'});parapet(ring,recipe.height,{world:false,material:'brick'});
    box(.75,.82,.98,1.03,0,3.2,'glass',{window:'curtain',floors:1,bay:1.8,role:'entrance'});
  }else if(kind==='curved-stone'){
    const ring=roundFront();main(ring,{world:false,material:'stone',window:'ribbon',role:'curved-facade'});
    add(roundFront(-.035,-.025,1.035,1.05),recipe.height-.05-Math.abs(recipe.roofSlope?.[0]||.4)/2,recipe.height+.32,'stone',{window:'none',slope:recipe.roofSlope||[.4,0],solid:false,role:'overhanging-slab'});
    add(roundFront(.37,.67,.80,1.06),0,recipe.height-.6,'glass',{window:'curtain',bay:2.6,role:'curved-glass-bay'});
    box(.31,.91,.85,1.11,3.5,3.7,'stone',{window:'none',solid:false,role:'entrance-canopy'});
  }else if(kind==='south-dining'){
    main(original,{eave:recipe.height-3.1,roof:'mansard',rise:3.1,roofWindows:true,roofMaterial:'slate',role:'pitched-dining'});
    box(.37,.10,.63,1.01,0,recipe.height-2.5,'glass',{window:'curtain',bay:2.2,floors:2,role:'glass-atrium'});
    entrance(.5,1,.42,3.6,.16);
  }else if(kind==='sports-hall'||kind==='pool-hall'||kind==='training-hall'){
    const rise=recipe.roofRise||1.15;
    main(original,{eave:recipe.height-rise,roof:kind==='training-hall'?'gable':'mansard',rise,roofWindows:kind!=='training-hall',roofMaterial:recipe.roofMaterial||'slate',window:kind==='training-hall'?'clerestory':'ribbon',role:'clear-span-hall'});
    entrance(.5,1,.22,3.3,.07);
  }else{
    main();parapet();
    if(kind==='louver-dorm'){
      for(const u of [.15,.50,.85])box(u-.035,.89,u+.035,1.035,0,recipe.height-.25,'metal',{window:'louver',role:'stair-tower'});
      entrance(.5,1,.13,3.4,.075);
      box(.06,.94,.94,1.025,3.3,3.68,'brick',{window:'none',solid:false,role:'entrance-band'});
    }else if(kind==='portico-dorm'){
      box(.43,.96,.57,1.105,3.4,3.86,'stone',{window:'none',solid:false,role:'portico-slab'});
      box(.43,.96,.57,1.105,6.7,7.02,'stone',{window:'none',solid:false,role:'balcony'});
      for(const u of [.435,.478,.522,.565])column(u,1.07,0,3.45,.40,'stone');
      entrance(.5,1,.085,3.3,.03);
      box(.43,1.09,.57,1.105,7.02,7.62,'metal',{window:'lattice',solid:false,role:'balcony-rail'});
    }else if(kind==='north-dorm'){
      for(const u of [.16,.39,.62,.85]){entrance(u,1,.09,2.8,.05);}
      // The exterior stair visible at the east end in the official N1-east scene.
      for(let n=0;n<12;n++)box(.96,.63+n*.018,1.04,.65+n*.018,0,.23*(n+1),'stone',{window:'none',solid:false,role:'exterior-stair'});
    }else if(kind==='north-dining'){
      box(.25,.70,.75,1.025,0,recipe.height-.2,'glass',{window:'curtain',bay:2.4,role:'glazed-stair'});entrance(.5,1,.35,3.4,.07);
    }else if(kind==='main-complex'){
      box(.28,.86,.72,1.035,0,recipe.height-.5,'glass',{window:'curtain',bay:2.8,role:'main-glazing'});
      box(.22,.91,.78,1.12,3.5,3.82,'stone',{window:'none',solid:false,role:'portico-slab'});
      for(const u of [.25,.75])column(u,1.08,0,3.5,.38,'stone');
      box(.20,.94,.80,1.04,recipe.height-.4,recipe.height-.05,'stone',{window:'none',roof:'gable',roofAxis:'v',rise:1.1,roofMaterial:'flat-roof',solid:false,role:'pediment'});
    }else if(kind==='international-low'){
      entrance(.49,1,.18,3.4,.07);box(.025,.025,.16,.97,recipe.height-.5,recipe.height+1.3,'brick',{window:'clerestory',solid:false,role:'auditorium-end'});
    }else if(kind==='teaching-wing'||kind==='laboratory-wing'){
      if(building.id==='primary-teaching'){
        box(.91,.18,.99,.94,0,recipe.height-.2,'glass',{window:'curtain',bay:2.2,role:'stair-glazing'});entrance(.5,.605,.19,3.5,.065);
      }else{
        if(building.id!=='art-building')box(.015,.05,.08,.96,0,recipe.height-.2,'glass',{window:'curtain',bay:2.2,role:'stair-glazing'});
        entrance(.5,1,.19,3.5,.065);
      }
      if(recipe.connectorEnd)box(.91,.15,1.08,.85,0,recipe.height-2,'glass',{window:'curtain',bay:2.2,role:'connecting-wing'});
    }else if(kind!=='unverified-annex'){
      entrance(.5,1,.15,3.2,.06);
    }
  }
  const collisionParts=parts.filter(p=>p.solid).flatMap(p=>p.rings.map(r=>[r]));
  const walkSurfaces=kind==='chinese-courtyard'?parts.filter(p=>['platform','step'].includes(p.role)).map(p=>({rings:p.rings,height:p.eave})):[];
  return {version:'haidian-photo-massing-1',kind,frame:{angle,width:W,depth:D},parts,collisionParts,walkSurfaces,review:recipe.review,confidence:recipe.confidence};
}
