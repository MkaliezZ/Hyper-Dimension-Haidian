import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildVisitorModel} from './visitor-model.js';

const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const slots={body:'体型',hair:'发型',top:'上装',bottom:'下装',shoes:'鞋履',glasses:'眼镜',accessory:'配饰'};
export function installVisitorEditor({api,onApply,toast}){
  let catalog,profile,draft,model,studio,camera,controls,scene,action='idle',activeSlot='hair',dirty=false,saving=false,view='full';
  const thumbs=new Map();let target;
  const dialog=el('dialog','visitor-editor');dialog.id='visitor-editor';dialog.setAttribute('aria-labelledby','visitor-title');
  const heading=el('header','visitor-heading'),title=el('div');title.append(el('small',null,'MAKE YOURSELF AT HOME'),el('h2',null,'我的校园形象'));title.lastChild.id='visitor-title';
  const close=el('button','visitor-close','返回校园');close.setAttribute('aria-label','关闭人物编辑');heading.append(title,close);
  const layout=el('div','visitor-layout'),preview=el('section','visitor-studio'),options=el('section','visitor-options');options.setAttribute('aria-label','人物搭配选项');
  const studioHeading=el('div','visitor-studio-heading');studioHeading.append(el('span',null,'形象预览'),el('span','visitor-style-badge','圆润卡通'));
  const stage=el('div','visitor-stage'),canvas=el('canvas');canvas.setAttribute('aria-label','可旋转的人物三维预览');stage.append(canvas);
  const studioFooter=el('div','visitor-studio-footer'),views=el('div','visitor-view-buttons');
  function frame(mode){view=mode;if(!camera)return;const center=mode==='face'?new T.Vector3(0,1.38,0):new T.Vector3(0,.91,0);controls.target.copy(center);camera.position.copy(center).add(mode==='face'?new T.Vector3(.38,.06,1.58):new T.Vector3(1.50,.42,3.65));controls.update();views.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===mode)));}
  for(const [id,label] of [['full','看全身'],['face','看细节']]){const b=el('button',null,label);b.dataset.view=id;b.setAttribute('aria-pressed',String(id==='full'));b.onclick=()=>frame(id);views.append(b);}
  const poses=el('div','visitor-poses');for(const [id,label] of [['idle','站立'],['walk','行走'],['wave','挥手']]){const b=el('button',null,label);b.onclick=()=>{action=id;poses.querySelectorAll('button').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));};b.setAttribute('aria-pressed',String(id==='idle'));poses.append(b);}
  studioFooter.append(views,poses,el('p',null,'拖动旋转 · 滚轮缩放'));preview.append(studioHeading,stage,studioFooter);
  const nameLabel=el('label','visitor-name'),nameText=el('span',null,'怎么称呼你？'),name=el('input');name.maxLength=32;name.autocomplete='off';name.setAttribute('aria-label','访客称呼');name.placeholder='输入你的校园昵称';nameLabel.append(nameText,name);options.append(nameLabel);
  const presetHeading=el('div','visitor-section-title');presetHeading.append(el('h3',null,'从一套搭配开始'),el('span',null,'也可以自由组合'));
  const presets=el('div','visitor-presets'),tabs=el('div','visitor-tabs'),choiceTitle=el('div','visitor-section-title'),choices=el('div','visitor-choices'),appearance=el('div','visitor-appearance');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','人物部件类别');options.append(presetHeading,presets,tabs,choiceTitle,choices,appearance);
  const status=el('p','visitor-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const footer=el('footer','visitor-footer'),footerInfo=el('div','visitor-footer-info'),footerActions=el('div','visitor-footer-actions');
  const save=el('button','primary-button','保存形象，进入校园'),reload=el('button','quiet-button','撤销本次修改'),restore=el('button','quiet-button','上一套搭配'),note=el('p','visitor-privacy');
  footerInfo.append(status,note);footerActions.append(restore,reload,save);footer.append(footerInfo,footerActions);
  const identityNote=data=>{note.textContent=data.identityMode==='member'?'保存在学校账号中，下次登录可恢复。':'保存在当前浏览器身份中，保留 Cookie 即可恢复。';};
  layout.append(preview,options);dialog.append(heading,layout,footer);document.body.append(dialog);
  const error=(recipe=draft)=>catalog.incompatible.find(([a,b])=>Object.values(recipe.parts).includes(a)&&Object.values(recipe.parts).includes(b))?.[2];
  const currentRecipe=recipe=>({...structuredClone(recipe),catalogVersion:catalog.version,generatorVersion:catalog.generator});
  function updateStatus(message){const issue=error(),old=profile&&profile.recipe.generatorVersion!==catalog.generator;status.textContent=message||issue||(dirty?'搭配尚未保存。喜欢的话，就带着这个形象出发。':old?'旧存档已保留；正在预览新外观，保存后更新。':'选一套喜欢的搭配，准备出发。');status.dataset.tone=issue?'warning':'normal';save.disabled=Boolean(issue)||saving;}
  function disposeModel(){if(model){scene.remove(model);model.userData.dispose();model=null;}}
  function setupStudio(){
    if(studio)return;
    studio=new T.WebGLRenderer({canvas,antialias:true,alpha:true});studio.setPixelRatio(Math.min(devicePixelRatio,2));studio.outputColorSpace=T.SRGBColorSpace;studio.toneMapping=T.ACESFilmicToneMapping;studio.toneMappingExposure=1.10;
    scene=new T.Scene();camera=new T.PerspectiveCamera(29,1,.02,30);
    controls=new OrbitControls(camera,canvas);controls.minDistance=1.15;controls.maxDistance=5.4;controls.enablePan=false;controls.maxPolarAngle=Math.PI*.60;controls.minPolarAngle=Math.PI*.22;
    scene.add(new T.HemisphereLight('#fff9ed','#a8b4a3',2.15));const key=new T.DirectionalLight('#fff0df',2.3);key.position.set(-3,5,5);scene.add(key);
    const fill=new T.DirectionalLight('#e8edff',1);fill.position.set(3,2,-2);scene.add(fill);
    const podium=new T.Mesh(new T.CylinderGeometry(.65,.68,.055,48),new T.MeshStandardMaterial({color:'#d8ddcc',roughness:1}));podium.position.y=-.045;scene.add(podium);
    const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;const ctx=shadowCanvas.getContext('2d'),shade=ctx.createRadialGradient(32,32,2,32,32,31);shade.addColorStop(0,'rgba(64,67,49,.20)');shade.addColorStop(1,'rgba(64,67,49,0)');ctx.fillStyle=shade;ctx.fillRect(0,0,64,64);
    const shadowTexture=new T.CanvasTexture(shadowCanvas),shadow=new T.Mesh(new T.PlaneGeometry(.90,.61),new T.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.012;scene.add(shadow);
    target=new T.WebGLRenderTarget(144,144,{depthBuffer:true});target.texture.colorSpace=T.SRGBColorSpace;frame(view);
  }
  function resize(){if(!studio||!dialog.open)return;const r=stage.getBoundingClientRect();if(!r.width||!r.height)return;studio.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();studio.render(scene,camera);}
  function thumbnail(recipe,slot){
    const key=slot+JSON.stringify(recipe);if(thumbs.has(key))return thumbs.get(key);setupStudio();
    const s=new T.Scene();s.background=new T.Color('#f0f0e8');s.add(new T.HemisphereLight('#fff7ee','#b6bdaf',2.3));const light=new T.DirectionalLight('#ffffff',2.2);light.position.set(-2,4,5);s.add(light);
    const m=buildVisitorModel(T,recipe,catalog.skins);s.add(m);
    const config={hair:[1.35,1.25],glasses:[1.35,.88],top:[.88,1.00],bottom:[.40,.92],shoes:[.12,.49],accessory:[.94,2.03],body:[.91,2.03]}[slot],height=config[1],cam=new T.OrthographicCamera(-height/2,height/2,height/2,-height/2,.1,10);
    cam.position.set(.7,config[0]+.07,4);cam.lookAt(0,config[0],0);cam.updateProjectionMatrix();
    const previous=studio.getRenderTarget();studio.setRenderTarget(target);studio.clear();studio.render(s,cam);
    const pixels=new Uint8Array(144*144*4);studio.readRenderTargetPixels(target,0,0,144,144,pixels);studio.setRenderTarget(previous);
    const flipped=new Uint8ClampedArray(pixels.length);for(let y=0;y<144;y++)flipped.set(pixels.subarray(y*144*4,(y+1)*144*4),(143-y)*144*4);
    const tile=document.createElement('canvas');tile.width=tile.height=144;tile.getContext('2d').putImageData(new ImageData(flipped,144,144),0,0);const url=tile.toDataURL('image/png');m.userData.dispose();
    if(thumbs.size>96)thumbs.clear();thumbs.set(key,url);return url;
  }
  function renderModel(){updateStatus();if(error())return;setupStudio();disposeModel();model=buildVisitorModel(T,draft,catalog.skins);scene.add(model);resize();canvas.dataset.recipe=JSON.stringify(draft);canvas.dataset.rendererHash=catalog.rendererHash;canvas.dataset.generator=draft.generatorVersion;}
  function refreshGallery(){
    choiceTitle.replaceChildren(el('h3',null,slots[activeSlot]),el('span',null,'点击试穿'));
    choices.replaceChildren();
    for(const part of catalog.parts.filter(p=>p.slot===activeSlot)){
      const recipe=structuredClone(draft);recipe.parts[activeSlot]=part.id;const issue=error(recipe),selected=draft.parts[activeSlot]===part.id,b=el('button','visitor-part'+(selected?' selected':''));b.dataset.part=part.id;b.setAttribute('aria-label',part.label);b.setAttribute('aria-pressed',String(selected));
      const image=el('img');image.alt='';image.width=image.height=144;image.src=thumbnail(recipe,activeSlot);b.append(image,el('span',null,part.label));if(selected)b.append(el('span','visitor-part-check','✓'));if(issue){b.classList.add('needs-adjustment');b.append(el('small',null,'需调整搭配'));b.title=issue;}
      b.onclick=()=>{draft.parts[activeSlot]=part.id;dirty=true;refreshGallery();renderModel();};choices.append(b);
    }
  }
  function refreshChoices(){
    tabs.replaceChildren();for(const [id,label] of Object.entries(slots)){const b=el('button',id===activeSlot?'active':'',label);b.setAttribute('aria-pressed',String(id===activeSlot));b.onclick=()=>{activeSlot=id;refreshChoices();};tabs.append(b);}
    refreshGallery();appearance.replaceChildren();const skin=el('fieldset','visitor-swatches');skin.append(el('legend',null,'肤色'));
    for(const [id,color] of Object.entries(catalog.skins)){const b=el('button',draft.skin===id?'selected':'');b.style.backgroundColor=color;b.setAttribute('aria-label','肤色 '+id);b.setAttribute('aria-pressed',String(draft.skin===id));b.onclick=()=>{draft.skin=id;dirty=true;refreshChoices();renderModel();};skin.append(b);}appearance.append(skin);
    for(const [key,label] of [['hair','发色'],['top','上装颜色'],['bottom','下装颜色'],['shoes','鞋子颜色']]){const row=el('label','visitor-color',label),input=el('input');input.type='color';input.value=draft.colors[key];input.setAttribute('aria-label',label);input.oninput=()=>{draft.colors[key]=input.value;dirty=true;renderModel();};input.onchange=()=>refreshGallery();row.append(input);appearance.append(row);}
    const height=el('label','visitor-height','身高'),select=el('select');select.setAttribute('aria-label','人物身高');for(const [id,label] of [['short','小个子'],['standard','标准'],['tall','高个子']]){const o=el('option',null,label);o.value=id;o.selected=draft.height===id;select.append(o);}select.onchange=()=>{draft.height=select.value;dirty=true;refreshGallery();renderModel();};height.append(select);appearance.append(height);
  }
  function sync(){draft=currentRecipe(profile?.recipe||catalog.defaultRecipe);name.value=profile?.displayName||'校园访客';dirty=false;refreshChoices();renderModel();}
  function stop(){studio?.setAnimationLoop(null);disposeModel();if(scene){scene.traverse(o=>{o.geometry?.dispose();for(const m of [].concat(o.material||[])){m.map?.dispose();m.dispose();}});scene.clear();}target?.dispose();target=null;controls?.dispose();studio?.dispose();studio=null;scene=null;thumbs.clear();choices.replaceChildren();}
  new ResizeObserver(resize).observe(stage);
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{stop();sessionStorage.setItem('uw-visitor-intro-seen','yes');});dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});name.oninput=()=>{dirty=true;updateStatus();};
  reload.onclick=async()=>{try{const data=await api('/api/avatar');identityNote(data);profile=data.profile;catalog=data.catalog;sync();updateStatus('已撤销本次修改，载入保存的搭配。');}catch(e){updateStatus(e.message);}};
  restore.onclick=async()=>{try{const data=await api('/api/avatar/history'),previous=data.profiles.at(-1);if(!previous)return updateStatus('当前还没有上一套搭配。');draft=currentRecipe(previous.recipe);name.value=previous.displayName;dirty=true;refreshChoices();renderModel();updateStatus('已试穿上一套搭配，保存后生效。');}catch(e){updateStatus(e.message);}};
  save.onclick=async()=>{
    if(saving||error())return;saving=true;save.disabled=true;close.disabled=true;reload.disabled=true;restore.disabled=true;options.inert=true;save.textContent='正在保存…';
    try{const saved=await api('/api/avatar',{requestId:crypto.randomUUID(),expectedRevision:profile?.revision||0,displayName:name.value,recipe:draft});profile=saved;dirty=false;onApply(saved,catalog,{storedProfile:saved});dialog.close();toast('形象已保存，出发去校园吧。');}
    catch(e){updateStatus(e.message);}
    finally{saving=false;save.disabled=Boolean(error());close.disabled=false;reload.disabled=false;restore.disabled=false;options.inert=false;save.textContent='保存形象，进入校园';}
  };
  async function load(){const data=await api('/api/avatar');identityNote(data);catalog=data.catalog;profile=data.profile;presets.replaceChildren();for(const preset of catalog.presets){const b=el('button',null,preset.label);b.onclick=()=>{draft=structuredClone(preset.recipe);dirty=true;refreshChoices();renderModel();};presets.append(b);}onApply(data.presentation||profile||{displayName:'校园访客',recipe:catalog.defaultRecipe},catalog,{storedProfile:profile});return profile;}
  async function open(){if(dialog.open)return;if(!catalog)await load();dialog.showModal();sync();resize();studio.setAnimationLoop(time=>{if(!dialog.open)return;model?.userData.animate(time/1000,action);controls.update();studio.render(scene,camera);});}
  return {open,async init(){const saved=await load();if(!saved&&!sessionStorage.getItem('uw-visitor-intro-seen'))await open();},dispose(){if(dialog.open)dialog.close();else stop();dialog.remove();}};
}
