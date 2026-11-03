"""Download the explicitly selected Commons thumbnails unchanged, with attribution."""
import hashlib,html,json,re,time,urllib.request,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
helper=runpy.run_path(str(ROOT/'scripts/prepare-place-photos.py'));query,UA=helper['query'],helper['UA']
CACHE=ROOT/'evidence/real-photos-20261030';OUT=ROOT/'public/assets/place-photos';OUT.mkdir(parents=True,exist_ok=True)
SELECTED={
 'denny':'Univ of Wash Denny Hall 01.jpg','raitt':'UDub Raitt Hall.jpg','savery':'University of Washington Savery Hall 01.jpg',
 'quad':'Cherry Blossoms University of Washington (33805993226).jpg','red-square':'Red Square, University of Washington panorama.jpg',
 'suzzallo':'University of Washington Suzzallo Library 01.jpg','fountain':'Drumheller fountain and Mount Rainier.jpg',
 'hub':'Husky Union Building 01 (cropped).jpg','kane':'Seattle UW Kane Hall I.jpg',
 'MLR':'U. of Wash Miller Hall 01.jpg','INT':'University of Washington - Intellectual House 01.jpg',
 'GRB':'Gerberding Hall, University of Washington, Seattle, Washington.jpg',
 'CSE2':'University of Washington - Bill and Melinda Gates Center for CSE 01.jpg','MUS':'U. of Wash School of Music 01.jpg',
 'SMI':'Smith Hall, University of Washington.jpg','FAC':'University of Washington Club 01.jpg',
 'PAR':'Univ of Wash Parrington Hall 01.jpg','LEW':'U. of Wash Lewis Hall 01.jpg',
 'OUG':'University of Washington - Odegaard Undergraduate Library 01.jpg',
 'MOR':'University of Washington - Bill and Melinda Gates Center for CSE and More Hall 01.jpg',
 'MNY':'Meany Hall, University of Washington.jpg','ECE':'MK03256 University of Washington Electrical Engineering Building.jpg',
 'KIR':'Kirsten wind tunnel 01A.jpg','LAW':'University of Washington Law School - William H. Gates Hall 01.jpg',
 'CLK':'U. of Wash Clark Hall 01.jpg','MCM':'University of Washington - McMahon Hall 01.jpg',
 'GUG':'U of Washington Guggenheim Hall 01.jpg','MGH':'Mary Gates Hall, April 2008.jpg','PCAR':'Univ of Wash Paccar Hall 01.jpg',
 'JHN':'Johnson Hall (26323649339).jpg','ART':'U. of Wash School of Art 01.jpg','SIG':'University of Washington - Sieg Hall 01.jpg',
 'FLK':'University of Washington - north end of Fluke Hall.jpg','BNS':'Benson Hall.jpg',
 'HUT':'University of Washington Hutchinson Hall.jpg','CMU':'Communications Building, University of Washington.jpg',
 'PDL':'Padelford Hall, University of Washington.JPG','ARC':'Univ of Wash Architecture Building 01.jpg',
 'PAB':'UW Physics Astronomy Auditorium from above.jpg',
 'red-square-pylon-2':'University of Washington - Red Square - exhaust stacks 01.jpg',
 'broken-obelisk':'Barnett Newman, Broken Obelisk (designed 1963, cast 1967), Quadrangle, Suzzallo Library, University of Washington, Seattle, Washington - 20060328.jpg',
}
pages={}
for f in CACHE.glob('category-*.json'):
    for page in json.loads(f.read_text(encoding='utf-8')).get('query',{}).get('pages',{}).values():pages[page['title']]=page
for rows in json.loads((CACHE/'primary-candidates.json').read_text(encoding='utf-8')).values():
    for row in rows:pages.setdefault(row['title'],{'title':row['title'],'imageinfo':[row['info']]})
missing=['File:'+title for title in SELECTED.values() if 'File:'+title not in pages]
if missing:
    data=query('selected-extra-metadata',dict(titles='|'.join(missing),prop='imageinfo',iiprop='url|size|extmetadata',iiurlwidth=960))
    for page in data['query']['pages'].values():pages[page['title']]=page
campus=json.loads((ROOT/'data/campus.json').read_text(encoding='utf-8'))
buildings={b['code']:b for b in campus['buildings'] if b.get('code')}
landmarks={p['id']:p for p in campus['landmarks']}
plain=lambda value:html.unescape(re.sub('<[^>]+>','',value)).strip()
previous=json.loads((OUT/'manifest.json').read_text(encoding='utf-8')) if (OUT/'manifest.json').exists() else {}
manifest={}
for key,title in SELECTED.items():
    info=pages['File:'+title]['imageinfo'][0];meta=info['extmetadata']
    field=lambda name:plain(meta.get(name,{}).get('value',''))
    license=field('LicenseShortName');license_url=field('LicenseUrl').replace('http://creativecommons.org/','https://creativecommons.org/')
    if not license_url and license=='CC0':license_url='https://creativecommons.org/publicdomain/zero/1.0/'
    # This particular author's worldwide PD-self grant was checked on its file page.
    if key in ('BNS','broken-obelisk') and license=='Public domain' and field('Copyrighted')=='False':license_url=info['descriptionurl']+'#Licensing'
    assert license.startswith(('CC BY','CC0','Public domain')) and license_url.startswith('https://'),(title,license,license_url)
    id=buildings[key]['id'] if key in buildings else key
    subject=buildings[key]['name'] if key in buildings else landmarks.get(key,{}).get('name',{'broken-obelisk':'Broken Obelisk','red-square-pylon-2':'Red Square Pylons'}.get(key,key))
    file=OUT/(id+'.jpg');url=info['thumburl']
    if not file.exists() or (previous.get(id) and previous[id]['title']!=title):
        time.sleep(1.3)
        for retry in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=45) as response:
                    assert response.headers.get_content_type()=='image/jpeg';content=response.read(4000001)
                assert len(content)<4000000 and content[:2]==b'\xff\xd8';file.write_bytes(content);break
            except Exception:
                if retry==3:raise
                time.sleep(10*(retry+1))
    from PIL import Image
    with Image.open(file) as image:width,height=image.size
    manifest[id]={'subject':subject,'path':'/assets/place-photos/'+file.name,'source':info['descriptionurl'],'original':info['url'],'downloadedFrom':url,
        'author':'Gephart' if key=='broken-obelisk' else field('Artist'),'license':license,'licenseUrl':license_url,'date':field('DateTimeOriginal'),
        'width':width,'height':height,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'adaptation':'Unchanged Wikimedia thumbnail; displayed with CSS object-fit.','title':title}
    print(id+' '+subject+' '+license,flush=True)
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Published '+str(len(manifest))+' photographs',flush=True)

