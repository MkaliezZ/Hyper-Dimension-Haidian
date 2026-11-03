"""Fetch a pinned, small MIT Chinese embedding model into this project, not a user cache."""
import hashlib
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = ROOT / 'models/bge-small-zh-v1.5'
REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781'
REPO = 'Xenova/bge-small-zh-v1.5'
EXPECTED_MODEL_SHA = '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc'

def download(url, dest):
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(40 * 1024 * 1024)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.read_bytes() != data:
        raise RuntimeError('Existing different model file preserved: ' + str(dest))
    dest.write_bytes(data)
    return data

files = []
for remote, name in [('onnx/model_quantized.onnx', 'model_quantized.onnx'), ('tokenizer.json', 'tokenizer.json'), ('config.json', 'config.json'), ('README.md', 'CONVERSION-README.md')]:
    data = download(f'https://huggingface.co/{REPO}/resolve/{REVISION}/{remote}', DEST / name)
    sha = hashlib.sha256(data).hexdigest()
    if remote.endswith('.onnx') and sha != EXPECTED_MODEL_SHA:
        raise RuntimeError('Model checksum mismatch; do not use downloaded model')
    files.append({'path': name, 'bytes': len(data), 'sha256': sha})

upstream = json.load(urllib.request.urlopen('https://huggingface.co/api/models/BAAI/bge-small-zh-v1.5', timeout=30))
license_data = download(f'https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/{upstream["sha"]}/README.md', DEST / 'UPSTREAM-MODEL-CARD.md')
download('https://raw.githubusercontent.com/FlagOpen/FlagEmbedding/master/LICENSE', DEST / 'LICENSE')
for name in ['UPSTREAM-MODEL-CARD.md', 'LICENSE']:
    data = (DEST / name).read_bytes()
    files.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
manifest = {'model': 'BAAI/bge-small-zh-v1.5', 'conversion': REPO, 'revision': REVISION, 'license': 'MIT', 'pooling': 'CLS', 'dimensions': 512, 'normalization': 'L2', 'queryPrefix': '为这个句子生成表示以用于检索相关文章：', 'files': files}
manifest['licenseSource'] = 'https://github.com/FlagOpen/FlagEmbedding/blob/master/LICENSE'
(DEST / 'MODEL-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'directory': str(DEST), 'model': manifest['model'], 'bytes': sum(f['bytes'] for f in files), 'sha256': EXPECTED_MODEL_SHA}))
