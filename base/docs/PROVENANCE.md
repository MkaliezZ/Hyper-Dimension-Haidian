# Provenance and licenses

## Campus candidate additions

The current campus package preserves prior catalogs and notices. `assets/avatars/v2/catalog.json` describes the additive original 38-entry catalog, and `assets/avatars/v3/catalog.json` describes the additive reward-gated catalog. Their deterministic geometry, generated part hashes and compatibility checks remain separate from the byte-preserved v1 assets. All these original assets and generators use MIT; no external character pack was imported.

- React-admin **5.15.5**, React **19.2.0**, and the administrator build tree are pinned in `admin/package-lock.json`. Source and build instructions are included. The complete campus packaging step records every bundled production frontend dependency's declared license, integrity and license text in `admin/THIRD-PARTY-LICENSES.json`; `public/admin/app.js.LEGAL.txt` preserves linked bundle notices. This is the open-source React-admin edition, not an enterprise license.
- pg-boss **12.38.0 / MIT** is a production dependency. The full package retains its package and upstream license under `node_modules/pg-boss`; its durable scheduling augments, rather than replaces, the transactional outbox authority.
- The controlled NodeBB plugin source and `integrations/nodebb/LICENSE` are **GPL-3.0-only**. NodeBB **4.16.3** remains a separately installed upstream service with fixed commit and lock. Its upstream source is not represented as Base MIT code. Keycloak **26.8.1 / Apache-2.0** and Nakama **3.41.0 / Apache-2.0** are also separately installed services. The original Keycloak theme retains its source and notice.
- The tested native knowledge storage is PostgreSQL **18.6** plus pgvector **0.8.1**, under their PostgreSQL licenses. These server installations are not copied into the public ZIP. PGlite's existing local distributions and notices remain included as described below.

Exact runtime pins are in `integrations/versions.json`. Real model credentials, source drawings, school databases and private service configurations remain excluded. A package/hash check does not imply a real school's acceptance or production certification.

## From the original Hyper Dimension code

`src/core/atomic-json.mjs` was extracted from the MIT-licensed `island/server/atomicJson.mjs` in the existing Hyper Dimension source checkout. It retains bounded Windows file-sharing retries, fsync/rename atomic replacement and owned-lock cleanup. The existing game and its sealed V362 delivery were not edited.

Stable identity, A2A ownership, durable receipts and public/private capability boundaries informed this Base. The Base gateway, store facade, spatial format, generator, HTTP adapter, reference frontend, Agent workflow and examples were written independently for this application-neutral package. No old-game runtime, artwork, save, personal configuration or dependency path is required.

The MIT LICENSE retains the original attribution. This is a focused extraction plus new implementation, not a claim that the entire game was already a clean reusable library.

## Third party

- M2 adds @pixiv/three-vrm **3.5.4 / MIT**, with its upstream LICENSE retained under public/vendor/vrm and the production dependency tree. Three.js remains **0.186.1**, now a production dependency for deterministic server-side geometry generation. The 24 campus part assets, four preset models, editor, rig and clips are original Base geometry under MIT; per-part provenance, bone compatibility and SHA-256 are in assets/avatars/catalog.json. No upstream CharacterStudio model pack is included. VRM metadata permits corporate use and redistribution; model/license notices remain in the package. See docs/M2.md for rigid attachment and arbitrary-import limits.

- Three.js 0.186.1 — MIT. Local browser distribution and its LICENSE in `public/vendor/three/`. [Official project](https://github.com/mrdoob/three).
- @a2a-js/sdk 1.3.0 — Apache-2.0, production dependency for the scoped partner Agent client and interoperability checks. The original package, license and dependencies are shipped inside node_modules. [Official project](https://github.com/a2aproject/a2a-js).
- playwright-core 1.63.0 — Apache-2.0, development/test-only. Browser executable supplied separately by the tester.

Original fictional fixture plans, generic poster illustrations and parametric models are included in Base's MIT source. User input drawings, real school materials and their derived private project remain outside the public archive; no rights claim is made over them.

## Complete package additions (0.2.0)

- PGlite 0.5.11: existing embedded PostgreSQL/WASM implementation, Apache-2.0 / PostgreSQL licensing; pgvector extension package 0.0.12. Runtime distribution and upstream notices are included under node_modules.
- node-postgres (`pg`) 8.23.1 and its production dependency tree: upstream licenses retained with each package. The remote PostgreSQL connector is optional.
- BAAI/bge-small-zh-v1.5, MIT; ONNX conversion Xenova/bge-small-zh-v1.5 at revision 75c43b069aac4d136ba6bc1122f995fedcfd2781. Quantized weights SHA-256 15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc. Model cards, upstream license and per-file hashes are included in models/bge-small-zh-v1.5. The model is not Base-authored artwork or user knowledge.
- Python embedding dependencies are specified separately, not copied from a personal Python environment. No Hermes installation, personal memory, provider credential, user database or source PDF is bundled.
