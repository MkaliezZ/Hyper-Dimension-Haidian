"""Restore only fixed public dependency artifacts, never live user state."""
from pathlib import Path
import argparse,hashlib,json,subprocess,tempfile,urllib.request,zipfile

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
source=parser.add_mutually_exclusive_group(required=True)
source.add_argument('--delivery',type=Path)
source.add_argument('--fetch',action='store_true')
args=parser.parse_args()
records=json.loads((root/'SOURCE-DEPENDENCIES.json').read_text(encoding='utf-8'))['files']
allowed={'base/models/bge-small-zh-v1.5/model_quantized.onnx','base/integrations/hermes/source.tar.gz','base/integrations/hermes/uv-0.12.1-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl'}
assert {r['path'] for r in records}==allowed
def valid(data,row):return len(data)==row['bytes'] and hashlib.sha256(data).hexdigest()==row['sha256']
for row in records:
    dest=root/row['path']
    if dest.exists():
        if not valid(dest.read_bytes(),row):raise RuntimeError('Existing different file preserved: '+row['path'])
        print('Already verified: '+row['path']);continue
    if args.delivery:
        with zipfile.ZipFile(args.delivery) as archive:data=archive.read(row['path'])
    elif row['path'].endswith('.onnx'):
        url='https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/75c43b069aac4d136ba6bc1122f995fedcfd2781/onnx/model_quantized.onnx'
        with urllib.request.urlopen(url,timeout=180) as response:data=response.read(40*1024*1024)
    elif row['path'].endswith('.whl'):
        with urllib.request.urlopen('https://pypi.org/pypi/uv/0.12.1/json',timeout=60) as response:metadata=json.load(response)
        asset=next(f for f in metadata['urls'] if f['filename']==dest.name and f['digests']['sha256']==row['sha256'])
        with urllib.request.urlopen(asset['url'],timeout=180) as response:data=response.read(40*1024*1024)
    else:
        source=json.loads((root/'base/integrations/hermes/SOURCE.json').read_text(encoding='utf-8'))
        assert source['repository']=='https://github.com/NousResearch/hermes-agent'
        with tempfile.TemporaryDirectory(prefix='hermes-public-source-') as tmp:
            checkout=Path(tmp)/'source';checkout.mkdir()
            subprocess.run(['git','init','-q'],cwd=checkout,check=True)
            subprocess.run(['git','fetch','--depth','1',source['repository']+'.git',source['commit']],cwd=checkout,check=True)
            artifact=Path(tmp)/'source.tar.gz'
            subprocess.run(['git','archive','--format=tar.gz','--prefix=hermes/','--output',str(artifact),'FETCH_HEAD'],cwd=checkout,check=True)
            data=artifact.read_bytes()
    if not valid(data,row):raise RuntimeError('Dependency size/SHA-256 mismatch: '+row['path'])
    dest.parent.mkdir(parents=True,exist_ok=True)
    with dest.open('xb') as target:target.write(data)
    print('Restored verified public artifact: '+row['path'])
