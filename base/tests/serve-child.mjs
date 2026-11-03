import { startServer } from '../src/server.mjs';
import { exampleScene, packageFor } from '../tools/fixtures.mjs';
import { peerCapability } from '../examples/peer-capability.mjs';
const id = process.env.TEST_SPACE,
  pack = packageFor(exampleScene(id + '-hall'), id, id + ' 示例');
let capabilities = {};
if (process.env.TEST_PEER) {
  pack.agents[0].skills.push('campus.ask-peer');
  capabilities['campus.ask-peer'] = peerCapability({
    url: process.env.TEST_PEER,
    token: process.env.TEST_PEER_TOKEN,
    agentId: 'south-reception',
    allowedOrigins: [process.env.TEST_PEER],
  });
}
const server = await startServer({
  root: process.cwd(),
  packs: [pack],
  dataDir: process.env.TEST_DATA,
  port: 0,
  provider: null,
  capabilities,
});
if (process.env.TEST_PEER) server.auth.access.tokens[0].principal.scopes.push('peer:call');
process.send({
  origin: server.origin,
  token: server.auth.access.tokens[0].token,
  pid: process.pid,
});
process.on('message', (message) => {
  if (message === 'close') void server.close().then(() => process.exit(0));
});
