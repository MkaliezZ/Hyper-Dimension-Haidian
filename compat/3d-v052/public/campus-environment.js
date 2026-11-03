import {terrainHeight} from './terrain-surface.js';
export function explorationBounds(campus){const [x0,z0,x1,z1]=campus.bounds||campus.terrain.bounds;return [x0+2,z0+2,x1-2,z1-2];}

export function installCampusEnvironment(T,scene,campus){
  const sky=new T.Mesh(new T.SphereGeometry(12000,32,16),new T.ShaderMaterial({side:T.BackSide,depthWrite:false,depthTest:false,toneMapped:false,
    uniforms:{zenith:{value:new T.Color('#6baedb')},horizon:{value:new T.Color('#c0ddeb')},sunColor:{value:new T.Color('#fff5da')}},
    vertexShader:'varying vec3 worldPosition;void main(){vec4 world=modelMatrix*vec4(position,1.0);worldPosition=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}',
    fragmentShader:'uniform vec3 zenith;uniform vec3 horizon;uniform vec3 sunColor;varying vec3 worldPosition;void main(){vec3 d=normalize(worldPosition-cameraPosition);float h=smoothstep(-0.05,0.22,d.y);vec3 color=mix(horizon,zenith,h);float sun=dot(d,normalize(vec3(-0.55,0.34,-0.64)));color+=sunColor*(pow(max(0.0,sun),1100.0)*0.7+pow(max(0.0,sun),18.0)*0.10);gl_FragColor=vec4(color,1.0);#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'.replace(';#include',';\n#include')
  }));sky.name='UW-daylight-sky';sky.frustumCulled=false;sky.renderOrder=-100;scene.add(sky);
  scene.fog=new T.Fog('#eaf0e7',1250,3000);
  const clouds=new T.Group();clouds.name='UW-paper-clouds';scene.add(clouds);const cloudGeometry=new T.IcosahedronGeometry(1,1),cloudMaterial=new T.MeshBasicMaterial({color:'#fffdf6',fog:false,toneMapped:false}),cloudMesh=new T.InstancedMesh(cloudGeometry,cloudMaterial,48),cloudMatrix=new T.Matrix4(),cloudRotation=new T.Quaternion();
  for(let i=0;i<12;i++){
    const angle=i*Math.PI*2/12+.24,radius=1250+(i%3)*220,cx=Math.cos(angle)*radius,cz=Math.sin(angle)*radius,y=100+(i%4)*28;
    for(let j=0;j<4;j++){cloudRotation.setFromAxisAngle(new T.Vector3(0,1,0),angle);cloudMatrix.compose(new T.Vector3(cx+(j-1.5)*44,y+Math.sin(j*2+i)*9,cz+Math.cos(j+i)*18),cloudRotation,new T.Vector3(46+j%2*17,15+j%3*6,24));cloudMesh.setMatrixAt(i*4+j,cloudMatrix);}
  }
  cloudMesh.renderOrder=-20;clouds.add(cloudMesh);
  const [x0,z0,x1,z1]=explorationBounds(campus),points=[],corners=[[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]];
  for(let edge=0;edge<4;edge++){const a=corners[edge],b=corners[edge+1],count=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/3);for(let j=0;j<count;j++){const t=j/count,u=(j+1)/count;points.push({a:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],b:[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u]});}}
  const boundary=new T.Group();boundary.name='UW-exploration-boundary';scene.add(boundary);
  const hedge=new T.InstancedMesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:'#7c9773',roughness:1,flatShading:true}),points.length),posts=new T.InstancedMesh(new T.CylinderGeometry(.085,.11,1.55,5),new T.MeshStandardMaterial({color:'#b6a584',roughness:1,flatShading:true}),points.length);
  const matrix=new T.Matrix4(),rotation=new T.Quaternion();for(let i=0;i<points.length;i++){const {a,b}=points[i],x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,y=terrainHeight(campus.terrain,x,z),length=Math.hypot(b[0]-a[0],b[1]-a[1]);rotation.setFromAxisAngle(new T.Vector3(0,1,0),-Math.atan2(b[1]-a[1],b[0]-a[0]));matrix.compose(new T.Vector3(x,y+.63,z),rotation,new T.Vector3(length+.08,1.22,.5));hedge.setMatrixAt(i,matrix);matrix.makeTranslation(a[0],terrainHeight(campus.terrain,...a)+.775,a[1]);posts.setMatrixAt(i,matrix);}
  hedge.receiveShadow=true;boundary.add(hedge,posts);
  return {sky,clouds,boundary,bounds:[x0,z0,x1,z1],stats:{sky:'procedural-daylight',cloudGroups:12,boundarySegments:points.length,boundary:'modeled-campus-extent',realTimeWeather:false},update(camera){sky.position.copy(camera.position);},dispose(){sky.geometry.dispose();sky.material.dispose();cloudGeometry.dispose();cloudMaterial.dispose();hedge.geometry.dispose();hedge.material.dispose();posts.geometry.dispose();posts.material.dispose();scene.remove(sky,clouds,boundary);}};
}
