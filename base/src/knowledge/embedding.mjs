import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digest, fail } from '../protocol/index.mjs';
import { limitEmbedding } from './limit.mjs';

export function normalize(vector) {
  if (
    !Array.isArray(vector) ||
    vector.length < 2 ||
    vector.length > 4096 ||
    vector.some((v) => !Number.isFinite(v))
  )
    fail('invalid_vector', 'Invalid embedding vector');
  const norm = Math.hypot(...vector);
  if (norm < 1e-10) fail('invalid_vector', 'Zero embedding vector');
  return vector.map((v) => v / norm);
}
export async function createEmbedding(config, root = process.cwd()) {
  const engine = await createRawEmbedding(config, root);
  return {
    ...engine,
    embed: limitEmbedding(engine.embed, {
      concurrency: config.maxConcurrency ?? 1,
      maxQueued: config.maxQueued ?? 16,
    }),
  };
}
async function createRawEmbedding(config, root = process.cwd()) {
  if (config.provider === 'onnx') {
    const python = resolve(config.python || ''),
      modelDir = resolve(root, config.modelDir || 'models/bge-small-zh-v1.5');
    await stat(python);
    const manifest = JSON.parse(await readFile(join(modelDir, 'MODEL-MANIFEST.json'), 'utf8'));
    for (const name of ['model_quantized.onnx', 'tokenizer.json']) {
      const record = manifest.files.find((f) => f.path === name);
      const bytes = await readFile(join(modelDir, name));
      if (!record || createHash('sha256').update(bytes).digest('hex') !== record.sha256)
        fail('embedding_model', 'Embedding model integrity check failed');
    }
    const identity = digest({
      provider: 'onnx',
      model: manifest.model,
      revision: manifest.revision,
      files: manifest.files,
      pooling: 'CLS-L2-query-prefix-v1',
    });
    return {
      identity,
      model: manifest.model,
      dimensions: manifest.dimensions,
      async embed(texts, { query = false, signal } = {}) {
        if (signal?.aborted) throw signal.reason;
        const env = {
          HDBASE_EMBED_MODEL: modelDir,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONDONTWRITEBYTECODE: '1',
          TOKENIZERS_PARALLELISM: 'false',
          OMP_NUM_THREADS: '2',
        };
        for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'])
          if (process.env[key]) env[key] = process.env[key];
        const output = await new Promise((accept, reject) => {
          const child = spawn(
            python,
            [fileURLToPath(new URL('./embed_bridge.py', import.meta.url))],
            { env, cwd: modelDir, shell: false, windowsHide: true },
          );
          const chunks = [];
          let size = 0,
            settled = false;
          const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (error) {
              child.kill();
              reject(error);
            } else accept(value);
          };
          const abort = () =>
            finish(Object.assign(Error('Embedding canceled'), { code: 'embedding_unavailable' }));
          const timer = setTimeout(
            () =>
              finish(
                Object.assign(Error('Embedding request timed out'), {
                  code: 'embedding_unavailable',
                }),
              ),
            30000,
          );
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
          child.on('error', () =>
            finish(
              Object.assign(Error('Embedding runtime unavailable'), {
                code: 'embedding_unavailable',
              }),
            ),
          );
          child.stderr.resume();
          child.stdout.on('data', (b) => {
            size += b.length;
            if (size > 8 * 1024 * 1024) return finish(Error('Embedding output limit'));
            chunks.push(b);
          });
          child.on('close', (code) =>
            code === 0
              ? finish(null, Buffer.concat(chunks).toString('utf8'))
              : finish(
                  Object.assign(Error('Embedding runtime failed; check Python dependencies'), {
                    code: 'embedding_unavailable',
                  }),
                ),
          );
          child.stdin.on('error', () => {});
          child.stdin.end(JSON.stringify({ texts, query }));
        });
        const data = JSON.parse(output);
        if (data.vectors?.length !== texts.length)
          fail('invalid_vector', 'Embedding count mismatch');
        return data.vectors.map((v) => {
          if (v.length !== manifest.dimensions)
            fail('invalid_vector', 'Embedding dimensions mismatch');
          return normalize(v);
        });
      },
    };
  }
  if (['ollama', 'http'].includes(config.provider)) {
    const endpoint = new URL(config.endpoint);
    if (
      endpoint.protocol !== 'https:' &&
      !(
        endpoint.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
      )
    )
      fail('embedding_config', 'Embedding endpoint requires HTTPS or loopback HTTP');
    if (endpoint.username || endpoint.password)
      fail('embedding_config', 'Do not put credentials in URL');
    const dimensions = config.dimensions;
    if (!Number.isSafeInteger(dimensions) || dimensions < 2 || dimensions > 4096)
      fail('embedding_config', 'Set embedding dimensions');
    return {
      identity: digest({
        provider: config.provider,
        model: config.model,
        endpoint: endpoint.href,
        dimensions,
      }),
      model: config.model,
      dimensions,
      async embed(texts, { signal } = {}) {
        const key = config.apiKeyEnv ? process.env[config.apiKeyEnv] : null;
        if (config.apiKeyEnv && !key)
          fail('embedding_config', 'Embedding API key environment is missing');
        const response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            ...(key ? { Authorization: 'Bearer ' + key } : {}),
          },
          signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
          body: JSON.stringify({
            model: config.model,
            input: texts,
            ...(config.provider === 'http' ? { encoding_format: 'float', dimensions } : {}),
            ...(config.provider === 'ollama' ? { truncate: false } : {}),
          }),
        });
        if (!response.ok) fail('embedding_unavailable', 'Embedding API request failed', 502);
        const data = await response.json();
        const vectors =
          config.provider === 'ollama'
            ? data.embeddings
            : data.data?.sort((a, b) => a.index - b.index).map((r) => r.embedding);
        if (vectors?.length !== texts.length) fail('invalid_vector', 'Embedding count mismatch');
        return vectors.map((v) => {
          if (v.length !== dimensions) fail('invalid_vector', 'Embedding dimensions mismatch');
          return normalize(v);
        });
      },
    };
  }
  fail('embedding_config', 'Unknown embedding provider');
}
