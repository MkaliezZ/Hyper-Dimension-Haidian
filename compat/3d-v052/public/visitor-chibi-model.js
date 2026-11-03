// Original campus characters: rounded three-head proportions, friendly eyes and soft clothing.
// This is procedural school artwork, not an imported character/model from a commercial game.
// Metres, Y up, +Z forward. The same 38 recipe parts and rigid action joints are retained.
export function buildChibiVisitor(T,r,skins){
  const root=new T.Group(),materials=new Map(),joints={};
  root.name='UWCampusVisitor';root.userData.recipe=structuredClone(r);root.userData.style='rounded-campus';
  root.scale.set(r.parts.body==='body-slim'?.94:r.parts.body==='body-athletic'?1.07:1,{short:.93,standard:1,tall:1.06}[r.height],1);
  const material=color=>{if(!materials.has(color))materials.set(color,new T.MeshStandardMaterial({color,roughness:.88,metalness:0}));return materials.get(color);};
  const mesh=(parent,geometry,position,scale,color,name)=>{const m=new T.Mesh(geometry,material(color));m.position.set(...position);m.scale.set(...scale);if(name)m.name=name;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  const ball=(p,x,y,z,sx,sy,sz,color,name)=>mesh(p,new T.SphereGeometry(1,20,14),[x,y,z],[sx,sy,sz],color,name);
  const capsule=(p,x,y,z,rad,len,color,name)=>mesh(p,new T.CapsuleGeometry(rad,len,5,12),[x,y,z],[1,1,1],color,name);
  const box=(p,x,y,z,w,h,d,color,radius=.025,name)=>{
    const shape=new T.Shape(),q=Math.min(radius,w/2,h/2),left=-w/2,right=w/2,bottom=-h/2,top=h/2;
    shape.moveTo(left+q,bottom);shape.lineTo(right-q,bottom);shape.quadraticCurveTo(right,bottom,right,bottom+q);shape.lineTo(right,top-q);shape.quadraticCurveTo(right,top,right-q,top);shape.lineTo(left+q,top);shape.quadraticCurveTo(left,top,left,top-q);shape.lineTo(left,bottom+q);shape.quadraticCurveTo(left,bottom,left+q,bottom);
    const g=new T.ExtrudeGeometry(shape,{depth:d,bevelEnabled:true,bevelThickness:Math.min(q/2,d/3),bevelSize:q/3,bevelSegments:2,steps:1,curveSegments:3});g.translate(0,0,-d/2);g.computeVertexNormals();return mesh(p,g,[x,y,z],[1,1,1],color,name);
  };
  const curve=(parent,points,radius,color,name)=>mesh(parent,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),14,radius,6,false),[0,0,0],[1,1,1],color,name);
  const ring=(p,x,y,z,rad,tube,color)=>mesh(p,new T.TorusGeometry(rad,tube,5,24),[x,y,z],[1,1,1],color);
  const joint=(name,parent,x,y,z)=>{const g=new T.Group();g.name=name;g.position.set(x,y,z);parent.add(g);joints[name]=g;return g;};
  const skin=skins[r.skin],hair=r.colors.hair,top=r.colors.top,bottom=r.colors.bottom,shoes=r.colors.shoes,cream='#f8f1e5',ink='#34312f';
  const skinShade='#'+new T.Color(skin).multiplyScalar(.91).getHexString();
  const hips=joint('hips',root,0,.59,0),chest=joint('chest',hips,0,.26,0),head=joint('head',chest,0,.50,0);
  ball(hips,0,.005,0,.18,.105,.12,bottom);
  const profile=[[.17,-.215],[.21,-.17],[.228,-.06],[.222,.11],[.195,.18],[.105,.22]].map(p=>new T.Vector2(...p));
  const torso=mesh(chest,new T.LatheGeometry(profile,20),[0,0,0],[1,1,.68],top,r.parts.top);
  capsule(chest,0,.24,0,.065,.025,skin,'neck');
  const faceGeometry=new T.SphereGeometry(1,28,20),positions=faceGeometry.attributes.position;
  // A gently squared round head has cheeks and a soft jaw rather than a faceted gemstone.
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),jaw=y<-.35?1+(y+.35)*.12:1;
    positions.setXYZ(i,Math.sign(x)*Math.abs(x)**.91*jaw,y,Math.sign(z)*Math.abs(z)**.94);
  }
  faceGeometry.computeVertexNormals();const face=mesh(head,faceGeometry,[0,0,0],[.315,.33,.279],skin,'face');
  for(const s of [-1,1]){ball(head,s*.305,-.025,-.012,.061,.083,.049,skin,'ear-'+s);ball(head,s*.347,-.025,.009,.018,.041,.026,skinShade);}
  // Curved face decals follow the same modified head surface; nothing floats in front of it.
  const faceZ=(x,y,offset=0)=>{
    const yy=y/.33,jaw=yy<-.35?1+(yy+.35)*.12:1;
    const xx=Math.abs(x/(.315*jaw))**(1/.91),zz=Math.sqrt(Math.max(.001,1-xx*xx-yy*yy));return .279*zz**.94+offset;
  };
  function patch(x,y,rx,ry,color,offset=.004,name){
    const vertices=[],count=24;
    for(let i=0;i<count;i++){const a=i/count*Math.PI*2,b=(i+1)/count*Math.PI*2;
      for(const [u,v] of [[x,y],[x+Math.cos(a)*rx,y+Math.sin(a)*ry],[x+Math.cos(b)*rx,y+Math.sin(b)*ry]])vertices.push(u,v,faceZ(u,v,offset));
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.computeVertexNormals();const m=mesh(head,g,[0,0,0],[1,1,1],color,name);m.castShadow=false;return m;
  }
  for(const s of [-1,1]){
    patch(s*.112,.012,.058,.082,'#fffaf1',.005,'eye-white-'+s);
    patch(s*.105,.009,.030,.062,'#443833',.009,'eye-pupil-'+s);
    patch(s*.096,.034,.009,.013,'#ffffff',.012,'eye-spark-'+s);
    patch(s*.118,-.019,.0045,.006,'#d5b39c',.013);
    patch(s*.208,-.092,.040,.018,'#'+new T.Color(skin).lerp(new T.Color('#db9c88'),.45).getHexString(),.005,'cheek-'+s);
    curve(head,[[s*.065,.132,faceZ(s*.065,.132,.006)],[s*.11,.145,faceZ(s*.11,.145,.006)],[s*.15,.134,faceZ(s*.15,.134,.006)]],.009,hair);
  }
  ball(head,0,-.052,.284,.028,.023,.026,skinShade,'button-nose');
  const smile=[];for(let i=0;i<=10;i++){const x=-.051+i*.0102,y=-.136-.017*(1-(x/.051)**2);smile.push([x,y,faceZ(x,y,.007)]);}curve(head,smile,.005,'#946152','smile');

  // One coherent hair cap, with a controlled fringe and distinct side/back silhouettes.
  const hairId=r.parts.hair,hairPositions=[],hairIndices=[],columns=32,rows=12;
  for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){
    const a=i/columns*Math.PI*2,front=Math.max(0,Math.cos(a)),sweep=hairId==='hair-sidepart'?.13*Math.sin(a-.3)*front:0;
    const line=1.15+.64*(1-front*front)+sweep,theta=j/rows*line;
    hairPositions.push(Math.sin(theta)*Math.sin(a)*.333,Math.cos(theta)*.35+.018,Math.sin(theta)*Math.cos(a)*.295-.013);
    if(i&&j){const n=j*(columns+1)+i;hairIndices.push(n-columns-2,n-1,n-columns-1,n-columns-1,n-1,n);}
  }
  const cap=new T.BufferGeometry();cap.setAttribute('position',new T.Float32BufferAttribute(hairPositions,3));cap.setIndex(hairIndices);cap.computeVertexNormals();mesh(head,cap,[0,0,0],[1,1,1],hair,'hair-cap');
  function lock(points,widths,color=hair){
    const c=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),verts=[],indices=[],steps=12,sides=8,frames=c.computeFrenetFrames(steps,false);
    for(let j=0;j<=steps;j++){
      const t=j/steps,p=c.getPoint(t),k=t*(widths.length-1),a=Math.min(widths.length-2,Math.floor(k)),w=widths[a]+(widths[a+1]-widths[a])*(k-a);
      for(let i=0;i<=sides;i++){const angle=i/sides*Math.PI*2,v=p.clone().addScaledVector(frames.normals[j],Math.cos(angle)*w).addScaledVector(frames.binormals[j],Math.sin(angle)*w*.55);verts.push(...v.toArray());if(i&&j){const n=j*(sides+1)+i;indices.push(n-sides-2,n-1,n-sides-1,n-sides-1,n-1,n);}}
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setIndex(indices);g.computeVertexNormals();return mesh(head,g,[0,0,0],[1,1,1],color);
  }
  if(hairId==='hair-sidepart'){
    lock([[-.23,.20,.17],[-.09,.29,.24],[.08,.22,.276],[.19,.10,.24]],[.055,.075,.008]);
    lock([[-.28,.16,.14],[-.17,.22,.25],[.005,.17,.29]],[.045,.067,.008]);
  }else{
    for(let i=0;i<5;i++){const x=(i-2)*.09;lock([[x*.85,.28,.16],[x,.22,.26],[x+.012,.125+(i%2)*.018,.284]],[.048,.054,.006]);}
  }
  if(['hair-bob','hair-long','hair-ponytail','hair-braids','hair-bun'].includes(hairId)){
    for(const s of [-1,1])ball(head,s*.285,hairId==='hair-long'?-.18:-.075,-.03,.069,hairId==='hair-long'?.30:.20,.18,hair);
    ball(head,0,hairId==='hair-long'?-.22:-.04,-.226,.275,hairId==='hair-long'?.30:.19,.098,hair);
  }
  if(hairId==='hair-ponytail'){
    lock([[0,.13,-.268],[.025,.10,-.398],[.05,-.17,-.42],[.028,-.38,-.32]],[.075,.12,.018]);
    const tie=ring(head,0,.12,-.295,.076,.018,'#d6bc89');tie.rotation.x=.32;
  }
  if(hairId==='hair-bun'){ball(head,0,.345,-.13,.126,.117,.12,hair);const tie=ring(head,0,.287,-.13,.107,.013,'#cdb386');tie.rotation.x=Math.PI/2;}
  if(hairId==='hair-braids')for(const s of [-1,1])for(let i=0;i<5;i++)ball(head,s*(.30+i*.012),-.12-i*.065,-.07,.052,.052,.055,hair);
  if(hairId==='hair-curly')for(let i=0;i<10;i++){const a=i/10*Math.PI*2;ball(head,Math.sin(a)*.255,.20+Math.cos(i*1.8)*.035,Math.cos(a)*.21-.014,.108,.09,.10,hair);}

  // Rounded sleeves, mitten hands and short legs. Joint overlaps remain closed during walking.
  for(const [side,s] of [['left',-1],['right',1]]){
    const arm=joint(side+'Arm',chest,s*.235,.12,0);arm.rotation.z=s*.15;
    const short=['top-tee','top-polo','top-vest'].includes(r.parts.top),sleeve=r.parts.top==='top-vest'?cream:top;
    capsule(arm,0,-.075,0,.084,.10,sleeve);
    const fore=joint(side+'Forearm',arm,0,-.185,0);
    ball(fore,0,0,0,.072,.07,.07,short?skin:top);
    capsule(fore,0,-.064,0,.064,.085,short?skin:top);
    ball(fore,0,-.152,.012,.073,.079,.06,skin,'mitten-'+side);
    ball(fore,-s*.055,-.133,.048,.027,.041,.031,skin);
    const leg=joint(side+'Leg',hips,s*.104,-.02,0),knee=joint(side+'Knee',leg,0,-.22,0);
    const shorts=r.parts.bottom==='bottom-shorts',wide=r.parts.bottom==='bottom-culottes';
    capsule(leg,0,-.10,0,wide?.108:.086,.13,bottom);
    ball(knee,0,.005,0,wide?.09:shorts?.061:.073,.075,wide?.085:shorts?.06:.068,shorts?skin:bottom);
    capsule(knee,0,-.12,0,wide?.09:shorts?.059:.069,.13,shorts?skin:bottom);
    const foot=joint(side+'Foot',knee,0,-.29,.03);
    ball(foot,0,.035,.042,.092,.070,.15,shoes,'shoe-'+side);
    box(foot,0,-.039,.044,.185,.038,.285,cream,.016);
    if(['shoes-boots','shoes-high'].includes(r.parts.shoes))capsule(foot,0,.12,-.025,.084,r.parts.shoes==='shoes-boots'?.105:.025,shoes);
    if(r.parts.shoes==='shoes-loafers')box(foot,0,.093,.06,.166,.022,.055,ink,.009);
    else for(let i=0;i<3;i++)box(foot,0,.098,.02+i*.03,.11,.009,.013,cream,.004);
    if(r.parts.bottom==='bottom-cargo')box(leg,s*.082,-.12,.04,.043,.10,.098,bottom,.015);
    if(r.parts.bottom==='bottom-jeans')curve(leg,[[s*.078,-.005,.016],[s*.085,-.13,.02],[s*.074,-.215,.018]],.004,'#98a6b0');
  }
  if(r.parts.bottom==='bottom-skirt')mesh(hips,new T.CylinderGeometry(.18,.265,.32,24,1,true),[0,-.095,0],[1,1,.78],bottom,'skirt');
  if(['top-varsity','top-cardigan','top-vest','top-polo'].includes(r.parts.top)){
    box(chest,0,.02,.148,.037,.31,.014,cream,.009);
    for(const s of [-1,1]){const collar=box(chest,s*.068,.195,.109,.084,.048,.025,cream,.012);collar.rotation.z=s*.32;}
    for(let i=0;i<4;i++)ball(chest,.023,.13-i*.069,.16,.008,.008,.006,ink);
    if(r.parts.top==='top-varsity')for(const s of [-1,1]){box(chest,s*.126,-.07,.128,.066,.016,.015,cream,.005);const cuff=ring(chest,s*.22,.09,.003,.072,.009,cream);cuff.rotation.z=Math.PI/2;}
  }
  if(r.parts.top==='top-hoodie'){
    const hood=ring(chest,0,.215,-.019,.116,.040,top);hood.rotation.x=Math.PI/2;
    box(chest,0,-.095,.151,.205,.075,.025,top,.028);
    for(const s of [-1,1])curve(chest,[[s*.04,.16,.153],[s*.04,.115,.164],[s*.048,.055,.167]],.006,cream);
  }
  if(r.parts.glasses!=='glasses-none'){
    const glasses='#6a594a';
    for(const s of [-1,1]){
      let points;
      if(r.parts.glasses==='glasses-square'){
        points=[[-.085,-.09],[-.085,.09],[.085,.09],[.085,-.09],[-.085,-.09]].map(([x,y])=>[s*.112+x,y+.012]);
      }else points=Array.from({length:33},(_,i)=>{const a=i/32*Math.PI*2;return [s*.112+Math.cos(a)*.094,.012+Math.sin(a)*(r.parts.glasses==='glasses-oval'?.084:.094)];});
      curve(head,points.map(([x,y])=>[x,y,faceZ(x,y,.023)]),.0075,glasses);
      curve(head,[[s*.203,.029,faceZ(s*.203,.029,.023)],[s*.29,.04,.14],[s*.32,.02,.00]],.007,glasses);
    }
    curve(head,[[-.038,.029,.299],[0,.041,.31],[.038,.029,.299]],.007,glasses);
  }
  const accessory=r.parts.accessory;
  if(accessory==='accessory-satchel'){
    const strap=box(chest,0,.003,.171,.030,.44,.014,'#8b6e50',.007);strap.rotation.z=-.57;
    box(hips,.237,.015,.079,.19,.19,.102,'#c9a378',.035);box(hips,.237,.062,.139,.19,.07,.021,'#e1be8e',.020);ball(hips,.237,.025,.156,.015,.016,.006,'#92784e');
  }
  if(accessory==='accessory-backpack'){
    box(chest,0,-.015,-.205,.285,.31,.14,'#c3a57d',.065);box(chest,0,-.08,-.29,.205,.105,.031,'#e0c49c',.027);
    for(const s of [-1,1])curve(chest,[[s*.14,-.15,.09],[s*.16,.04,.16],[s*.14,.19,.02],[s*.13,.15,-.18]],.013,'#b7956b');
  }
  if(accessory==='accessory-scarf'){const scarf=ring(chest,0,.25,0,.087,.033,'#c9a26b');scarf.rotation.x=Math.PI/2;const end=box(chest,.07,.10,.165,.078,.24,.031,'#c9a26b',.02);end.rotation.z=.14;}
  if(accessory==='accessory-cap'){
    mesh(head,new T.SphereGeometry(1,24,12,0,Math.PI*2,0,Math.PI*.49),[0,.035,-.015],[.348,.35,.315],top,'soft-cap');
    ball(head,0,.113,.282,.30,.029,.18,top);
  }
  if(accessory==='accessory-headphones'){
    mesh(head,new T.TorusGeometry(.353,.022,6,32,Math.PI),[0,.05,-.014],[1,1,1],ink,'headphone-band');
    for(const s of [-1,1]){ball(head,s*.35,.023,-.006,.042,.088,.065,ink);ball(head,s*.375,.023,.0,.014,.058,.042,'#c3a57d');}
  }
  if(accessory==='accessory-bow'){
    for(const s of [-1,1]){const bow=ball(head,.25+s*.048,.16,.17,.062,.035,.029,'#bb7f8a');bow.rotation.z=s*.35;}ball(head,.25,.16,.19,.021,.027,.021,'#985e70');
  }
  root.userData.animate=(time,action='idle')=>{
    const stride=action==='walk'?Math.sin(time*6.2):0;
    hips.position.y=.59+(action==='walk'?Math.abs(stride)*.022:Math.sin(time*1.7)*.004);
    chest.rotation.z=action==='walk'?Math.sin(time*6.2)*.025:Math.sin(time*1.3)*.009;
    head.rotation.z=-chest.rotation.z*.55;
    for(const [side,s] of [['left',-1],['right',1]]){joints[side+'Arm'].rotation.x=-stride*.43*s;joints[side+'Leg'].rotation.x=stride*.45*s;joints[side+'Knee'].rotation.x=Math.max(0,-stride*s)*.42;}
    joints.rightArm.rotation.z=action==='wave'?2.4:.15;
    joints.rightForearm.rotation.z=action==='wave'?.24+Math.sin(time*7)*.24:0;
  };
  root.userData.dispose=()=>{root.traverse(o=>o.geometry?.dispose());materials.forEach(m=>m.dispose());};
  return root;
}
