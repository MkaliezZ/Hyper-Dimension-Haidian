// Isolated automated-test SMTP sink. Not a production mail service.
import net from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
const dir = process.env.HD_M1_MAIL;
if (!dir) throw Error('HD_M1_MAIL must be a private test-only directory');
await mkdir(dir, { recursive: true, mode: 0o700 });
let n = 0;
net
  .createServer((s) => {
    let input = '',
      data = false,
      mail = '';
    s.write('220 M1 test SMTP\r\n');
    s.on('data', (b) => {
      input += b;
      let i;
      while ((i = input.indexOf('\r\n')) >= 0) {
        const line = input.slice(0, i);
        input = input.slice(i + 2);
        if (data) {
          if (line === '.') {
            data = false;
            writeFile(dir + '/' + Date.now() + '-' + n++ + '.eml', mail, { mode: 0o600 }).then(() =>
              s.write('250 saved\r\n'),
            );
            mail = '';
          } else mail += line + '\r\n';
        } else if (/^EHLO|^HELO/i.test(line)) s.write('250 localhost\r\n');
        else if (/^DATA/i.test(line)) {
          data = true;
          s.write('354 continue\r\n');
        } else if (/^QUIT/i.test(line)) {
          s.end('221 bye\r\n');
        } else s.write('250 OK\r\n');
      }
    });
  })
  .listen(2525, '127.0.0.1', () =>
    console.log('M1 loopback test SMTP ready; no external mail sent'),
  );
