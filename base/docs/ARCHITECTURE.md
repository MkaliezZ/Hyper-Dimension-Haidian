# Architecture

> **当前模式说明。** 完整校园运行使用 Keycloak、PostgreSQL、NodeBB、Nakama；本页开头的 M2 和 JSON 单进程描述属于保留的轻量/阶段实现，不能当作完整校园尚无账号或数据库。当前工作流和数据权威见[统一开发手册](../DEVELOPMENT-MANUAL.md#architecture)，模块范围见 [CURRENT-FEATURES](CURRENT-FEATURES.md)。

## M2 priority extension

When `m2Enabled:true` is set on the M1 account runtime, original versioned humanoid recipes and assets are handled by `src/avatar/*-m2.mjs`. `hd_m2_avatars/history` preserve model/catalog hashes and explicit legacy migration; old hd_avatars remains untouched. Inventory issuance/equipment and private profile/collections use current school identity, receipts and optimistic revisions. Spatial item use enters the existing PostgreSQL runtime transaction, reads authoritative server position, then commits collections, consumption, inventory revision and receipt together. No geometry mutation, public-post creation, contribution grant or private-to-LLM forwarding occurs. Anonymous asset routes expose only the original allowlisted library. Current reference avatar animation is local; multiplayer appearance/effect replication and arbitrary model import are outside this slice. See M2.md.

```text
school project: space.json + plan evidence + artwork + public information
                         |
                  protocol validation
                         |
     spatial definition ---- public knowledge / Agent capability list
          |         |                        |
      GLB builder  navigation          scoped A2A / reception
          |         |                        |
      Three viewer  server movement      durable task / message store
```

## Boundaries

- `src/protocol`: version, stable IDs, canonical fingerprints and permissions.
- `src/a2a`: cards, task lifecycle, ownership, duplicate receipts and optional trusted handlers.
- `src/reception`: public-source retrieval, general conversation and replaceable model providers. Local Hermes runs in an isolated zero-tool subprocess, with bounded owner/Agent/context history from A2A. Provider gets no private data or machine tools. See [reception setup](RECEPTION.md).
- `src/knowledge`: reviewed public-document chunking, local ONNX/HTTP embeddings and pgvector SQL. Local PGlite and server PostgreSQL share the same schema. Documents never enter a public model before publication approval. See [knowledge setup](KNOWLEDGE.md).
- `src/spatial`: scene validation, wall/door topology, voids, cross-level route, server position and original GLB generator.
- `src/core`: single writer, atomic state and credentials/session identity.
- `src/server.mjs`: local HTTP adapter; serves only public frontend and explicit scene/model endpoints.
- `public`: one reference renderer, not the protocol. Another Agent can implement 2.5D, another engine, mobile or an exhibition UI while retaining IDs, coordinates and permissions.
- `examples`: original fictional spaces. `projects` and `.private-inputs`: ignored user material. `.local`: ignored persistent state/keys. `qa`/`dist`: reproducible outputs.

There is no runtime import, asset lookup, state read or service dependency on the old island game. Its sealed delivery is not modified. A small licensed atomic file utility is the direct source extraction; spatial contracts, gateway isolation and this reference application were rebuilt for application-neutral use. See PROVENANCE.md.

## Persistence · lightweight Base-1 mode

One process owns one data directory. Mutations queue and replace an fsynced temporary JSON file. Responses follow durable commit. No browser localStorage is authoritative. Duplicate message receipts, task owner, published-source result, visitor messages and route receipts survive restart. The browser gets a signed HttpOnly session cookie.

This first runtime is intentionally a **single-process reference**, not a horizontally scaled platform. For a central server, implement transaction/receipt/task ownership interfaces against a transactional database and move auth to real institutional identities. Preserve the existing externally observable protocol and tests.

The knowledge corpus already uses PostgreSQL/pgvector. This does not migrate visitor state, receipts or authentication from their JSON store. PGlite is single-owner; importing into the same local database requires stopping Base. A dedicated PostgreSQL server supports transactional corpus replacement alongside reads, subject to its deployment permissions and capacity.

No background local jobs, network discovery or arbitrary file permissions are inherited from a visitor's Agent. Federation is explicit: the operator grants a scoped token, the visiting Agent discovers a card and invokes advertised capabilities. See the two-process A2A check and sample client.

## M1 extension

With `config.milestone = M1`, Keycloak owns credentials and verified account lifecycle; Base PostgreSQL owns current school/organization membership, invitations, audit, avatars, notifications, event ledger and A2A runtime state. The PostgreSQL runtime adapter preserves the state/receipt contract and uses a session advisory lock for one writer. It still stores one transactional state snapshot; it is not a claim of horizontal task scaling. The legacy JSON mode remains available for the original reference application. Import requires an explicit stopped-source backup and refuses an already populated target.

NodeBB owns source content and durable operation intents. Assigned native IDs are recorded before the native write. Reconciliation inspects committed native records before creating a missing event; ambiguous partial operations and unexpected content drift stay blocked. Canonical event equality ignores JSON object key order, while changed fields or source revisions conflict. The ledger, score and outbox commit together; reconciliation uses the same school ledger lock when repairing scores. Native forum routes remain closed until all per-organization permissions are supported there.

The full backup tool requires stopped writers, hashes each private file and dumps every configured service database. A restored clone uses new databases and independent writable service directories; explicit issuer relocation preserves stable Base IDs and requires a fresh login. See M1.md for commands, verification and remaining stage boundaries.

Communication uses Nakama system-owned private storage as body authority, with PG metadata and pending source operations. The Base SSE gateway checks identity/ACL on every batch and after source fetches, then delivers latest revisions under a durable cursor; native client channel/storage/RPC bypasses remain closed. A lost source acknowledgement is reconciled by operation ID and fingerprint. Forum revision drafts and edit intents remain in the NodeBB plugin; approved edits call its native post API and retain native history. Applied migrations stay immutable. Full backup includes both services' new records without an extra body mirror in Base.
