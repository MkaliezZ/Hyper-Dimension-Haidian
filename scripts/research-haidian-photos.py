"""Read public, school-linked VR metadata; cache unchanged source photographs for review."""
from pathlib import Path
import json,re,xml.etree.ElementTree as ET,concurrent.futures,requests,hashlib
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'sources/haidian-photos-20261106';CACHE.mkdir(parents=True,exist_ok=True)
html=(CACHE/'official-vr.html').read_text(encoding='utf-8')
data=json.loads((CACHE/'vr-data.json').read_text(encoding='utf-8'))
xml=re.search(r"'xml'\s*:\s*'(.*?)',",html,re.S).group(1).replace("\\'","'")
doc=ET.fromstring(xml)
scene_xml={int(e.attrib['scene_id']):e for e in doc.findall('scene')}
views={int(e.attrib['name'][2:]):e.find('view').attrib for e in doc.findall('./config/panos/pano')}
catalog=[]
for group in data['product']['config']['category']:
 for s in group['scenes']:
  e=scene_xml[s['id']]
  path=e.find('preview').attrib['url'];m=re.match(r'%\$cdnDomain(\d+)%(.*)',path)
  # Exact public domain rule from the provider's page JS, not an invented asset host.
  origin='https://ssl-panoimg'+m[1]+'.720static.com';base=m[2].rsplit('/',1)[0]
  yaw=float(views.get(s['id'],{}).get('hlookat',0));face=['f','r','b','l'][round(yaw/90)%4]
  cubes=[x.attrib.get('url','') for x in e.findall('.//cube')]
  mobile=next((c for c in cubes if '/mobile_%s.jpg' in c),None)
  if not mobile:raise RuntimeError('No direct original face URL: '+s['name'])
  row={**s,'group':group['title'],'initialView':views.get(s['id'],{}),'face':face,'source':'https://720yun.com/t/b2vkue1es1q?scene_id='+str(s['id']),'original':origin+base+'/mobile_'+face+'.jpg','file':'vr-'+str(s['id'])+'-'+face+'.jpg','credit':'海淀外国语信息中心','rights':'原作者保留权利'}
  catalog.append(row)
(CACHE/'vr-catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
SELECT=[95774662,38547783,38569694,38547791,38548726,38547780,38547785,38547784,38540122,38540111,38650279,130608864,130608866,130627027,130623757,40671541,40671543,130585917,130585909,130585910,130585912,130585907,130585908,130585913,38553240,130623756,130623760,130585915,38540115,38553237,38601824,38540121,130616548,130590841]
def download(row):
 path=CACHE/row['file']
 if not path.exists():
  for attempt in range(3):
   try:
    r=requests.get(row['original'],headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.720yun.com/'},timeout=(8,22));r.raise_for_status()
    if not r.content.startswith(b'\xff\xd8'):raise RuntimeError('Not a JPEG')
    path.write_bytes(r.content);break
   except Exception as e:
    if attempt==2:return {'id':row['id'],'name':row['name'],'error':str(e)}
 b=path.read_bytes();return {'id':row['id'],'name':row['name'],'face':row['face'],'file':row['file'],'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
with concurrent.futures.ThreadPoolExecutor(5) as ex:
 for result in ex.map(download,[s for s in catalog if s['id'] in SELECT]):print(json.dumps(result,ensure_ascii=False),flush=True)
