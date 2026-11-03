// UW school artwork. Metres, Y up, +Z forward. No external images, scripts or paid assets.
// Rigid articulated parts intentionally keep the Base's simple mix-and-match product boundary.
export function buildVisitorModel(T,r,skins){
  const root=new T.Group(),joints={},materials=new Map();
  root.name='UWVisitor';root.userData.recipe=structuredClone(r);
  root.scale.set(r.parts.body==='body-slim'?.91:r.parts.body==='body-athletic'?1.1:1,{short:.9,standard:1,tall:1.08}[r.height],1);
  const mat=c=>{if(!materials.has(c))materials.set(c,new T.MeshStandardMaterial({color:c,roughness:.76}));return materials.get(c);};
  const mesh=(parent,geo,x,y,z,sx,sy,sz,color)=>{const m=new T.Mesh(geo,mat(color));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  const ball=(p,x,y,z,sx,sy,sz,c)=>mesh(p,new T.SphereGeometry(1,16,12),x,y,z,sx,sy,sz,c);
  const box=(p,x,y,z,sx,sy,sz,c)=>mesh(p,new T.BoxGeometry(1,1,1),x,y,z,sx,sy,sz,c);
  const capsule=(p,x,y,z,rad,len,c)=>mesh(p,new T.CapsuleGeometry(rad,len,4,12),x,y,z,1,1,1,c);
  const ring=(p,x,y,z,rad,tube,c)=>mesh(p,new T.TorusGeometry(rad,tube,6,24),x,y,z,1,1,1,c);
  const joint=(name,parent,x,y,z)=>{const g=new T.Group();g.name=name;g.position.set(x,y,z);parent.add(g);joints[name]=g;return g;};
  const skin=skins[r.skin],hair=r.colors.hair,top=r.colors.top,bottom=r.colors.bottom,shoe=r.colors.shoes,cream='#f1e9dd',ink='#272637';
  const hips=joint('hips',root,0,.85,0),body=joint('chest',hips,0,.24,0),head=joint('head',body,0,.47,0);
  ball(hips,0,-.015,0,.166,.105,.103,bottom);
  // Shaped torso, shoulders and neckline, rather than a single capsule.
  const profile=[[.15,-.18],[.165,-.14],[.15,-.02],[.19,.15],[.185,.2],[.105,.25]].map(([x,y])=>new T.Vector2(x,y));
  const torso=mesh(body,new T.LatheGeometry(profile,20),0,0,0,1,1,.66,top);torso.name=r.parts.top;
  capsule(body,0,.27,0,.056,.07,skin);
  ball(head,0,0,0,.145,.184,.135,skin);
  for(const sign of [-1,1]){
    ball(head,sign*.141,-.015,0,.024,.044,.027,skin);
    ball(head,sign*.052,.005,.124,.017,.021,.008,ink);
    ball(head,sign*.048,.011,.132,.004,.005,.003,'#ffffff');
    const brow=box(head,sign*.052,.05,.123,.046,.009,.01,hair);brow.rotation.z=-sign*.11;
  }
  ball(head,0,-.027,.135,.017,.024,.025,skin);
  const smile=new T.EllipseCurve(0,0,.037,.02,Math.PI*1.1,Math.PI*1.9,false,0).getPoints(14);
  const smileGeo=new T.BufferGeometry().setFromPoints(smile.map(p=>new T.Vector3(p.x,p.y-.065,.126)));
  head.add(new T.Line(smileGeo,new T.LineBasicMaterial({color:'#935e55'})));
  // Hair uses a hemisphere cap and separate silhouette pieces; face stays visible.
  mesh(head,new T.SphereGeometry(1,20,12,0,Math.PI*2,0,Math.PI*.53),0,.028,-.015,.156,.184,.145,hair);
  const h=r.parts.hair;
  if(['hair-short','hair-sidepart'].includes(h))for(let i=0;i<4;i++){const lock=ball(head,-.09+i*.052,.124,.087,.058,.045,.067,hair);lock.rotation.z=h==='hair-sidepart'?-.35:.15;}
  if(['hair-bob','hair-long','hair-ponytail','hair-braids','hair-bun'].includes(h)){
    for(const s of [-1,1])ball(head,s*.126,h==='hair-long'?-.13:-.04,-.045,.045,h==='hair-long'?.29:.16,.108,hair);
    ball(head,0,h==='hair-long'?-.1:-.01,-.105,.142,h==='hair-long'?.27:.15,.055,hair);
  }
  if(h==='hair-ponytail'){ball(head,0,.10,-.19,.066,.08,.06,cream);const tail=ball(head,0,-.04,-.22,.075,.22,.07,hair);tail.rotation.x=-.3;}
  if(h==='hair-bun')ball(head,0,.217,-.075,.089,.087,.083,hair);
  if(h==='hair-braids')for(const s of [-1,1])for(let i=0;i<5;i++)ball(head,s*(.16+i*.007),-.09-i*.055,-.06,.034,.04,.035,hair);
  if(h==='hair-curly')for(let i=0;i<13;i++){const a=i/13*Math.PI*2;ball(head,Math.cos(a)*.125,.12+Math.sin(i*2)*.025,Math.sin(a)*.102-.015,.071,.068,.062,hair);}
  // Sleeves, articulated elbows, trousers, separate knees and detailed soles.
  for(const [side,s] of [['left',-1],['right',1]]){
    const arm=joint(side+'Arm',body,s*.205,.15,0);arm.rotation.z=s*.08;
    const short=['top-tee','top-polo','top-vest'].includes(r.parts.top);
    capsule(arm,0,-.09,0,.061,.10,r.parts.top==='top-vest'?cream:top);
    const fore=joint(side+'Forearm',arm,0,-.21,0);
    ball(fore,0,.008,0,short?.043:.052,.055,short?.043:.052,short?skin:top);
    capsule(fore,0,-.075,0,short?.043:.052,.13,short?skin:top);
    ball(fore,0,-.19,.009,.045,.063,.034,skin);
    const leg=joint(side+'Leg',hips,s*.089,-.04,0),knee=joint(side+'Knee',leg,0,-.37,0);
    const shorts=r.parts.bottom==='bottom-shorts',wide=r.parts.bottom==='bottom-culottes';
    ball(knee,0,.01,0,wide?.087:shorts?.044:.058,.066,wide?.08:shorts?.044:.055,shorts?skin:bottom);
    capsule(leg,0,-.14,0,wide?.094:.071,.23,bottom);
    capsule(knee,0,-.125,0,wide?.09:shorts?.043:.057,.23,shorts?skin:bottom);
    const foot=joint(side+'Foot',knee,0,-.34,.035);
    ball(foot,0,.015,.035,.068,.055,.122,shoe);
    box(foot,0,-.02,.035,.132,.028,.221,cream);
    if(r.parts.shoes==='shoes-boots'||r.parts.shoes==='shoes-high')capsule(foot,0,.083,-.012,.064,r.parts.shoes==='shoes-boots'?.12:.04,shoe);
    if(r.parts.shoes!=='shoes-loafers')for(let i=0;i<3;i++)box(foot,0,.057,.02+i*.025,.073,.008,.008,cream);
    else box(foot,0,.06,.03,.13,.014,.028,ink);
    if(r.parts.bottom==='bottom-cargo')box(leg,s*.059,-.18,.032,.044,.105,.084,bottom);
    if(r.parts.bottom==='bottom-jeans')box(leg,s*.065,-.16,.015,.005,.28,.009,'#aeb7bb');
  }
  if(r.parts.bottom==='bottom-skirt'){
    mesh(hips,new T.CylinderGeometry(.17,.24,.36,20,1,true),0,-.13,0,1,1,.7,bottom);
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2;const pleat=box(hips,Math.sin(a)*.205,-.15,Math.cos(a)*.143,.012,.29,.012,bottom);pleat.rotation.z=-Math.sin(a)*.14;}
  }
  if(['top-varsity','top-cardigan','top-vest','top-polo'].includes(r.parts.top)){
    box(body,0,.05,.126,.045,.28,.018,cream);
    for(const s of [-1,1]){const collar=box(body,s*.056,.215,.099,.065,.042,.018,cream);collar.rotation.z=s*.4;}
    for(let i=0;i<4;i++)ball(body,.018,.13-i*.065,.143,.007,.007,.004,ink);
    if(r.parts.top==='top-varsity')for(const s of [-1,1])box(body,s*.11,-.065,.108,.058,.018,.015,cream);
  }
  if(r.parts.top==='top-hoodie'){
    const hood=ring(body,0,.24,-.035,.12,.032,top);hood.rotation.x=Math.PI/2;
    box(body,0,-.065,.112,.18,.065,.03,top);
    for(const s of [-1,1])capsule(body,s*.038,.13,.139,.006,.13,cream);
  }
  const glasses=r.parts.glasses;
  if(glasses!=='glasses-none'){
    for(const s of [-1,1]){
      if(glasses==='glasses-square'){
        for(const yy of [-.027,.031])box(head,s*.055,yy,.142,.085,.009,.012,ink);
        for(const xx of [-.04,.04])box(head,s*.055+xx,.002,.142,.009,.059,.012,ink);
      }else{const g=ring(head,s*.056,.004,.144,.039,.006,ink);if(glasses==='glasses-oval')g.scale.y=.75;}
      box(head,s*.113,.015,.068,.009,.01,.152,ink);
    }
    box(head,0,.006,.146,.035,.008,.012,ink);
  }
  const acc=r.parts.accessory;
  if(acc==='accessory-satchel'){const strap=box(body,0,.015,.14,.025,.47,.012,ink);strap.rotation.z=-.6;box(hips,.20,-.045,.06,.18,.2,.09,'#b88a54');box(hips,.20,.01,.112,.18,.065,.017,'#d1aa75');}
  if(acc==='accessory-backpack'){ball(body,0,0,-.17,.14,.19,.071,'#bc9466');box(body,0,-.07,-.23,.18,.1,.025,'#d9b583');for(const s of [-1,1])capsule(body,s*.12,.04,.11,.012,.32,'#bc9466');}
  if(acc==='accessory-scarf'){const scarf=ring(body,0,.275,0,.076,.025,'#d4b375');scarf.rotation.x=Math.PI/2;box(body,.066,.12,.14,.066,.25,.03,'#d4b375');}
  if(acc==='accessory-cap'){mesh(head,new T.SphereGeometry(1,16,10,0,Math.PI*2,0,Math.PI/2),0,.115,-.005,.162,.11,.15,top);ball(head,0,.115,.125,.17,.012,.105,top);}
  if(acc==='accessory-headphones'){const band=mesh(head,new T.TorusGeometry(.17,.013,6,24,Math.PI),0,.055,0,1,1,1,ink);for(const s of [-1,1])ball(head,s*.17,.015,0,.029,.061,.046,ink);}
  if(acc==='accessory-bow'){for(const s of [-1,1]){const bow=ball(head,.13+s*.035,.1,.075,.045,.024,.02,'#b06b78');bow.rotation.z=s*.4;}ball(head,.13,.1,.09,.018,.022,.018,'#915267');}
  root.userData.animate=(time,action='idle')=>{
    const stride=action==='walk'?Math.sin(time*7):0;
    hips.position.y=.85+(action==='walk'?Math.abs(Math.sin(time*7))*.014:Math.sin(time*1.8)*.005);
    for(const [side,s] of [['left',-1],['right',1]]){joints[side+'Arm'].rotation.x=-stride*.43*s;joints[side+'Leg'].rotation.x=stride*.45*s;joints[side+'Knee'].rotation.x=Math.max(0,-stride*s)*.5;}
    joints.rightArm.rotation.z=action==='wave'?-2.1:.08;
    joints.rightForearm.rotation.z=action==='wave'?-.3+Math.sin(time*8)*.3:0;
  };
  root.userData.dispose=()=>{root.traverse(o=>{o.geometry?.dispose();if(o.isLine)o.material.dispose();});materials.forEach(m=>m.dispose());};
  return root;
}
