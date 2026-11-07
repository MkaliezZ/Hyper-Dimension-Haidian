"""Check Haidian against the sealed UW contract; no credentials or model calls."""
from pathlib import Path
import argparse,ast,csv,datetime,hashlib,json,re,urllib.request

ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--native-check',type=Path);p.add_argument('--origin',default='http://127.0.0.1:6290');p.add_argument('--out',type=Path,default=ROOT/'docs/HAIDIAN-FUNCTION-PARITY.json');a=p.parse_args()
read=lambda rel:(ROOT/rel).read_text(encoding='utf-8-sig')
baseline=json.loads(read('docs/UPSTREAM-SOURCE-MANIFEST.json'))
contract=json.loads(read('docs/UW-FUNCTION-CONTRACTS.json'))
missing=[];changed=[];identical=[];base=[]
for item in baseline['files']:
    path=ROOT/item['path']
    if not path.is_file():missing.append(item['path']);continue
    same=hashlib.sha256(path.read_bytes()).hexdigest()==item['sha256']
    (identical if same else changed).append(item['path'])
    if item['path'].startswith('base/'):
        assert same,'Canonical Base changed: '+item['path']
        base.append(item['path'])
assert not missing,missing
assert len(base)==538
server=read('server.mjs')
paths=sorted(set(re.findall(r"['\"]((?:/api/|/agents/|/\.well-known)[^'\"]*)['\"]",server)))
assert paths==contract['httpLiteralPaths'],'School HTTP contract changed'
dom=re.findall(r'\bid="([^"]+)"',read('public/index.html'))
assert len(set(dom))==len(dom),'Duplicate main-page IDs'
assert not set(contract['mainDomIds'])-set(dom),'Missing UW front-end controls'
block=re.search(r'const modules = (\[.*?\n\]);',read('src/campus-services.mjs'),re.S).group(1)
modules=ast.literal_eval(re.sub(r'\btrue\b','True',re.sub(r'\bnull\b','None',block)))
assert modules==contract['serviceModules'],'Campus modules or original role gates changed'
features={npc:dict(re.findall(r"\b(module|type|base):'([^']+)'",body)) for npc,body in re.findall(r'^\s*(maya|leo|jordan|sam|aiko|alex):\{.*?feature:\{([^}]+)\}',read('src/npc-cast.mjs'),re.M)}
assert features==contract['npcFeatures'],'NPC service buttons changed'
for item in contract['sharedSourceHashes']:
    rel,sha=item['path'],item['sha256']
    assert hashlib.sha256((ROOT/rel).read_bytes()).hexdigest()==sha,'Shared behavior changed: '+rel
rows=list(csv.DictReader(read('docs/BASE-FEATURE-AUDIT-20261102.csv').splitlines()))
matrix=[]
for row in rows:
    state='paused' if row['编号'] in {'B3-16','B4-08'} else 'removed' if row['编号']=='B2-10' else 'retained'
    source=row['源码或当前文档'];assert (ROOT/source).is_file(),source
    matrix.append({'id':row['编号'],'priority':row['优先级'],'name':row['功能'],'state':state,'source':source,'validation':'source retained; current tests and runtime coverage are reported separately'})
assert len(matrix)==45 and sum(x['state']=='retained' for x in matrix)==42
native={'state':'NOT_RUN'}
if a.native_check:
    raw=json.loads(a.native_check.read_text(encoding='utf-8'))
    assert raw['status']=='PASS' and raw['modules']==23 and raw['school']=='haidian'
    assert len(raw['opened'])==23 and all(x['status']==200 for x in raw['opened'])
    assert a.origin in {'http://127.0.0.1:6290','http://localhost:6290'},'Only the designated local native instance is allowed'
    health=json.load(urllib.request.urlopen(a.origin+'/health',timeout=10))
    assert health['schoolId']=='haidian' and health['nativeCampus'] and health['provider']=='hermes'
    assert health['receptionModel']=='deepseek-flash' and health['npcModel']=='deepseek-flash'
    native={'state':'PASS','at':raw['at'],'checks':raw['checks'],'modules':raw['opened'],'health':{k:health[k] for k in ['version','provider','generalConversation','receptionModel','npcProvider','npcModel','geometryHash']}}
result={'format':'haidian.function-parity/v1','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS' if a.native_check else 'SOURCE_PASS','applicationVersion':json.loads(read('package.json'))['version'],'upstreamVersion':'UW 0.11.3','upstreamCommit':contract['upstreamCommit'],'missingUpstreamFiles':missing,'upstreamFiles':len(baseline['files']),'identicalUpstreamFiles':len(identical),'baseFilesUnchanged':len(base),'adaptedUpstreamFiles':changed,'httpLiteralContracts':len(paths),'mainControlsRetained':len(contract['mainDomIds']),'campusModules':len(modules),'npcFunctionButtons':len(features),'sharedBehaviorHashes':len(contract['sharedSourceHashes']),'activePlannedFunctions':42,'matrix':matrix,'runtime':native,'scope':'Source and interface parity; no claim of repeating every business operation, production acceptance or external merchant fulfillment.'}
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:result[k] for k in ['status','upstreamFiles','identicalUpstreamFiles','baseFilesUnchanged','httpLiteralContracts','mainControlsRetained','campusModules','npcFunctionButtons','activePlannedFunctions']},ensure_ascii=False))
