import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only by default; an optional evidence file must be a new path.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out'))
  throw Error('verify-docs [--out NEW_REPORT_JSON]');
const map = JSON.parse(await readFile(resolve(root, 'docs/DOCUMENTATION-MAP.json'), 'utf8'));
const errors = [];
const texts = new Map();
const records = new Map(map.documents.map((d) => [d.path, d]));
const inside = (p) => p === root || p.startsWith(root + sep);
const fail = (message) => errors.push(message);
async function markdownFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Documentation refuses symlink: ' + path);
    if (entry.isDirectory()) paths.push(...(await markdownFiles(path)));
    else if (entry.isFile() && path.endsWith('.md'))
      paths.push(relative(root, path).split(sep).join('/'));
  }
  return paths;
}
function anchors(text) {
  const result = new Set([...text.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));
  const seen = new Map();
  for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const id = match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/[\p{P}\p{S}]/gu, (c) => (c === '-' || c === '_' ? c : ''))
      .trim()
      .toLowerCase()
      .replace(/\s/g, '-');
    const n = seen.get(id) || 0;
    seen.set(id, n + 1);
    result.add(id + (n ? '-' + n : ''));
  }
  return result;
}
async function textAt(path) {
  if (!texts.has(path)) texts.set(path, await readFile(path, 'utf8'));
  return texts.get(path);
}
if (map.format !== 'hyper-dimension.documentation/v1') fail('Unknown documentation map format');
if (records.size !== map.documents.length) fail('Duplicate documentation paths');
for (const file of [
  ...(await markdownFiles(resolve(root, 'docs'))),
  ...(await markdownFiles(resolve(root, 'prompts'))),
])
  if (!records.has(file)) fail('Unclassified document: ' + file);
let links = 0;
for (const item of map.documents) {
  const path = resolve(root, item.path);
  if (!inside(path)) {
    fail('Document escaped package: ' + item.path);
    continue;
  }
  let text;
  try {
    text = await textAt(path);
  } catch {
    fail('Missing document: ' + item.path);
    continue;
  }
  if (
    !['manual', 'entry', 'reference', 'task-checklist', 'historical', 'archived-contract'].includes(
      item.role,
    )
  )
    fail('Unknown document role: ' + item.path);
  if (
    ['historical', 'archived-contract'].includes(item.role) &&
    !text.slice(0, 700).includes('历史')
  )
    fail('Missing historical scope label: ' + item.path);
  if (map.entrypoints.includes(item.path) && !text.includes(map.manual))
    fail('Entry does not lead to manual: ' + item.path);
  // Code examples are not navigation links. External URLs are never fetched.
  const prose = text.replace(/```[^\n]*\n[\s\S]*?```/g, '');
  for (const match of prose.matchAll(/!?\[[^\]]*\]\(([^\n)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
    target = target.replace(/\s+["'][^]*$/, '');
    const [name, fragment] = target.split('#', 2);
    let destination;
    try {
      destination = resolve(dirname(path), decodeURIComponent(name || '.'));
    } catch {
      fail(item.path + ': invalid URL ' + target);
      continue;
    }
    if (!name) destination = path;
    if (!inside(destination)) {
      fail(item.path + ': outside-package link ' + target);
      continue;
    }
    links++;
    try {
      await stat(destination);
      if (
        fragment &&
        destination.endsWith('.md') &&
        !anchors(await textAt(destination)).has(decodeURIComponent(fragment))
      )
        fail(item.path + ': missing anchor ' + target);
    } catch {
      fail(item.path + ': missing link ' + target);
    }
  }
}
const manual = await textAt(resolve(root, map.manual));
if (!manual.includes('v' + map.campusVersion)) fail('Manual/map version mismatch');
const packer = await readFile(resolve(root, 'tools/pack.mjs'), 'utf8');
if (!packer.includes("version: '" + map.campusVersion + "'")) fail('Packer/map version mismatch');
for (const id of [
  'readers',
  'authority',
  'architecture',
  'environment',
  'school',
  'art',
  'reception',
  'development',
  'validation',
  'backup',
  'packaging',
  'handoff',
])
  if (!anchors(manual).has(id)) fail('Missing manual section: ' + id);
const report = {
  status: errors.length ? 'FAIL' : 'PASS',
  checkedAt: new Date().toISOString(),
  campusVersion: map.campusVersion,
  runtimeBaseline: map.runtimeBaseline,
  manual: map.manual,
  documents: records.size,
  localLinks: links,
  historicalDocuments: map.documents.filter((d) =>
    ['historical', 'archived-contract'].includes(d.role),
  ).length,
  externalLinksFetched: false,
  runtimeTestsPerformed: false,
  errors,
};
if (args.length) {
  const out = resolve(args[1]);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
