// Only a short-lived same-tab destination is stored, never form text or credentials.
const key='uw-login-return-v1',known=new Set(['/',...['m1','community','activities','ranking','network','operations','partners','environment','knowledge','reception-sessions','agents','agent-tasks','admin','profile','social','history','rewards','annual','inbox','jobs','contacts','inventory','forum-editor','delegations'].map(x=>'/'+x+'.html')]);
let lastControl;
document.addEventListener('click',event=>{lastControl=event.target.closest?.('button,a')||lastControl;},true);
for (const dialog of document.querySelectorAll('dialog')) {
  if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
    const heading=dialog.querySelector('h1,h2,h3');
    if (heading) {heading.id ||= (dialog.id || 'campus-dialog')+'-heading';dialog.setAttribute('aria-labelledby',heading.id);}
  }
  let opener;
  dialog.addEventListener('beforetoggle',event=>{if(event.newState==='open')opener=lastControl||document.activeElement;});
  dialog.addEventListener('close',()=>{const target=opener?.id?document.getElementById(opener.id):opener;if(target?.isConnected&&target.getClientRects().length)target.focus({preventScroll:true});});
}
function safe(path){try{const u=new URL(path,location.origin);return u.origin===location.origin&&known.has(u.pathname)?u.pathname+u.search+u.hash:null;}catch{return null;}}
document.addEventListener('click',event=>{
  const link=event.target.closest?.('a[href]');if(!link)return;
  const url=new URL(link.href,location.origin);if(url.origin!==location.origin||!['/auth/login','/auth/register'].includes(url.pathname))return;
  try{sessionStorage.setItem(key,JSON.stringify({path:safe(location.href),at:Date.now()}));}catch{}
},true);
try{
  const pending=JSON.parse(sessionStorage.getItem(key)||'null');
  if(pending&&location.pathname==='/m1.html'){
    sessionStorage.removeItem(key);
    const path=safe(pending.path);
    if(path&&path!=='/m1.html'&&Date.now()-pending.at>=0&&Date.now()-pending.at<300000){
      const me=await fetch('/m0/me');if(me.ok)location.replace(path);
    }
  }
}catch{}
