import assert from 'node:assert/strict';
import { safeWorkLink } from '../src/platform/personal.mjs';
assert.equal(safeWorkLink(''), '');
assert.equal(
  safeWorkLink('https://example.com/my-project?q=campus#demo'),
  'https://example.com/my-project?q=campus#demo',
);
for (const link of [
  'javascript:alert(1)',
  'data:text/html,hello',
  'http://example.com',
  'https://localhost',
  'https://service.local',
  'https://127.0.0.1',
  'https://2130706433',
  'https://0x7f000001',
  'https://[::1]',
  'https://name:secret@example.com',
  'https://example.com:8000',
  'https://example.com\\@localhost',
  'https://example.com/\n',
  'https://example.com/ test',
]) {
  assert.throws(() => safeWorkLink(link), /work_link_invalid/, link);
}
console.log(
  'PASS personal safe external links reject active schemes, credentials, local/IP hosts and control characters',
);
