// Only reviewed, attributed real photographs. No substitute image or placeholder.
export function placePhoto(id,photos){
  const photo=photos[id];if(!photo)return null;
  const figure=document.createElement('figure');figure.className='place-photo';figure.dataset.photoPlace=id;
  const link=document.createElement('a');link.href=photo.source;link.target='_blank';link.rel='noopener noreferrer';
  const img=document.createElement('img');img.src=photo.path;img.alt=photo.subject+' 实景照片';img.width=photo.width;img.height=photo.height;img.decoding='async';
  // A missing local asset leaves no misleading empty frame or broken-image icon.
  img.addEventListener('error',()=>figure.remove(),{once:true});link.append(img);
  const caption=document.createElement('figcaption');caption.append(document.createTextNode('摄影：'+photo.author+' · '));
  const license=document.createElement('a');license.href=photo.licenseUrl;license.target='_blank';license.rel='noopener noreferrer';license.textContent=photo.license;
  caption.append(license,document.createTextNode(' · '));const source=document.createElement('a');source.href=photo.source;source.target='_blank';source.rel='noopener noreferrer';source.textContent='照片来源 ↗';caption.append(source);
  figure.append(link,caption);return figure;
}
