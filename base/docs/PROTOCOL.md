# Protocol v1

## Identity and compatibility

`protocol = hyper-dimension.base/v1`, runtime `baseVersion = 0.2.1`. Runtime 0.2.1 accepts space packages declaring 0.1.0, 0.1.1, 0.2.0 or 0.2.1. The 0.2.1 patch adds default Agent onboarding and preserves 0.2.0 runtime behavior, geometry and IDs. Other versions are rejected; future format changes require a documented migration.

| ID                    | Meaning                                        | Lifetime                    |
| --------------------- | ---------------------------------------------- | --------------------------- |
| spaceId               | independently maintained space / tenant        | stable across art changes   |
| sceneId               | physical coordinate system                     | stable across rebuilds      |
| entityId              | room, exhibit or connector                     | never use a screen index    |
| agentId               | globally unique deployed Agent endpoint        | not its visible name        |
| principal.id          | authenticated caller or signed visitor session | scopes checked by server    |
| messageId / requestId | one immutable operation                        | preserve on transport retry |
| taskId / contextId    | durable task and owner-bound conversation      | survives restart            |

IDs use ASCII letters, digits, dot, underscore, colon and hyphen, at most 128 characters. Prototype keys are rejected. Labels and content can be Chinese or other Unicode text.

## Space package

`examples/north/space.json` is executable reference data. A package contains version, identity, theme, inline `scenes`, `spawn`, `knowledge`, `agents` and source provenance. `knowledge.published` is mandatory; unpublished entries never enter reception prompts or public scene responses. School names, rooms and knowledge are not core constants.

The reference runtime currently accepts one connected scene per space. Every extra scene requires an explicit scene-transition adapter; validation refuses silently disconnected scenes. Multiple independent space packages can run together.

## Spatial data

`format = hyper-dimension.scene/v1`; `units = m`; `axes = Y_UP_X_EAST_Z_SOUTH`.

- `point = [x,y,z]`, north is negative Z, east is positive X. `size = [width,depth]`.
- Levels have stable ID, elevation and inferred/measured height. Room `rect = [x,z,width,depth]` is relative to the level.
- Door edge is north/south/east/west. Its offset is measured from the left/top endpoint, in metres. Public openings are at least 1.2 m wide.
- `voids` remove floor support and navigation. Restricted rooms remove navigation. The current simple model uses rectangular voids and rooms; trace complex geometry into suitable rectangles or add a polygon adapter with tests.
- Connectors join explicit endpoints on different levels. The model and route use the same endpoints. This is a concept staircase, not a certified accessible or evacuation route.
- Movement is authorized from the server's interpolated position, not from a client-supplied start position. Repeated `requestId` returns the same receipt. A floor-view switch does not teleport the visitor.
- `geometryHash` binds scene data, generated GLB and navigation. `npm run verify` checks every public room from the configured spawn.

The extension URI `https://hyper-dimension.dev/protocol/space/v1` is a protocol identifier, not a claim that a documentation server exists at that address.

## A2A 1.0 JSON-RPC

Discovery: `GET /agents/{agentId}/.well-known/agent-card.json`; default `/.well-known/agent-card.json` selects the first Agent. Endpoint: `POST /agents/{agentId}/a2a`, headers `A2A-Version: 1.0`, `Authorization: Bearer …`.

Supported: `SendMessage`, `GetTask`, `ListTasks`, `CancelTask`, `GetExtendedAgentCard`. Cards declare streaming and push notifications unsupported; those methods fail explicitly. Text parts only. No silent downgrade to A2A 0.3.

```json
{
  "jsonrpc": "2.0",
  "id": "transport-1",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "question-1",
      "role": "ROLE_USER",
      "parts": [{ "text": "项目展览在哪里？" }]
    },
    "metadata": {
      "https://hyper-dimension.dev/protocol/space/v1": {
        "skillId": "space.information",
        "arguments": {}
      }
    }
  }
}
```

| Capability        | Arguments                          | Effect                                       |
| ----------------- | ---------------------------------- | -------------------------------------------- |
| space.information | none; question in message          | general conversation or sourced space answer |
| navigation.route  | from/to with sceneId,levelId,point | read-only route; does not teleport           |
| message.leave     | message text                       | one durable private inbox entry              |

Every A2A call requires both `a2a:call` and membership of the target space. Tasks are readable only by their owner at their owning Agent. A supplied tenant must match the target. Contexts cannot cross owners or spaces.

Tasks normally go WORKING → COMPLETED/FAILED/CANCELED. After an interrupted service, WORKING becomes INPUT_REQUIRED; no uncertain operation is automatically replayed. Explicit continuation uses a **new messageId plus original taskId** and the original capability/context. External custom side effects must also use taskId as their idempotency key; a local JSON receipt cannot make an arbitrary remote service transactional.

Get/List honor history limits, List pagination/filtering is owner-bound. Exact duplicate message content returns its original task; reusing a messageId with changed content is a conflict. Cancel cannot overwrite a completed task, and a late model response cannot overwrite cancellation.

## Reception and data authority

No provider: `knowledge-only`, deterministic retrieval, no model claim. Configured provider: `live-model`, general conversation works even with no retrieval hits. `basis=general` uses no references; `basis=published` requires references to retrieved public-source IDs; `basis=unavailable` marks missing space facts. Public room names, floor labels and descriptions are projected as `room:<entityId>` sources, with scene/entity IDs. Unpublished records and restricted rooms are excluded. Source presence is auditable; factual quality still needs content review.

SendMessage `message.contextId` supports follow-up questions. Only the same owner, space, Agent and context's last four completed information tasks enter the model (eight turns, each at most 2000 characters). Other skills, failed/canceled tasks and another Agent's conversation are excluded. History provides wording, not factual authority; published facts are re-retrieved. A duplicate messageId returns the original task without another model call or budget reservation. Daily model budgets still apply. See [Hermes configuration](RECEPTION.md).

Public reception has no filesystem, shell or private personal-steward tools. A model answer cannot grant a capability or publish a document. The maintainer publishes by reviewing the space package and redeploying. Runtime content editing is not included in v0.1.

Version 0.2.0 adds maintainer-only document import into PostgreSQL/pgvector. Only explicit published=true documents are embedded; all SQL retrieval is scoped to the authorized space. Sources use `kb:<documentId>:<chunk>-<contentHash>`, and include documentId/revision/sourceLabel. Full snapshots replace one school's chunks in a transaction; model identity mismatch requires reindexing. The public interface cannot choose database credentials, run SQL or import documents. See KNOWLEDGE.md.

Primary standard: [A2A 1.0 specification](https://a2a-protocol.org/v1.0.0/specification/). `tests/a2a.test.mjs` exercises the official JS SDK 1.3.0. Use its fromJSON codecs when calling the SDK; SDK memory enums/oneof parts differ from JSON wire values.

## M1 school and organization extension

M1 keeps the Base and A2A wire contracts above. It adds the `/m1` REST management surface documented in M1.md. School and organization IDs are stable, server-validated IDs; membership is always read from PostgreSQL, including calls that already have valid tokens. Role edits require `requestId` and `expectedRevision`; exact retries return their receipt, changed input conflicts. Invitations are one-use, expire after 48 hours and require the current verified IdP email. Existing memberships must use role management, never an invitation that could overwrite an owner or reactivate a revoked member.

NodeBB events keep `hyper-dimension.event/v1`, including schoolId, source system/id/revision/native pid/tid, actor, subject, status, visibility, period and occurredAt. M1 adds organizationId, onBehalfOf and contentVersion. Human moderation has `actor.kind=human`, a verified Base userId and `onBehalfOf=null`; no browser or model may submit arbitrary ledger events. An automated Agent moderation/delegation API has not been enabled. Messages, A2A tasks and notifications remain private to their owner/scope and are not published knowledge. Source withdrawal does not erase an audit trail or reverse entry.

Guest ownership is bound only after proof of the original signed Cookie and a short-lived, single-use claim. The original task IDs and receipt keys remain valid through server-side ownership aliases. School checks continue to apply, and colliding pre-existing message IDs require explicit resolution. This does not allow merging two institutional identities by display name or email.

M1 communication extension v0.3.0 adds `hyper-dimension.message/v1`, Nakama-owned bodies, Base-owned routing/receipts and authenticated SSE cursor delivery. Human message identity is server assigned; author revisions use compare-and-swap and stable request IDs. Read/stream/send re-check current school/organization membership, DM participation and blocks. Forum revisions retain native source IDs and published→published events score zero additional contribution. These are separate from A2A messages and never become published knowledge automatically. See M1-SOCIAL.md for concrete endpoints, review access, retention and source recovery.

## Campus implementation profile: Message / Content / Task / Event

This section maps the current campus implementation to the four information concepts. It is an additive implementation profile, not a replacement wire version or a new universal SQL table. The earlier versioned protocols retain their own schemas. Use the actual source adapter and its revision field; do not invent a shared `ownerId`, `contentId`, `taskStatus`, or event envelope that the source does not store.

### Message: communication and its actual authority

| Channel                                               | Body / identity authority                                                                                                                             | Routing, retry and governance                                                                                                                                                                                                                                                                                                         | Read / write boundary                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Human DM and room chat (`hyper-dimension.message/v1`) | Nakama server-only `hd_messages` storage collection, key = Base `message_id`; native object revision/version binds the write                          | `hd_conversations`: `conversation_id,school_id,org_id,kind,participants,scope_key`. `hd_chat_messages`: `message_id,sender_id,revision,native_version,status,expires_at,legal_hold`. `hd_chat_operations`: operation/request ID, input hash, expected revision, pending/committed result. `hd_chat_events.sequence` is the SSE cursor | Current school/org membership and room/DM participation; campus DM create/send/edit additionally require explicit bilateral contact consent. Existing history is not silently erased by contact revocation. Reporting grants only the specific scoped review path, never blanket DM access |
| Human-to-Agent or Agent-to-Agent A2A message          | A2A JSON message fields `messageId,role,parts,taskId,contextId`; message history belongs to its actual A2A task                                       | Runtime state `tasks[id].history`, `a2aRequests[hash(owner,agentId,messageId)]={hash,taskId}`, `contexts[contextId]={owner,spaceId}`. Campus persistence is `hd_runtime_state.state`; standalone Base uses its own `state.json`                                                                                                       | Authenticated principal requires `a2a:call` and target-space access; task/context ownership and target Agent are checked. An Agent speaking in a conversation does not acquire the human's business-management role                                                                        |
| Explicit `message.leave`                              | Runtime `messages[]` entry `{id,spaceId,author,text,at}`; ID is the completing A2A task ID                                                            | Same atomic runtime state update as task completion                                                                                                                                                                                                                                                                                   | Private durable maintainer inbox operation explicitly requested by the user. It is not a public forum post, campus chat message or published KB source                                                                                                                                     |
| Notifications                                         | `hd_notifications`: recipient `school_id,user_id`, unique `event_id`, minimal `payload`, read/created times; campus adds `scope_id,information_event` | Subscriptions in `hd_subscriptions`, preferences in `hd_notification_preferences`; notification cursors track owned IDs even when revoked entries are filtered                                                                                                                                                                        | Always current recipient identity and source/scope visibility. A notification is a reference or business receipt, not authority to open its underlying object                                                                                                                              |

`hd_chat_reads` stores the per-user read cursor; `hd_chat_blocks` and `hd_contact_preferences/hd_contact_permissions` govern contact and new DM operations. These do not publish message bodies or confer moderation rights. Native Nakama message/channel routes cannot bypass the Base checks.

### Content: publication remains source-specific

| Content class                                        | Actual storage / identifiers                                                                                                                                                                                            | Visibility and revision                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space geometry, public room facts, configured Agents | Maintained `space.json`; `spaceId,sceneId,entityId,agentId`, scene format and geometry hash described above                                                                                                             | Real public rooms only; package source review and redeploy. A place-service binding cannot edit geometry                                                                                                                                |
| Documents for public reception                       | Reviewed document input → `hdbase_kb.spaces` and `hdbase_kb.chunks`; `space_id,source_id,document_id,revision,source_label,model_key,embedding`                                                                         | Only explicitly published documents are imported/embedded. Snapshot replacement is transactional by space; model/dimension mismatch needs reindexing. Original drawings/private files are not automatic KB inputs                       |
| Forum posts and place-linked campus memories         | NodeBB native `pid/tid` and plugin `hd:item:<sourceId>` workflow records; `source.id`, source revision and organization context                                                                                         | Native moderation/edit/withdrawal pipeline remains authoritative. `hd_community_pages` stores only scope/page summary/anchor/version; it is not a second forum body store                                                               |
| Activities and participation evidence                | `hd_activities.activity_id,org_id,status,revision`; registrations, submissions and reminders are separate `hd_activity_*` tables                                                                                        | Published activity metadata is scoped and expires. Submission notes/evidence are private participant/verifier data, not public activity facts                                                                                           |
| Place announcements and feedback                     | `hd_environment_places` stable public anchor + handling scope. `hd_environment_announcements.announcement_id,status,revision,title,body`. `hd_environment_feedback.feedback_id,user_id,status,revision,body,resolution` | Only reviewed published announcements are public. Feedback is visible to its submitter/current place handlers. Delegation does not grant organization membership management                                                             |
| Partner directory and services                       | `hd_m5_partners`, `hd_m5_services`, `hd_m5_offers`, each with its own ID/status/revision/validity                                                                                                                       | Partner approval, service publication, current source revision and expiry are authoritative. Withdrawn/expired sources are removed from reception facts; personal appointment data and redemption credentials are not directory content |
| Personal profile, works, badges and collection       | Basic profile authority `hd_m2_profiles`; `hd_personal_works` + immutable version snapshots, `hd_personal_badges`, `hd_personal_preferences`; collections in `hd_m2_collections`                                        | Explicit owner choices and current school/org scope. A published work is not automatic consent to include private profile fields, collections or messages in reception prompts                                                          |
| Attachments                                          | `hd_attachments`: school/owner/scope, purpose/target, checksum/bytes/body, status/revision/expiry/legal hold                                                                                                            | A valid attachment ID alone does not authorize download: current permission on the linked object is checked. Revoked, deleted or expired content is not silently retained as readable source text                                       |

`hd_information_events` and `hd_information_heads` unify subscription **references**, not all content. They store `topic,source_id,scope_id,source_revision/envelope/fingerprint` and current `revision,status,title,expires_at`. The normalized topics are announcements/community/activities/partners. Their source-revision sequence is a separate publication projection and can differ from a business object's native revision. Source bodies stay in their original authority; these tables do not copy private forum drafts, evidence, chats, appointment requests or personal collections.

### Task: three different lifecycle authorities

| Task type                        | Real lifecycle and fields                                                                                                                                              | Retry / consent semantics                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2A execution                    | Runtime `tasks[id]`: `owner,spaceId,agentId,contextId,skillId,input,arguments,history,status,createdAt,result/artifacts`                                               | A2A state values remain `TASK_STATE_*`. Interrupted WORKING becomes INPUT_REQUIRED, requiring explicit new message ID + original task ID. Owner and target Agent checks apply before Get/List/Cancel                                                                                                                             |
| Partner consultation/appointment | `hd_m5_tasks`: `task_id,user_id,partner_id,service_id,kind,status,revision,source_revision,source_snapshot,request,consent,external_receipt,cancel_receipt,last_error` | Statuses include proposed, queued, pending_confirmation, confirmed, cancellation states, failed and adapter_unavailable. User explicitly consents to the selected disclosure. `hd_m5_adapter_operations` stores create/cancel intent fingerprint and prepared/uncertain/completed receipts; timeout is not reported as confirmed |
| Scheduled activity reminder      | pg-boss actual job state/attempt count; `hd_scheduled_jobs` stores stable `job_id,school_id,kind,source_id,input_hash`                                                 | Scheduling metadata is not another queue state machine. Underlying `hd_activity_reminders` owns scheduled/delivered/cancelled business status and stable `event_id`; native retry preserves that side-effect identity. Only current school owner may retry a failed job with a reason and enabled Base-3                         |

Reward claims (`hd_reward_claims`) and operation-template runs (`hd_operation_runs`) retain their own business receipt/status records. They are not A2A tasks, nor evidence that an LLM autonomously fulfilled an entitlement. Reward fulfilment writes the existing badge/M2 item/partner entitlement authority rather than minting a parallel inventory.

### Event: retain each producer's actual shape

| Producer                 | Stored event shape / authority                                                                                                                                                                                           | Consumer rule                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NodeBB forum             | `hyper-dimension.event/v1`; `source.system='nodebb'`, source ID/revision/native pid/tid, `actor`, `subject`, `status`, `visibility`, `period`, `occurredAt`; M1 adds `organizationId,onBehalfOf,contentVersion`          | Only trusted native bridge events enter reconciliation. Published edits grant no new contribution; original source sequence and immutable inputs are checked                                                  |
| Activities               | `hd_activity_events.envelope`; `source.kind='base-activities'`, `source.id=registrationId`, `source.revision=sourceRevision`; top-level `schoolId,orgId,userId,actorId,activityId,registrationId,kind,occurredAt,detail` | Verification revisions can begin at 3 or 4 because join/evidence events precede them. Validate the complete source chain, not a fabricated contribution-only sequence. Revocations point to `reversesEventId` |
| Place service            | `hd_environment_events`: event ID, object ID, source revision, actor ID, kind, envelope. Envelope source uses `kind='base-environment'`, plus `schoolId,orgId,placeId,actorId,kind,occurredAt,detail`                    | Audit remains private. Announcement snapshots and feedback handling reasons do not become public notification payloads or score events                                                                        |
| Contacts                 | `hd_contact_events` and its own consent version; envelope source uses `system='base-contacts'`, actor kind/user and `onBehalfOf=null`                                                                                    | Accept/reject/revoke is the authority for future contact operations. Consent cannot be inferred from shared school membership or old messages                                                                 |
| Partner services         | `hd_m5_events`: partner/object ID, revision, kind and envelope; source uses `system='base-partners'`                                                                                                                     | Current object ownership/scope applies to receipts. Explicit task consent and adapter completion are distinct from public directory review                                                                    |
| Rewards                  | `hd_reward_events`: event/reward/claim IDs, actor ID, kind, revision, `detail`, created time                                                                                                                             | This table has no universal `envelope` field. Follow the claim's actual target authority and original receipt for fulfil/revoke                                                                               |
| Subscription publication | `hd_information_events`: per-school event ID, scope/topic/source ID/source revision, envelope/fingerprint                                                                                                                | Exact event replay is immutable; current head status/expiry drives visibility. Do not treat the notification projection revision as the original source's schema version                                      |

Only the contribution pipeline writes accepted scoring events into the existing `hd_events`, with immutable `event_id,school_id,source_id,source_revision,envelope,input_hash`. `hd_contributions` is the sole points ledger: `event_id,user_id,period,delta,rule_version,reverses` plus campus `scope_id,kind,metadata`. `hd_scores`, native Nakama scores and frozen ranking generations are projections. Rule changes never rewrite old deltas; reversal references the original entry exactly once. Unrelated private messages, notifications or place feedback are not silently scored.

### Private information, delegation and old receipts

- Identity comes from the authenticated session/principal, not an LLM-supplied actor name. Current school/organization permission is checked at the actual business write; an existing request receipt cannot bypass revocation. Anonymous visitors receive public content only.
- Reception can discuss general topics when a configured provider is available, but school facts must come from current published sources. Private DMs, personal-steward inputs, submitted evidence, partner appointment details, feedback bodies and redemption tokens are excluded from public reception/vector ingestion.
- A2A transport capability is not delegated owner/moderator authority. Current Agent-directory cards (`hyper-dimension.agent-directory/v1`, derived dynamically in `src/platform/agents.mjs`) distinguish reception A2A Agents from scoped activity/partner workflows. They explicitly declare `privateInformationAccess=false`, `authorityEscalation=false`, `rewardIssuance=false`, `delegatedExecution=false`; a workflow card is not proof of autonomous external execution.
- Membership edits, content publication, activity verification, reward issuance and partner disclosure use their separate authenticated, explicit workflows. A model response cannot approve itself, impersonate a human, award points or change geometry. Missing/unavailable external adapters report that state instead of pretending a booking completed.
- Notifications normally recheck current scope; information notifications also recheck current published head/expiry, and activity reminders recheck active published activity plus current participation. Narrow partner receipt exceptions additionally prove the actual business object's owner and original event.
- `environment_feedback` and `environment_assignment` are minimal historical notifications with no title/body/participant identity. If a former place manager remains a valid member of the handling organization, their previously received minimal notice can remain visible; it does not preserve feedback access or management authority. Current place ACL is reapplied on opening the queue or submitting an action. Removing organization membership also hides old scoped notices. Notification status is the original snapshot, not a guarantee of current object state.

Implementation references: `src/a2a/gateway.mjs`, `src/platform/{pg-store,chat,contacts,information,activities,environment,partners,campus-ledger,rewards,jobs,job-admin,agents}.mjs`; migration definitions under `database/` and native adapters under `integrations/`. Preserve all applied migrations and old delivery bundles when extending these contracts.
