"""Create a sanitized school source package; preserve old deliveries and private state."""
import argparse,hashlib,json,pathlib,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--out',type=pathlib.Path);p.add_argument('--source-manifest',action='store_true');p.add_argument('--include-evidence',action='store_true',help='Explicitly include reviewed local evidence in an archive; not for Git source.');a=p.parse_args()
if not a.out and not a.source_manifest:p.error('Use --source-manifest or --out <new.zip>')
dirs={'base','public','src','data','scripts','tests','docs','deploy','compat','evidence'}
skip={'.git','.local','.private-inputs','.tooling','node_modules','__pycache__','.ruff_cache','sources'}
files=[]
for top in sorted(ROOT.iterdir()):
 if top.name in skip:continue
 candidates=top.rglob('*') if top.is_dir() and top.name in dirs else [top] if top.is_file() else []
 for f in sorted(candidates):
  if not f.is_file() or any(part in skip for part in f.relative_to(ROOT).parts):continue
  if f.is_symlink():raise SystemExit('Refuse symlink: '+str(f))
  rel=f.relative_to(ROOT).as_posix()
  if rel=='SOURCE-MANIFEST.json' or rel.startswith('base/admin/dist/'):continue
  if not a.include_evidence and (rel.startswith('evidence/') or rel.startswith('base/evidence/')) and rel not in {'evidence/README.md','base/evidence/README.md'}:continue
  if rel.endswith(('.log','.env','.key')) or f.name in {'reception.json.private','native-campus.ps1'}:raise SystemExit('Private/unreviewed file in package input: '+rel)
  b=f.read_bytes();files.append({'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
version=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
manifest={'format':'hyper-dimension.git-source/v1','application':'Hyper Dimension Haidian','applicationVersion':version,'upstreamVersion':'UW 0.11.3','upstreamCommit':'665297ab983fb702c034a25f33688f0be91a98c1','privateStateIncluded':False,'nodeModulesIncluded':False,'runtimeEvidenceIncluded':a.include_evidence,'files':files}
if a.source_manifest:(ROOT/'SOURCE-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if a.out:
 out=a.out.resolve()
 if out.exists():raise SystemExit('Existing delivery preserved; choose a new path')
 if not (ROOT/'SOURCE-MANIFEST.json').exists():raise SystemExit('Generate source manifest first')
 actual=json.loads((ROOT/'SOURCE-MANIFEST.json').read_text(encoding='utf-8'))
 if actual['files']!=files:raise SystemExit('Source changed; regenerate manifest before packaging')
 out.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(out,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for f in files:z.write(ROOT/f['path'],'Hyper-Dimension-Haidian/'+f['path'])
  z.write(ROOT/'SOURCE-MANIFEST.json','Hyper-Dimension-Haidian/SOURCE-MANIFEST.json')
 with zipfile.ZipFile(out) as z:
  if z.testzip():raise SystemExit('ZIP CRC failure')
 sha=hashlib.sha256(out.read_bytes()).hexdigest();out.with_suffix(out.suffix+'.sha256').write_text(sha+'  '+out.name+'\n',encoding='ascii')
 print(json.dumps({'status':'PASS','archive':str(out),'files':len(files)+1,'bytes':out.stat().st_size,'sha256':sha,'privateStateIncluded':False}))
else:print(json.dumps({'status':'PASS','sourceFiles':len(files)}))
