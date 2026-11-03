# Hyper Dimension Base

## Current campus delivery · v0.8.3

The shared [development manual](DEVELOPMENT-MANUAL.md) is the primary workflow for humans and Agents. This documentation/packaging release retains the v0.8.2 runtime and its separately labelled evidence. Historical milestone limits do not describe current campus capabilities.

Start with [CAMPUS-START.md](CAMPUS-START.md) and [deployment](docs/DEPLOYMENT.md). This worktree adds the four Base campus P0 modules: scoped accounts and permissions; versioned avatars, inventories and profiles; native forums, activities, reviewed scoring, rewards and operations; and partner services. The Ubuntu stack uses PostgreSQL, Keycloak, Nakama and NodeBB. The browser administrator interface includes React-admin source, its independent lock and a prebuilt bundle. Application production dependencies and their notices are included in the complete campus package; external services, private credentials and user databases are not.

`npm start` still launches the lightweight Base-1 space demonstration only. The instructions below describe that retained mode. Current documentation acceptance is in `evidence/documentation/ACCEPTANCE.md`; inherited Ubuntu/Hermes execution is in `evidence/ubuntu-hermes/ACCEPTANCE.md`. Earlier campus acceptance remains historical evidence, not a fresh test of this release. Existing core version 0.2.1 and prior milestone archives remain unchanged.

Reception supports general conversation, follow-ups and cited public-space answers. Local Hermes uses online DeepSeek Flash in a zero-tool context. Version 0.2.0 adds PostgreSQL/pgvector knowledge storage, local PGlite and a bundled Chinese ONNX embedding model. Existing 0.1.0/0.1.1 space packages remain compatible. See [complete-package entry](START-HERE.md), [reception setup](docs/RECEPTION.md) and [knowledge setup](docs/KNOWLEDGE.md).

Version 0.2.1 adds default onboarding: upload the ZIP and ask "What is this for? How do I use it?" The receiving file-capable Agent reads AGENTS.md and [AGENT-START.md](AGENT-START.md), explains the package, and guides the user into a demo or school-building workflow without requiring a pasted prompt. See [onboarding branches](docs/AGENT-ONBOARDING.md).

An independent foundation for Agent-built, walkable spaces. Give a coding Agent a floor plan and public information; keep campus content in a space package instead of changing the core.

## Included

- Versioned spatial protocol, stable IDs, metre coordinates, floors, doors, voids and stairs.
- A2A 1.0 JSON-RPC discovery, send/get/list/cancel, persistent tasks, idempotent messages and explicit restart recovery.
- Public reception with source references, navigation and durable visitor messages. Optional live model; deterministic mode is labelled honestly.
- A local Three.js reference viewer and reproducible GLB builder. Geometry and navigation share one source.
- Two original sample spaces, scaffolding, Agent handoff documents, validation and portable source packaging.

## Start

Node.js 22.13+ or 24 LTS, Windows or macOS:

```sh
npm ci --ignore-scripts
npm run setup
npm start
```

Open `http://127.0.0.1:4180`. A prepared delivery ZIP already includes the local browser library and can run with `npm start` without installing development dependencies.

```sh
node tools/base.mjs scaffold --id my-campus --out projects/my-campus
node tools/base.mjs build --space projects/my-campus/space.json
node tools/base.mjs verify --space projects/my-campus/space.json
npm start -- --space projects/my-campus/space.json
```

Read [AGENTS.md](AGENTS.md), the [Agent workflow](docs/AGENT-WORKFLOW.md), [protocol](docs/PROTOCOL.md), [architecture](docs/ARCHITECTURE.md) and [deployment guide](docs/DEPLOYMENT.md).

The lightweight spatial mode is a concept-space foundation, not exact CAD reconstruction. Drawing interpretation is an explicit Agent step with recorded assumptions. The campus mode adds account, shared-avatar and moderated communication modules; real school SSO, arbitrary Agent trust federation and target-server production acceptance remain separate integration work.

Private drawings, credentials, real campus information and local state are excluded from the public source archive. MIT; see [provenance](docs/PROVENANCE.md).
