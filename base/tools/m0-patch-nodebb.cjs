const fs = require('node:fs'),
  path = require('node:path');
const root = process.argv[2];
if (!root) throw Error('Pass the isolated NodeBB root');
const d = JSON.parse(fs.readFileSync(path.join(root, 'install/package.json')));
if (d.version !== '4.16.3') throw Error('Unexpected NodeBB version; revalidate before upgrading');
d.dependencies['sanitize-html'] = '2.18.1';
d.dependencies.sharp = '0.35.5';
d.overrides = { ...d.overrides, lodash: '4.18.1', fflate: '0.8.3' };
d.dependencies['nodebb-plugin-hd-base'] = 'file:./hd-plugin';
fs.cpSync(path.resolve(__dirname, '../integrations/nodebb'), path.join(root, 'hd-plugin'), {
  recursive: true,
});
const installed = path.join(root, 'node_modules/nodebb-plugin-hd-base');
if (
  fs.existsSync(installed) &&
  fs.realpathSync(installed) !== fs.realpathSync(path.join(root, 'hd-plugin'))
)
  fs.cpSync(path.join(root, 'hd-plugin'), installed, { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(d, null, 2) + '\n');
