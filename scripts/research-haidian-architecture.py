"""Cache original public panorama faces for multi-angle architecture review only."""
from pathlib import Path
import argparse, concurrent.futures, hashlib, json, time, requests

ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'sources/haidian-photos-20261106'
CATALOG={s['id']:s for s in json.loads((CACHE/'vr-catalog.json').read_text(encoding='utf-8'))}


def fetch(task):
    sid,face=task
    row=CATALOG[sid]
    url=row['original'].rsplit('/',1)[0]+'/mobile_'+face+'.jpg'
    path=CACHE/f'vr-{sid}-{face}.jpg'
    try:
        if not path.exists():
            start=time.monotonic()
            with requests.get(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.720yun.com/'},stream=True,timeout=(7,7)) as response:
                response.raise_for_status();parts=[]
                for part in response.iter_content(65536):
                    if time.monotonic()-start>35:raise TimeoutError('Review fetch exceeded 35 seconds')
                    parts.append(part)
            raw=b''.join(parts)
            if not raw.startswith(b'\xff\xd8'):raise ValueError('Not a JPEG')
            path.write_bytes(raw)
        raw=path.read_bytes()
        return {'sceneId':sid,'scene':row['name'],'face':face,'path':path.name,'source':row['source'],'original':url,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
    except Exception as error:
        return {'sceneId':sid,'scene':row['name'],'face':face,'error':str(error)}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--scenes',required=True);p.add_argument('--faces',default='frbl');p.add_argument('--workers',type=int,default=6);a=p.parse_args()
    tasks=[(int(sid),face) for sid in a.scenes.split(',') for face in a.faces]
    with concurrent.futures.ThreadPoolExecutor(a.workers) as pool:
        rows=list(pool.map(fetch,tasks))
    report=CACHE/'architecture-fetch.json';previous=json.loads(report.read_text(encoding='utf-8')) if report.exists() else []
    indexed={(r['sceneId'],r['face']):r for r in previous}
    indexed.update({(r['sceneId'],r['face']):r for r in rows})
    report.write_text(json.dumps(list(indexed.values()),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'cached':sum('error' not in r for r in rows),'failed':[r for r in rows if 'error' in r]},ensure_ascii=False))
