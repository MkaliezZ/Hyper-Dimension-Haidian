import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
if(process.env.HD_M1_TEST_FIXTURE!=='1')throw Error('Explicit isolated fixture deployment required');
const stamp=JSON.parse(await readFile('/runtime/initialized.json','utf8'));
const config=JSON.parse(await readFile(process.env.HD_M0_CONFIG,'utf8'));
if(!stamp.fixtureOnly||!stamp.schoolDefinitionsHash||config.schools.length!==1||config.schools[0].schoolId!=='haidian'||config.schools[0].spaceId!=='haidian-beijing')throw Error('Dedicated UW fixture required');
// Only the documented first-owner bootstrap can grant ownership. Ordinary members
// join through the real invitation APIs during verification.
const p=spawn(process.execPath,['/app/tools/m1-bootstrap-owner.mjs','--school','haidian','--username','moda'],{stdio:'inherit',env:process.env});
const code=await new Promise((r,j)=>{p.once('error',j);p.once('exit',r);});
if(code!==0)throw Error('Fixture owner bootstrap failed; existing memberships preserved');
console.log('Fictional local UW operator seeded. This is not an official UW account.');
