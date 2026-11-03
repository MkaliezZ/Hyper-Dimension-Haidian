"""Describe the reviewed UW adaptation while retaining the sealed Base manifest verbatim."""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parents[1]/'base'
current=root/'PACKAGE-MANIFEST.json';sealed=root/'SEALED-BASE-MANIFEST.json'
if not sealed.exists():
    with sealed.open('xb') as out:out.write(current.read_bytes())
original=json.loads(sealed.read_text(encoding='utf8'))
allowed={f'src/platform/{n}.mjs' for n in ['activities','community','environment','m2','network','partners']}|{'tools/m0-init.mjs','deploy/entry.mjs'}
added={'src/platform/world-places.mjs','src/platform/school-definitions.mjs','SEALED-BASE-MANIFEST.json'}
def record(name):
    b=(root/name).read_bytes()
    return {'path':name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
records=[record(row['path']) for row in original['files']]
changed={r['path'] for r,old in zip(records,original['files']) if r['sha256']!=old['sha256']}
if changed!=allowed:raise SystemExit('Unexpected embedded source change: '+str(changed^allowed))
for name in sorted(added):records.append(record(name))
manifest={**original,'campus':{**original['campus'],'releaseType':'uw-school-adaptation','acceptance':'../evidence/native-campus-20261028/ACCEPTANCE.md'},'schoolAdaptation':{'schoolVersion':'0.3.0','spaceId':'uw-seattle','contract':'hyper-dimension.geo-campus/v1','originalManifest':'SEALED-BASE-MANIFEST.json','originalArchiveSha256':'abc0f06baa8fc0b03d5335f56e39b4c310487269e8f83111debdda83a7eb2368','changedSourceFiles':sorted(allowed),'newFiles':sorted(added),'scope':'UW school copy only; canonical Base and sealed deliveries retained'},'files':records}
current.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'payloads':len(records),'changedSourceFiles':len(changed),'sealedManifestPreserved':True}))
