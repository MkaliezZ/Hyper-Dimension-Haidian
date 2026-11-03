"""Audit intentional UW vendored adaptations without rewriting sealed-package evidence."""
import argparse,datetime,difflib,hashlib,json
from pathlib import Path
uw=Path(__file__).resolve().parents[1]
root=uw.parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args()
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for data in iter(lambda:f.read(1048576),b''):h.update(data)
    return h.hexdigest()
baseline=json.loads((root/'outputs/Hyper-Dimension-UW-MVP/2026-10-28/v0.2.0/SOURCE-MANIFEST.json').read_text(encoding='utf-8-sig'))
allowed={f'base/src/platform/{name}.mjs' for name in ['activities','community','environment','m2','network','partners']}
allowed|={'base/tools/m0-init.mjs','base/deploy/entry.mjs','base/PACKAGE-MANIFEST.json'}
allowed|={'base/integrations/nodebb/index.cjs','base/src/platform/identity.mjs','base/src/platform/personal.mjs'}
added={'base/src/platform/world-places.mjs','base/src/platform/school-definitions.mjs','base/integrations/nodebb/loopback-http.cjs','base/src/platform/browser-sessions.mjs'}
rows=[r for r in baseline['files'] if r['path'].startswith('base/')]
changes=[]
for r in rows:
    actual=sha(uw/r['path'])
    if actual!=r['sha256']:changes.append({'path':r['path'],'original':r['sha256'],'current':actual})
assert {r['path'] for r in changes}==allowed,'Unexpected embedded Base source changes'
originals={r['path'] for r in rows}
new={p.relative_to(uw).as_posix() for folder in ['base/src','base/integrations/nodebb'] for p in (uw/folder).rglob('*') if p.is_file()}-originals
assert new==added,'Unexpected new embedded Base source'
sealed_manifest=next(r for r in rows if r['path']=='base/PACKAGE-MANIFEST.json')
assert sha(uw/'base/SEALED-BASE-MANIFEST.json')==sealed_manifest['sha256'],'Original Base manifest changed'
adapted=json.loads((uw/'base/PACKAGE-MANIFEST.json').read_text(encoding='utf8'))
for row in adapted['files']:
    p=uw/'base'/row['path']
    assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],str(p)
old=json.loads((root/'outputs/Hyper-Dimension-UW-MVP/2026-10-28/v0.1.0/preservation.json').read_text(encoding='utf-8-sig'))
protected=[r for v in old.values() if isinstance(v,list) for r in v if isinstance(r,dict) and 'path' in r and 'sha256' in r]
assert protected
for r in protected:assert sha(Path(r['path']))==r['sha256'],r['path']
sealed=root/'outputs/Hyper-Dimension-UW-MVP/2026-10-28/v0.1.0/UW-Hyper-Dimension-MVP-v0.1.0-complete.zip'
assert sha(sealed)=='2818a4c7952a77874156bb3672b00972a423fff691273df403aedb09711c712a'
geometry=next(r for r in baseline['files'] if r['path']=='data/campus.json')
assert sha(uw/'data/campus.json')==geometry['sha256']
# Canonical Base and sealed archives remain original. The school copy alone carries the patch.
patch=[]
for r in changes:
    canonical=(uw/'base/SEALED-BASE-MANIFEST.json') if r['path']=='base/PACKAGE-MANIFEST.json' else uw.parent/'hyper-dimension-base-integrations'/r['path'].removeprefix('base/')
    assert sha(canonical)==r['original'],str(canonical)
    patch.extend(difflib.unified_diff(canonical.read_text(encoding='utf-8-sig').splitlines(True),(uw/r['path']).read_text(encoding='utf-8-sig').splitlines(True),fromfile='sealed/'+r['path'],tofile='school/'+r['path']))
live=json.loads((uw/'evidence/native-campus-20261028/live-result.json').read_text(encoding='utf8'))
restored=json.loads((uw/'evidence/native-campus-20261028/restore-result.json').read_text(encoding='utf8'))
assert live['status']=='PASS' and len(live['checks'])==9
assert restored['status']=='PASS' and len(restored['checks'])==8
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'UW school copy; not a new sealed Base release','baseBaselineFiles':len(rows),'changedBaseFiles':changes,'newBaseFiles':[{'path':p,'sha256':sha(uw/p)} for p in sorted(new|{'base/SEALED-BASE-MANIFEST.json'})],'protectedRecordsChecked':len(protected),'protectedRecordsChanged':[],'sealedUwV010Unchanged':True,'campusGeometryUnchanged':True,'canonicalBaseSourcesUnchanged':True,'nativeDeploymentStatus':'9 UW integration checks and 8 restored-clone checks passed with fictional local accounts; production UW deployment not claimed','newZipCreated':False}
with args.out.open('x',encoding='utf8') as f:json.dump(result,f,indent=2)
with args.out.with_suffix('.diff').open('x',encoding='utf8') as f:f.write(''.join(patch))
print(json.dumps({k:v for k,v in result.items() if k not in ['changedBaseFiles','newBaseFiles']}))
