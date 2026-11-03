import { readFile } from 'node:fs/promises';
import { validateAnnualDocument } from '../src/platform/annual-contract.mjs';
if (!process.argv[2]) throw Error('annual-validate.mjs REVIEWED_DOCUMENT.json');
const d = validateAnnualDocument(JSON.parse(await readFile(process.argv[2], 'utf8')));
console.log(
  JSON.stringify({
    status: 'VALID_STRUCTURE_NOT_SCHOOL_APPROVAL',
    packageId: d.packageId,
    version: d.version,
    entries: d.entries.length,
    cohorts: d.cohorts.length,
    references: d.references.length,
    publishesContent: false,
  }),
);
