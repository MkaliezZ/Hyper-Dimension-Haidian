"""Local ONNX embedding only. No model code, tools, network downloads or user memory."""
import json
import os
import pathlib
import sys
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

request = json.load(sys.stdin)
root = pathlib.Path(os.environ['HDBASE_EMBED_MODEL'])
tokenizer = Tokenizer.from_file(str(root / 'tokenizer.json'))
tokenizer.enable_truncation(max_length=512)
tokenizer.enable_padding(pad_id=0, pad_token='[PAD]')
options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
session = ort.InferenceSession(str(root / 'model_quantized.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
vectors = []
texts = request['texts']
if request.get('query'):
    texts = ['为这个句子生成表示以用于检索相关文章：' + t for t in texts]
for start in range(0, len(texts), 16):
    encoded = tokenizer.encode_batch(texts[start:start+16])
    data = {
        'input_ids': np.array([e.ids for e in encoded], dtype=np.int64),
        'attention_mask': np.array([e.attention_mask for e in encoded], dtype=np.int64),
        'token_type_ids': np.array([e.type_ids for e in encoded], dtype=np.int64),
    }
    outputs = session.run(None, {i.name: data[i.name] for i in session.get_inputs()})
    embeddings = outputs[0][:, 0, :]
    embeddings /= np.maximum(np.linalg.norm(embeddings, axis=1, keepdims=True), 1e-12)
    vectors.extend(embeddings.tolist())
print(json.dumps({'vectors': vectors, 'runtime': 'onnx-cpu', 'dimensions': 512}))
