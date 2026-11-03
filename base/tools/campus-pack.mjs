import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { collectComplete, zipFiles } from './pack.mjs';
const args = process.argv.slice(2);
if (args.length !== 2 || !['--plan', '--out'].includes(args[0]))
  throw Error(
    'campus-pack --plan NEW_MANIFEST_JSON | --out NEW_ZIP_PATH; existing files are never overwritten',
  );
const target = resolve(args[1]);
const { files, manifest, requiredMissing } = await collectComplete(process.cwd(), { campus: true });
if (args[0] === '--plan') {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify(
      {
        ...manifest,
        planOnly: true,
        archiveWritten: false,
        totalBytes: files.reduce((n, [, b]) => n + b.length, 0),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify(
      { plan: target, files: files.length, requiredMissing, archiveWritten: false },
      null,
      2,
    ),
  );
} else {
  if (requiredMissing.length)
    throw Error(
      'Curated campus acceptance record required before packaging: ' + requiredMissing.join(', '),
    );
  console.log(JSON.stringify(await zipFiles(files, target), null, 2));
}
