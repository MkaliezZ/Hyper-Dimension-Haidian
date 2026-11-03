"""Build a new, complete UW school archive. Originals, private state and GIS tools excluded."""
from pathlib import Path
import argparse, hashlib, json, stat, zipfile

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
targets=parser.add_mutually_exclusive_group(required=True)
targets.add_argument('--out')
targets.add_argument('--manifest-out',help='Write a new complete source-directory snapshot manifest without a ZIP')
args=parser.parse_args();out=Path(args.out or args.manifest_out).resolve()
if out.exists():raise SystemExit('Existing delivery is preserved; choose a new ZIP path.')
base_manifest=ROOT/'base/PACKAGE-MANIFEST.json'
if not base_manifest.is_file():raise SystemExit('Embed and verify the sealed Base v0.8.3 first.')
base=json.loads(base_manifest.read_text(encoding='utf-8'))
if base['extension']['version']!='0.8.3':raise SystemExit('Unexpected Base version')
allowed_dirs={'src','public','data','scripts','tests','docs','evidence','base','deploy','compat'}
allowed_files={'AGENTS.md','.gitignore','.dockerignore','README.md','package.json','server.mjs','START-UW.cmd','start-uw.sh','requirements-geodata.txt','DATA-MANIFEST.json','SOURCE-LOCK.json','LICENSES.md'}
files=[]
for top in sorted(ROOT.iterdir()):
    if top.name in allowed_dirs:
        for path in sorted(top.rglob('*')):
            if path.is_symlink():raise SystemExit('Refuse symlink: '+str(path))
            if not path.is_file():continue
            rel=path.relative_to(ROOT).as_posix()
            if '__pycache__' in path.parts or rel in {'data/campus-unsealed.json','scripts/import-local-visitor.mjs','scripts/native-campus.ps1'}:continue
            if any(part in {'.local','.private-inputs','.git','.env'} for part in path.parts):raise SystemExit('Private or unreviewed file in package input: '+rel)
            files.append((rel,path))
    elif top.name in allowed_files:files.append((top.name,top))
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
records=[{'path':name,'bytes':path.stat().st_size,'sha256':sha(path)} for name,path in files]
names={r['path'] for r in records}
for entry in base['files']:
    current=next((r for r in records if r['path']=='base/'+entry['path']),None)
    if not current or current['sha256']!=entry['sha256']:raise SystemExit('Embedded Base drift: '+entry['path'])
for p in ['README.md','START-UW.cmd','server.mjs','data/campus.json','data/space.json','src/base.mjs','base/DEVELOPMENT-MANUAL.md','base/SEALED-BASE-MANIFEST.json','public/app.js','public/inventory.html','deploy/Dockerfile','deploy/compose.yaml','docs/DEPLOY-UW.md']:
    if p not in names:raise SystemExit('Missing complete-package input: '+p)
manifest={'format':'hyper-dimension.school-delivery/v1','school':'uw-seattle','version':json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version'],'base':{'campusVersion':'0.8.3','coreVersion':'0.2.1','sourceArchiveSha256':'abc0f06baa8fc0b03d5335f56e39b4c310487269e8f83111debdda83a7eb2368','verifiedAdaptedPayloads':len(base['files']),'schoolAdaptation':base['schoolAdaptation']},'entrypoint':'README.md','files':records,'excluded':['sources/original PDFs and photographic references','full county terrain tile','.local','.tooling','.git','data/campus-unsealed.json','user credentials/state'],'scope':'UW unified metric pixel campus, color/depth tiles, shared materials, geometry-swept A* detours, preserved avatar/Hermes/A2A and native Base campus functions; offline legacy receipt compatibility; local Ubuntu fictional-account checks; no production UW/SMTP/TLS/merchant fulfillment claim'}
out.parent.mkdir(parents=True,exist_ok=True)
if args.manifest_out:
    manifest['deliveryType']='complete-source-directory-snapshot'
    with out.open('x',encoding='utf-8') as target:target.write(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'manifest':str(out),'payloads':len(files),'zipCreated':False,'version':manifest['version']}))
    raise SystemExit(0)
with out.open('xb') as target,zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
    for name,path in files:
        info=zipfile.ZipInfo(name,date_time=(2026,10,29,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
        with path.open('rb') as source,archive.open(info,'w') as dest:
            for chunk in iter(lambda:source.read(1024*1024),b''):dest.write(chunk)
    archive.writestr('PACKAGE-MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'archive':str(out),'bytes':out.stat().st_size,'sha256':sha(out),'entries':len(files)+1,'payloads':len(files)}))
