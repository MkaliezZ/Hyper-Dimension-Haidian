import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const out = new URL('../public/admin/', import.meta.url);
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['index.jsx'],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: 'es2022',
  outfile: fileURLToPath(new URL('app.js', out)),
  legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
});
await writeFile(
  new URL('build.json', out),
  JSON.stringify(
    {
      source: 'admin/index.jsx',
      reactAdmin: '5.15.5',
      sha256: createHash('sha256')
        .update(await readFile(new URL('app.js', out)))
        .digest('hex'),
    },
    null,
    2,
  ) + '\n',
);
console.log('Built local React-admin open-source console');
