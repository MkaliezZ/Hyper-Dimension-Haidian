"""Explicit offline Commons research. Slow, cached requests; no runtime image proxy."""
import json,time,urllib.parse,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'evidence/real-photos-20261030'
UA='HyperCampusPhotoAttribution/1.0 (local educational campus prototype)'
def query(name,params):
    file=CACHE/(name+'.json')
    if file.exists():return json.loads(file.read_text(encoding='utf-8'))
    for retry in range(4):
        time.sleep(1.5)
        url='https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode(dict(action='query',format='json',**params))
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=40) as response:data=json.load(response)
            if 'error' in data:raise RuntimeError(data['error'])
            file.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8');return data
        except urllib.error.HTTPError as e:
            if e.code not in (429,503):raise
            time.sleep(max(12*(retry+1),int(e.headers.get('Retry-After','0'))))
    raise RuntimeError('Commons unavailable; keep cached work')
CATEGORIES={
 'denny':'Denny Hall, University of Washington','red-square':'Red Square (University of Washington)',
 'MLR':'Miller Hall, University of Washington','INT':'Intellectual House','GRB':'Gerberding Hall',
 'CSE2':'Bill and Melinda Gates Center for CSE, University of Washington','MUS':'University of Washington School of Music',
 'SMI':'Smith Hall, University of Washington','FAC':'University of Washington Club','PAR':'Parrington Hall, University of Washington',
 'LEW':'Lewis Hall, University of Washington','OUG':'Odegaard Undergraduate Library','MOR':'More Hall, University of Washington',
 'MNY':'Meany Hall','ECE':'Electrical Engineering Building, University of Washington','KIR':'Kirsten Wind Tunnel',
 'AVA':'Henry Art Gallery','LAW':'William H. Gates Hall, University of Washington','CLK':'Clark Hall, University of Washington',
 'MCM':'McMahon Hall, University of Washington','GUG':'Guggenheim Hall, University of Washington',
 'MGH':'Mary Gates Hall, University of Washington','PCAR':'Paccar Hall, University of Washington',
 'JHN':'Johnson Hall, University of Washington','ART':'University of Washington School of Art','SIG':'Sieg Hall',
}
if __name__=='__main__':
    for key,category in CATEGORIES.items():
        data=query('category-'+key,dict(generator='categorymembers',gcmtitle='Category:'+category,gcmtype='file',gcmlimit=100,prop='imageinfo',iiprop='url|size|extmetadata',iiurlwidth=960))
        pages=list(data.get('query',{}).get('pages',{}).values())
        print(key+': '+' | '.join(p['title'][5:] for p in pages if p.get('imageinfo') and not any(w in p['title'].lower() for w in ['portrait','professor','dpla','plan','interior','rabbit']))[:1600],flush=True)
