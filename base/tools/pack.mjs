import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { BASE_VERSION } from '../src/protocol/index.mjs';
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export const crc32 = (data) => {
  let c = 0xffffffff;
  for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export async function zipFiles(entries, out) {
  const chunks = [],
    central = [];
  let offset = 0;
  for (const [path, buffer] of entries) {
    if (path.startsWith('/') || path.split('/').some((p) => p === '..'))
      throw Error('Unsafe archive entry');
    const name = Buffer.from(path),
      data = deflateRawSync(buffer, { level: 6 }),
      crc = crc32(buffer),
      head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(33, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(buffer.length, 22);
    head.writeUInt16LE(name.length, 26);
    chunks.push(head, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(buffer.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += head.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...chunks, directory, end]);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, zip, { flag: 'wx' });
  return {
    path: out,
    files: entries.length,
    bytes: zip.length,
    sha256: createHash('sha256').update(zip).digest('hex'),
  };
}
async function walk(root, prefix = '') {
  const entries = [];
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = (prefix ? prefix + '/' : '') + item.name;
    if (
      basename(root) === 'integrations' &&
      /^(download-cache|hermes-cache)\//.test(path) &&
      !/^(download-cache|hermes-cache)\/README\.md$/.test(path)
    )
      continue;
    if (basename(root) === 'public' && path === 'vendor/vendor') continue; // blocked cleanup: redundant development copy, never a product dependency
    if (basename(root) === 'public' && path === 'vendor/three/three') continue; // redundant copy; cleanup denied, excluded without altering the retained files
    if (item.isSymbolicLink()) throw Error('Archive refuses symlinks: ' + path);
    if (item.isDirectory()) entries.push(...(await walk(root, path)));
    else if (item.isFile()) entries.push([path, await readFile(join(root, path))]);
  }
  return entries;
}
export async function packSource(root, out) {
  const entries = [];
  for (const path of [
    '.dockerignore',
    '.gitignore',
    '.gitattributes',
    '.prettierignore',
    '.prettierrc.json',
    'AGENTS.md',
    'AGENT-START.md',
    'DEVELOPMENT-MANUAL.md',
    'LICENSE',
    'README.md',
    'README.en.md',
    'package.json',
    'package-lock.json',
  ])
    entries.push([path, await readFile(join(root, path))]);
  for (const name of [
    'START-HERE.md',
    'PACKAGE-STRUCTURE.md',
    'M0-START.md',
    'M1-START.md',
    'M1-SOCIAL-START.md',
    'M2-START.md',
    'CAMPUS-START.md',
    'INTEGRATIONS-START.md',
  ]) {
    const bytes = await readFile(join(root, name)).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
      return null;
    });
    if (bytes) entries.push([name, bytes]);
  }
  // Campus sources keep their independent frontend lock; prebuilt public/admin is below.
  for (const name of [
    'admin/package.json',
    'admin/package-lock.json',
    'admin/index.jsx',
    'admin/build.mjs',
  ]) {
    const bytes = await readFile(join(root, name)).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
      return null;
    });
    if (bytes) entries.push([name, bytes]);
  }
  for (const dir of [
    'deploy',
    'docs',
    'src',
    'tools',
    'public',
    'assets',
    'examples',
    'schemas',
    'tests',
    'config',
    'database',
    'prompts',
    'templates',
    'integrations',
  ])
    entries.push(...(await walk(join(root, dir))).map(([path, data]) => [dir + '/' + path, data]));
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const manifest = {
    format: 'hyper-dimension.base.archive/v1',
    version: BASE_VERSION,
    files: entries.map(([path, data]) => ({
      path,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    })),
    excluded: [
      '.private-inputs',
      'projects',
      '.local',
      'node_modules',
      'qa',
      'dist',
      '.git',
      '.env',
    ],
  };
  entries.push(['MANIFEST.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]);
  return zipFiles(entries, out);
}

export async function collectComplete(root, { campus = false } = {}) {
  const entries = new Map();
  for (const name of [
    '.dockerignore',
    '.gitignore',
    '.gitattributes',
    '.prettierignore',
    '.prettierrc.json',
    'AGENTS.md',
    'AGENT-START.md',
    'DEVELOPMENT-MANUAL.md',
    'LICENSE',
    'README.md',
    'README.en.md',
    'START-HERE.md',
    'PACKAGE-STRUCTURE.md',
    'start-base.cmd',
    'start-base.sh',
    'requirements-embedding.txt',
    'package.json',
    'package-lock.json',
  ])
    entries.set(name, await readFile(join(root, name)));
  for (const dir of [
    'deploy',
    'docs',
    'src',
    'tools',
    'public',
    'assets',
    'examples',
    'schemas',
    'tests',
    'config',
    'database',
    'prompts',
    'templates',
    'integrations',
  ])
    for (const [path, data] of await walk(join(root, dir))) entries.set(dir + '/' + path, data);
  const requiredMissing = [];
  if (campus) {
    const entry = await readFile(join(root, 'INTEGRATIONS-START.md')).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
      return null;
    });
    if (entry) entries.set('INTEGRATIONS-START.md', entry);
    if (
      !(await readFile(join(root, 'evidence/integrations/ACCEPTANCE.md')).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
        return null;
      }))
    )
      requiredMissing.push('evidence/integrations/ACCEPTANCE.md');
    for (const required of [
      'DEVELOPMENT-MANUAL.md',
      'docs/DOCUMENTATION-MAP.json',
      'tools/verify-docs.mjs',
      'evidence/documentation/ACCEPTANCE.md',
      'docs/ANNUAL-OPERATIONS.md',
      'evidence/annual/ACCEPTANCE.md',
      'docs/ANNUAL-MATERIALS-AUDIT.md',
      'evidence/annual-materials/ACCEPTANCE.md',
      'tools/verify-annual-materials.py',
      'docs/RECEPTION-AND-NETWORK.md',
      'evidence/network/ACCEPTANCE.md',
      'evidence/hermes-sessions/ACCEPTANCE.md',
      'evidence/ubuntu-hermes/ACCEPTANCE.md',
    ]) {
      if (
        !(await readFile(join(root, required)).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
          return null;
        }))
      )
        requiredMissing.push(required);
    }
    for (const name of [
      'CAMPUS-START.md',
      'admin/package.json',
      'admin/package-lock.json',
      'admin/index.jsx',
      'admin/build.mjs',
    ])
      entries.set(name, await readFile(join(root, name)));
    const built = JSON.parse(await readFile(join(root, 'public/admin/build.json'), 'utf8'));
    const adminBundle = entries.get('public/admin/app.js');
    if (!adminBundle || createHash('sha256').update(adminBundle).digest('hex') !== built.sha256)
      throw Error('Admin browser bundle does not match build.json');
    if (!entries.has('public/admin/app.js.LEGAL.txt'))
      throw Error('Admin linked license notices missing');
    const adminLock = JSON.parse(await readFile(join(root, 'admin/package-lock.json'), 'utf8'));
    const licenses = [];
    for (const [path, meta] of Object.entries(adminLock.packages)) {
      if (!path.startsWith('node_modules/') || meta.dev) continue;
      const directory = join(root, 'admin', path),
        pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (pkg.version !== meta.version) throw Error('Admin dependency version mismatch: ' + path);
      const texts = [];
      for (const item of await readdir(directory, { withFileTypes: true })) {
        if (item.isFile() && /^(licen[sc]e|copying|notice)([._-]|$)/i.test(item.name))
          texts.push({ path: item.name, text: await readFile(join(directory, item.name), 'utf8') });
      }
      const license = meta.license || pkg.license;
      if (!license || license === 'UNLICENSED')
        throw Error('Admin dependency license unresolved: ' + path);
      if (!texts.length) throw Error('Admin dependency license text missing: ' + path);
      licenses.push({
        name: pkg.name,
        version: pkg.version,
        license,
        integrity: meta.integrity || null,
        texts,
      });
    }
    entries.set(
      'admin/THIRD-PARTY-LICENSES.json',
      Buffer.from(
        JSON.stringify(
          { format: 'hyper-dimension.admin-licenses/v1', dependencies: licenses },
          null,
          2,
        ) + '\n',
      ),
    );
    if (
      !(await readFile(join(root, 'evidence/campus/ACCEPTANCE.md')).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
        return null;
      }))
    )
      requiredMissing.push('evidence/campus/ACCEPTANCE.md');
  }
  const model = 'models/bge-small-zh-v1.5';
  const modelManifest = JSON.parse(
    await readFile(join(root, model, 'MODEL-MANIFEST.json'), 'utf8'),
  );
  for (const f of modelManifest.files) {
    const b = await readFile(join(root, model, f.path));
    if (createHash('sha256').update(b).digest('hex') !== f.sha256)
      throw Error('Model checksum mismatch');
    entries.set(model + '/' + f.path, b);
  }
  entries.set(
    model + '/MODEL-MANIFEST.json',
    Buffer.from(JSON.stringify(modelManifest, null, 2) + '\n'),
  );
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  for (const [path, meta] of Object.entries(lock.packages))
    if (path.startsWith('node_modules/') && !meta.dev)
      for (const [p, data] of await walk(join(root, path))) entries.set(path + '/' + p, data);
  try {
    for (const [path, data] of await walk(join(root, 'evidence')))
      entries.set('evidence/' + path, data);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const files = [...entries].sort((a, b) => a[0].localeCompare(b[0]));
  const m0 = await readFile(join(root, 'M0-START.md')).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  if (m0) files.push(['M0-START.md', m0]);
  const m1 = await readFile(join(root, 'M1-START.md')).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  if (m1) files.push(['M1-START.md', m1]);
  const social = await readFile(join(root, 'M1-SOCIAL-START.md')).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  if (social) files.push(['M1-SOCIAL-START.md', social]);
  const m2 = await readFile(join(root, 'M2-START.md')).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  if (m2) files.push(['M2-START.md', m2]);
  const manifest = {
    format: campus ? 'hyper-dimension.campus.complete/v1' : 'hyper-dimension.complete/v1',
    version: BASE_VERSION,
    ...(campus
      ? {
          campus: {
            status: requiredMissing.length ? 'candidate' : 'technical-accepted',
            entrypoint: 'CAMPUS-START.md',
            acceptance: 'evidence/documentation/ACCEPTANCE.md',
            runtimeAcceptance: 'evidence/ubuntu-hermes/ACCEPTANCE.md',
            developmentManual: 'DEVELOPMENT-MANUAL.md',
            documentationMap: 'docs/DOCUMENTATION-MAP.json',
            releaseType: 'documentation-and-packaging',
            runtimeBaselineVersion: '0.8.2',
            previousHermesAcceptance: 'evidence/hermes-sessions/ACCEPTANCE.md',
            receptionAndNetworkAcceptance: 'evidence/network/ACCEPTANCE.md',
            annualMaterialsAcceptance: 'evidence/annual-materials/ACCEPTANCE.md',
            annualAcceptance: 'evidence/annual/ACCEPTANCE.md',
            integrationAcceptance: 'evidence/integrations/ACCEPTANCE.md',
            retainedAcceptance: 'evidence/campus/ACCEPTANCE.md',
            productionReady: false,
            requiredMissing,
            sourceAndBrowserBundle: true,
            externalServicesBundled: false,
            containerBuildIncluded: true,
          },
        }
      : {}),
    ...(m0
      ? {
          extension: {
            id: campus
              ? 'hyper-dimension.campus/v1'
              : m2
                ? 'hyper-dimension.m2/v1'
                : m1
                  ? 'hyper-dimension.m1/v1'
                  : 'hyper-dimension.m0/v1',
            ...(campus
              ? {
                  status: requiredMissing.length ? 'candidate' : 'technical-accepted',
                  version: '0.8.3',
                  retainedMilestoneVersion: '0.5.0',
                }
              : { version: m2 ? '0.4.0' : social ? '0.3.0' : m1 ? '0.2.0' : '0.1.0' }),
            entrypoint: campus
              ? 'CAMPUS-START.md'
              : m2
                ? 'M2-START.md'
                : social
                  ? 'M1-SOCIAL-START.md'
                  : m1
                    ? 'M1-START.md'
                    : 'M0-START.md',
            productionReady: false,
            externalServices: ['Keycloak', 'Nakama', 'NodeBB', 'PostgreSQL', 'Java 21'],
            pinnedVersions: 'integrations/versions.json',
          },
        }
      : {}),
    files: files.map(([path, b]) => ({
      path,
      bytes: b.length,
      sha256: createHash('sha256').update(b).digest('hex'),
    })),
    includes: [
      'application source',
      'production Node dependencies',
      'Three.js',
      'three-vrm and original campus avatar assets',
      'pinned Chinese ONNX embedding model',
      'two fictional examples',
      'database SQL',
      'Agent prompts and documentation',
      ...(campus
        ? [
            'campus modules and migrations',
            'React-admin source, independent lock, browser bundle and dependency licenses',
            'pg-boss production package',
            'official A2A SDK, scoped business Agent client and Ubuntu full-stack Compose',
            'annual operations, scoped assignments, private opt-in planning and material conversion tools',
            'isolated reception sessions, opt-in campus discovery, mentor bookings and native-source career opportunities',
            'curated campus evidence when present',
          ]
        : []),
    ],
    requiresExternal: [
      'Node 22.13+ or 24 LTS',
      'Python + optional embedding requirements for local ONNX',
      'Hermes + model credentials for general reception',
      'PostgreSQL server only if selecting remote postgres',
      ...(campus
        ? [
            'Ubuntu PostgreSQL + pgvector, Java 21, Keycloak, Nakama and NodeBB for full campus mode',
            'SMTP/TLS/domain and private service configuration',
          ]
        : []),
    ],
    excluded: [
      'user projects',
      'source PDFs',
      'credentials',
      'user database/state',
      'development node_modules',
    ],
  };
  files.push(['PACKAGE-MANIFEST.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]);
  return { files, manifest, requiredMissing };
}

export async function packComplete(root, out, options = {}) {
  const { files, requiredMissing } = await collectComplete(root, options);
  if (requiredMissing.length)
    throw Error(
      'Campus packaging requires curated acceptance record: ' + requiredMissing.join(', '),
    );
  return zipFiles(files, out);
}
