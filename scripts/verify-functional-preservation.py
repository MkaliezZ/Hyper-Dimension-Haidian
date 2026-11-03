"""Read-only comparison against sealed school/Base deliveries; writes QA evidence only."""
import argparse, datetime, hashlib, json
from pathlib import Path
uw=Path(__file__).resolve().parents[1]
root=uw.parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--out',type=Path,help='New evidence JSON only; existing files are refused')
args=parser.parse_args()
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1048576),b''):h.update(b)
    return h.hexdigest()
old=json.loads((root/'outputs/Hyper-Dimension-UW-MVP/2026-10-28/v0.1.0/preservation.json').read_text(encoding='utf-8-sig'))
records=[]
for value in old.values():
    if isinstance(value,list):
        records.extend(r for r in value if isinstance(r,dict) and 'path' in r and 'sha256' in r)
changed=[r['path'] for r in records if not Path(r['path']).is_file() or sha(Path(r['path']))!=r['sha256']]
archive=root/'outputs/Hyper-Dimension-UW-MVP/2026-10-28/v0.1.0/UW-Hyper-Dimension-MVP-v0.1.0-complete.zip'
archive_ok=sha(archive)=='2818a4c7952a77874156bb3672b00972a423fff691273df403aedb09711c712a'
baseline=json.loads((root/'outputs/Hyper-Dimension-UW-MVP/2026-10-28/v0.2.0/SOURCE-MANIFEST.json').read_text(encoding='utf-8-sig'))
base=[r for r in baseline['files'] if r['path'].startswith('base/') or r['path'] in ['data/campus.json','public/art-scene.js']]
base_changed=[r['path'] for r in base if sha(uw/r['path'])!=r['sha256']]
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'protectedBaselineRecordsChecked':len(records),'changed':changed,'sealedUwV010Unchanged':archive_ok,'embeddedBaseAndArtGeometryFilesChecked':len(base),'changedEmbeddedBaseArtGeometry':base_changed,'newZipCreated':False}
if args.out:
    with args.out.open('x',encoding='utf8') as f:f.write(json.dumps(result,indent=2)+'\n')
print(json.dumps(result));assert records and archive_ok and not changed and not base_changed
