import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if(existsSync(resolve(projectRoot,'PACKAGE-MANIFEST.json')) && !process.env.HD_BASE_ROOT && !existsSync(resolve(projectRoot,'base/src/protocol/index.mjs')))throw Error('Incomplete UW package: embedded Base is missing.');
export const baseRoot = resolve(process.env.HD_BASE_ROOT || (
  existsSync(resolve(projectRoot, 'base/src/protocol/index.mjs'))
    ? resolve(projectRoot, 'base')
    : resolve(projectRoot, '../hyper-dimension-base-integrations')
));
if (!existsSync(resolve(baseRoot, 'src/protocol/index.mjs')))
  throw Error('Missing Hyper Dimension Base. Extract the complete UW package or set HD_BASE_ROOT.');
const load = (file) => import(pathToFileURL(resolve(baseRoot, file)).href);
export const protocol = await load('src/protocol/index.mjs');
export const { openStore } = await load('src/core/store.mjs');
export const { loadAccess } = await load('src/core/auth.mjs');
export const { createGateway } = await load('src/a2a/gateway.mjs');
export const { createReception } = await load('src/reception/index.mjs');
export const { configuredHermes } = await load('src/reception/hermes.mjs');
export const { openKnowledge } = await load('src/knowledge/index.mjs');

if (protocol.BASE_VERSION !== '0.2.1')
  throw Error('This school adapter requires the validated Base core 0.2.1 contract.');
