# Research: Live Approval Lifecycle Map

- Query: Map the current Approval implementation and define the Slice 4 lifecycle, authority, storage, operator-session ownership, Host challenge/resume binding, privacy boundary, affected files, implementation batches, and verification matrix.
- Scope: internal
- Date: 2026-08-13

## Findings

### 1. Executive conclusion

Slice 4 should replace two retained legacy prompt systems with one Core-owned Approval service. The service must own:

- canonical decision identity and durable state;
- the global `approvalGeneration`;
- pending interactive requests and exact initiating-socket ownership;
- once/session/always/deny semantics;
- targeted operator presentation, list, revoke, timeout, disconnect, and policy invalidation;
- the authorization that resumes an exact Host-classified request.

The current production baseline is intentionally fail-closed:

- the old TypeScript MCP Approval broker, decision store, and AI SDK gate are dormant (`packages/core/src/approval/index.md:3-9`);
- governed Core-local and MCP tools return `APPROVAL_REQUIRED` before their raw execution closure when the effective posture is `ask`;
- Rust classifies Host-owned inputs, applies Core projection plus stricter local/legacy constraints, executes only `auto`, and returns `APPROVAL_REQUIRED` for `ask` (`apps/desktop/src-tauri/src/ws_client.rs:375-448`);
- the old Rust approver and decision writers remain wired into composition objects but are not consulted by that production request path.

The target must preserve this fail-closed seam while adding one prompt. A Host must never open a second dialog, and a durable or session decision must never be keyed by mutable display names, stable device identity, or browser-generation state.

### 2. Current live and dormant source map

| Plane | Current source | Current truth | Slice 4 disposition |
| --- | --- | --- | --- |
| Shared operator schema | `packages/shared/src/approval-schema.ts:8-37` | MCP-specific `serverName`, `toolName`, raw `input`, and `once\|session\|always`; no canonical identity, lifecycle state, disclosure revision, list, revoke, or connection ownership | Replace with common, revisioned Approval schemas while retaining compatibility exports only where needed. |
| Shared Host control | `packages/shared/src/host-control-schema.ts:163-180,249-261` | Full sealed `HostOperationControl`, but challenge/resume contain only request/control/challenge ids | Add trusted classification evidence and a nested post-decision authorization; do not mutate the original control tuple. |
| Legacy Core broker | `packages/core/src/approval/approval-broker.ts:34-85` | One global pending map, 60-second timeout, and broker-wide `denyAll` | Replace with per-`Connection` ownership and targeted cleanup. Broker-wide denial is unsafe with concurrent operator sockets. |
| Legacy Core decisions | `packages/core/src/approval/decision-store.ts:25-57` | Session means Core-process lifetime; durable file is keyed by `serverName/toolName`; deny plus always becomes `never` | Replace with SQLite canonical decisions and connection-owned session maps. Keep old file readable only through migration compatibility. |
| Legacy AI SDK gate | `packages/core/src/approval/approval-gate.ts:40-55` | MCP-only lookup and prompt; built-ins are not applicable | Replace with the common governed-tool seam. Do not re-enable this path as a second authority. |
| Production MCP legacy compatibility | `packages/core/src/mcp/legacy-mcp-deny.ts` | Exact legacy denies narrow authority; allows are inert; corrupt or ambiguous state fails closed | Preserve until explicit migration retirement. Never auto-import an old allow. |
| Core Host broker | `packages/core/src/capabilities/capability-broker.ts:197-213,269-270` | Seals the complete control and exact input digest; still defaults `approvalGeneration` to `1`; terminal responses require exact JSON-equal control | Inject the real generation and add challenge/resume state without weakening existing exact terminal matching. |
| Exact input binding | `packages/core/src/capabilities/canonical-input.ts:8-26` | SHA-256 over canonical `{ capabilityId, input }` | Extend Approval binding to canonical owner/subject revision and trusted classification scope; do not duplicate Host classifiers in TypeScript. |
| Core operator connection | `packages/core/src/server/connection-registry.ts:20-41,62-96,110-121` | A physical `Connection` object represents one socket; stable `deviceId` can appear on multiple sockets | Use physical `Connection` object identity as session authority. Add only Core-minted opaque ids for DTO correlation, never as client-supplied authority. |
| Core socket cleanup | `packages/core/src/server/ws-server.ts:42-58,125-136` | Each socket owns close callbacks and is removed exactly once | Attach pending/session cleanup to this socket lifecycle and `connectionRegistry.onRemove`. |
| Rust enforcement | `apps/desktop/src-tauri/src/ws_client.rs:375-448` | Recomputes input digest, classifies, applies stricter constraints, audits, executes only `auto`, returns `APPROVAL_REQUIRED` for `ask` | Split classify/challenge from authorized resume, preserve final stricter enforcement, and prevent pending input from entering audit. |
| Rust request cache | `apps/desktop/src-tauri/src/host_session.rs:64-160` | Exact request/control binding, duplicate suppression, terminal cache, connection/catalog/policy lineage | Extend with one pending challenge per attempt and single-use authorization consumption. |
| Rust legacy prompt composition | `apps/desktop/src-tauri/src/node.rs:31-93`; `apps/desktop/src-tauri/src/lib.rs:132-169` | `NodeConfig` still receives an approver and constructs the old decision-backed `Gate` | Remove approver selection/injection from production composition. Keep compatibility modules and deny-only readers; do not delete legacy files. |
| CLI prompt | `apps/cli/src/approval-prompt.ts:13-30`; `apps/cli/src/main.ts:68-76` | Displays raw MCP input; “always” has no future-background disclosure; `n` infers durable never | Move to common presentation and explicit choices/disclosure. Continue using the initiating CLI socket only. |
| Desktop Home | `apps/desktop/src/windows/home/pages.ts:28-43`; `apps/desktop/src/lib/ws-client.ts:104-136` | No Approval route, dialog, list, or revoke method; Home policy UI covers Slice 3 only | Add a socket-local modal/overlay plus a durable decision management surface. Do not broadcast prompts to the Home settings socket. |
| Desktop persistent cache | `apps/desktop/src/lib/cache-persist.ts:9-22,47-69` | Closed allow-list excludes Approval and permission state | Keep pending, session, and decision detail out of localStorage. Add negative tests rather than a cache key. |
| Durable policy precedent | `packages/core/src/db/migrations/014-governance-policy.ts:8-31`; `packages/core/src/governance/governance-policy-repo.ts:121-153` | SQLite singleton generation; material mutation increments once, no-op zero; atomic repository transactions | Reuse this pattern for `approvalGeneration` and decision mutations. |
| E2E harness | `e2e/src/fixture/with-stack.ts:69-89,222-267`; `e2e/src/governance-stale-projection.e2e.test.ts:43-65` | Real Core/Host/operator stack plus test-only relay and bounded no-replay assertions | Extend operator drivers and relay transforms for Approval and challenge/resume process proof. |

### 3. Authority and identity contract

#### 3.1 One authority

Core is the sole global Approval authority. The owning Execution Host remains the final stricter enforcer for trusted input classification, local/managed floors, exact binding, and actual execution. These roles compose as:

```text
canonical capability identity + current Core policy
INTERSECT canonical Approval decision at approvalGeneration N
INTERSECT Host classification + local/managed/legacy-deny floors
= execute, ask once through Core, or deny
```

An Agent, Skill package, MCP annotation, model-facing tool name, prompt text, conversational grant, Host availability, or client cache cannot create or widen authority.

#### 3.2 Canonical decision identity

A decision key should be derived from a versioned canonical binding, not display text:

```ts
interface ApprovalDecisionBinding {
  capabilityId: string;
  descriptorRevision: number;
  subject?: {
    kind: "mcp-tool" | "host-resource" | "workspace-root" | "other";
    id: string;
    revision: number;
  };
  cellKey: string;
  classifierRevision: number;
  decisionScopeDigest: string;
}
```

`decisionScopeDigest` is a server-computed digest over the trusted, canonical scope that a remembered decision covers. It must not contain raw input or sensitive classifier detail. For fixed-risk actions it can cover the canonical capability/cell. For Host-classified actions it covers the Host-provided classification identity after Core validates the descriptor/classifier revisions. Per-root or per-target decisions require a stable canonical subject id/revision; they must not store an arbitrary path or command as their durable key.

The current `inputDigest` is still required for the exact attempt, but it is not by itself a safe remembered-decision identity (`packages/core/src/capabilities/canonical-input.ts:8-14`).

#### 3.3 Operator session identity

The authoritative session is the physical Core `Connection` object created for one WebSocket. It is not:

- `deviceId`, because concurrent windows/sockets may share it;
- the Desktop D59 browser client generation, because Core does not receive that identity;
- a reconnect token, because it authenticates a device rather than preserving an old socket session;
- a Core-process-global map.

Core may attach a random, opaque `operatorSessionId` to the `Connection` for protocol correlation and diagnostics. It must be minted server-side, never accepted from a client, never used to resurrect a dead connection, and never substitute for an in-memory object-identity/provenance check.

Pending requests and session grants belong to exactly one initiating/approving `Connection`. `approval.respond` must receive `MethodContext`, compare `ctx.connection` with the pending owner, and reject a response from every other authenticated operator even when the same `deviceId` is used.

`connectionRegistry.onRemove(connection)` must atomically:

1. deny/cancel only pending requests owned by that connection;
2. delete only session grants owned by that connection;
3. advance `approvalGeneration` once if at least one session grant was removed, otherwise zero times;
4. invalidate affected pending/resume authorizations and notify only their owning surfaces;
5. leave every other operator connection untouched.

### 4. Target lifecycle

#### 4.1 Core state machine

Recommended in-memory states:

| State | Meaning | Durable? | Exit conditions |
| --- | --- | --- | --- |
| `pending_operator` | Exact request is sealed and one initiating operator socket owns the prompt | No | respond, deny, timeout, disconnect, policy/generation change, Host route replacement, caller cancellation |
| `authorized` | A once/session/always answer has been accepted and, if needed, durable/session state committed | No | local execution starts, Host resume is sent, invalidation |
| `resuming_host` | A single-use Host authorization has been minted for the exact challenge | No | Host terminal response, cancellation, disconnect, deadline, replay rejection |
| `completed` | Exact request executed and settled | No lifecycle row | terminal |
| `denied` | Operator denied current request or effective authority denied it | No lifecycle row | terminal |
| `expired` | Operator or Host deadline elapsed | No lifecycle row | terminal |
| `cancelled` | Caller/window/turn cancelled | No lifecycle row | terminal |
| `invalidated` | Policy, Approval generation, route, descriptor, catalog, or connection lineage changed | No lifecycle row | terminal |

Pending requests are never restored after Core restart. A restart forgets every prompt and every session grant, then advances/reinitializes generation so no pre-restart authorization can resume.

#### 4.2 Entry behavior by execution source

| Source | Effective `ask` behavior |
| --- | --- |
| Interactive operator/chat action | Send one targeted prompt to the initiating operator `Connection`. |
| Heartbeat | Skip/fail closed with a structured non-interactive outcome; never prompt. |
| Scheduled work | Pause only through the later Run Receipt contract; Slice 4 must not implement surprise prompting or an ad hoc queue. |
| No initiating operator connection | Fail closed as `APPROVAL_REQUIRED`/`INTERACTION_REQUIRED`; do not choose another online operator. |

#### 4.3 One-dialog invariant

For a Host-owned classified action:

```text
Core dispatches sealed request
  -> Host classifies and returns one challenge (no local dialog)
  -> Core targets one prompt to the initiating operator socket
  -> operator answers once
  -> Core resumes exact challenge or terminates it
  -> Host revalidates and executes at most once
```

For Core-local/MCP actions, Core already has trusted classification and can enter `pending_operator` directly. The raw execution closure remains unopened until authorization settles.

### 5. Decision scopes and server-side ceilings

| Operator choice | Authority | Persistence | Generation effect |
| --- | --- | --- | --- |
| Allow once | This exact sealed attempt only | None | Zero increments |
| Allow for session | Future matching calls initiated through the exact approving `Connection` only | In-memory map owned by that connection | Increment once on material create/change; one increment for a non-empty teardown batch |
| Always allow | Future matching calls under the canonical decision binding and accepted disclosure revision | SQLite | Increment once on material create/change |
| Deny | Current pending request only | None | Zero increments |

If the product retains durable “never,” it must be a separately named, explicit, listable, and revocable operation. Do not infer it from `deny + always`, and do not preserve the old CLI `n` shortcut as an implicit durable mutation.

The descriptor's `approvalMemory` is a server-side ceiling:

- `once-only` permits only allow-once or deny;
- `rememberable` may permit session/always according to the canonical subject/classifier contract;
- a stale or malicious client that submits a disallowed scope is rejected even if the UI hid it.

The server supplies the allowed choices in the prompt DTO after evaluating this ceiling. The client never derives authority from display metadata.

`always` additionally requires an exact, current background-use disclosure acknowledgement, for example:

```ts
interface ApprovalDisclosureAck {
  revision: number;
  futureBackgroundUseAccepted: true;
}
```

Missing, stale, or false acknowledgement rejects the durable allow. Disclosure revision is stored with the decision and included in its decision-scope digest. A future disclosure revision makes the old decision inert until reconfirmed; it must not be silently upgraded.

### 6. Durable storage and generation semantics

#### 6.1 SQLite shape

Use the numbered migration/repository pattern already established by migration 014 (`packages/core/src/db/migrations/index-list.ts:6-36`; `packages/core/src/db/migration-runner.ts:13-40`). A defensible minimum is:

```sql
CREATE TABLE approval_state (
  singleton_id        INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  approval_generation INTEGER NOT NULL CHECK (approval_generation > 0),
  disclosure_revision INTEGER NOT NULL CHECK (disclosure_revision > 0),
  updated_at          TEXT NOT NULL
) STRICT;

CREATE TABLE approval_decisions (
  decision_id          TEXT PRIMARY KEY,
  capability_id        TEXT NOT NULL,
  descriptor_revision  INTEGER NOT NULL CHECK (descriptor_revision > 0),
  subject_kind         TEXT,
  subject_id           TEXT,
  subject_revision     INTEGER,
  cell_key             TEXT NOT NULL,
  classifier_revision  INTEGER NOT NULL CHECK (classifier_revision > 0),
  decision_scope_digest TEXT NOT NULL,
  verdict              TEXT NOT NULL CHECK (verdict IN ('allow', 'deny')),
  disclosure_revision  INTEGER,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  provenance            TEXT NOT NULL
) STRICT;
```

Production may omit durable deny for MVP; if omitted, constrain `verdict` to `allow`. No row contains raw input, path, command, secret, presentation detail, operator token, socket id, or classifier payload.

Session decisions remain in memory beside their owning `Connection`. Pending requests and single-use authorizations remain in separate in-memory maps and are never serialized.

#### 6.2 Generation rules

`approvalGeneration` is global Core authority lineage, not a row version. Advance it:

- exactly once for each material durable decision create/change/revoke;
- exactly once for each material session decision create/change;
- exactly once for a connection teardown that removes one or more session decisions;
- exactly once for a disclosure/registry reconciliation that makes existing decisions materially inert or removes them;
- zero times for no-op writes, unknown revokes, repeated identical answers, current-request deny, timeout, or allow-once.

All mutations and generation increments occur in one serialized service operation. Durable changes use one SQLite transaction. Session changes use the same service mutex/queue so a durable mutation and socket teardown cannot publish conflicting generations.

A generation change invalidates every pending or not-yet-consumed resume authorization sealed against an older Approval lineage, except for the narrow atomic transition described below for the exact request whose answer caused the increment.

Policy changes re-evaluate future calls immediately and invalidate pending/resume authorization. They do not automatically delete durable Approval rows: a later policy may make a row usable again only if its canonical descriptor/classifier/disclosure binding is still current. Hard floors always win.

### 7. Host challenge/resume protocol and the generation transition

#### 7.1 Problem in the current schema

`HostOperationControl` contains one `approvalGeneration` and terminal matching currently requires the whole control to remain exact (`packages/shared/src/host-control-schema.ts:163-180`; `packages/core/src/capabilities/capability-broker.ts:269-270`). However, accepting a new session/durable decision after a Host challenge must increment the global generation. Mutating the original control would break exact matching; leaving it at `1` would create false authority.

#### 7.2 Recommended contract: immutable control plus nested authorization

Keep the original `HostOperationControl` byte-for-byte immutable across request, challenge, resume, cancel, and terminal response. Add a nested, Core-minted, single-use authorization to `CapabilityResume`:

```ts
interface CapabilityAuthorization {
  authorizationId: string;       // Core UUID, consumed once
  approvalGeneration: number;    // current generation after the answer commits
  decisionScope: "once" | "session" | "always";
  controlDigest: string;          // digest of the immutable HostOperationControl
  challengeDigest: string;        // digest of trusted Host challenge evidence
  decisionScopeDigest: string;    // canonical remembered scope, or exact-attempt scope for once
  issuedAt: string;
  expiresAt: string;
}

interface CapabilityResumeV2 {
  requestId: string;
  control: HostOperationControl;  // exact original control, including original approvalGeneration
  challengeId: string;
  authorization: CapabilityAuthorization;
}
```

The Host challenge must add:

- `HostGovernanceEvidence` including cell and effective posture;
- descriptor/classifier revisions already projected by Core;
- a canonical `classificationDigest` over trusted classification identity;
- safe presentation metadata needed for the operator;
- no durable/raw sensitive detail.

The transition rules are:

1. Request is sealed at generation `G`.
2. Host stores the exact request, classifies it, and sends one challenge carrying the same control and trusted classification digest.
3. Core verifies Host/connection/catalog/policy provenance and exact pending control before prompting.
4. Allow-once commits no state and mints authorization at `G`.
5. A material session/always answer commits the decision and advances generation to `G+1` atomically.
6. In that same serialized operation, Core consumes the initiating pending answer, invalidates other older pending/resume entries, and mints one authorization at `G+1` bound to the original immutable control/challenge.
7. Host accepts a resume only when request id, challenge id, original control, all three digests, deadline, Host connection/catalog generation, and single-use authorization id match its in-memory pending challenge.
8. Host consumes the authorization before starting execution. Duplicate resume returns a duplicate/late acknowledgement and never starts a second effect.
9. The terminal response still echoes the original immutable control. Core settles it against the pending authorization record, which also records the post-decision generation.

This is not a general permission to transition control generations. The only allowed lineage change is the nested authorization minted atomically for the exact request whose answer caused the generation mutation. Every other request at the old generation is invalidated.

The schema change should bump the Host-control protocol revision. A mixed old/new Core/Host pair must reject challenge/resume as unsupported rather than fall back to a local prompt or execute under generation `1`.

#### 7.3 Required at-most-once proof

Focused tests must prove:

- once: outer `G`, authorization `G`, one execution;
- session/always: outer `G`, committed state and authorization `G+1`, one execution;
- another pending request at `G` is invalidated by that mutation;
- a tampered outer control, classification digest, decision-scope digest, authorization generation/id/deadline, request id, or challenge id is rejected;
- replay before terminal, replay after terminal, replay after reconnect, and resume after cancel all execute zero additional effects;
- Host replacement discards the old pending challenge and authorization cache;
- policy/revoke/disclosure changes before resume prevent authorization minting or send an ordered cancel;
- cancellation after an effect begins preserves existing cooperative/non-cooperative `cancelled` versus `outcome_unknown` semantics.

### 8. Pending request privacy and presentation

#### 8.1 Memory-only rule

The exact pending input may exist only in:

- the Core pending record;
- the owning Host request/challenge record while classification or resume is active;
- the initiating client generation's in-memory dialog state.

It must be cleared on answer, timeout, cancellation, policy/Approval generation change, Host route replacement, operator disconnect, Host disconnect, Core shutdown, or terminal settlement.

It must never enter:

- SQLite, JSON decision files, migration markers, or config;
- app logs, socket error logs, analytics, diagnostics, or crash reports;
- Rust audit JSONL;
- timeline/tool-call persistence, Run Receipt history, conversation summaries, or memory;
- Zustand persistence, SWR/localStorage cache, navigation parameters, or Tauri events;
- list/revoke DTOs or generic error `data`.

#### 8.2 Presentation DTO

Do not make the dialog render arbitrary `JSON.stringify(input)` as the old CLI does (`apps/cli/src/approval-prompt.ts:24-26`). Use a versioned, ephemeral presentation:

```ts
interface ApprovalPresentation {
  title: string;
  capabilityLabel: string;
  subjectLabel?: string;
  riskSummary: string;
  detail: unknown;          // schema-owned, in-memory only; sensitive fields already redacted
  disclosureRevision?: number;
  allowedChoices: readonly ApprovalChoice[];
}
```

The capability adapter/Host classifier supplies safe presentation detail and sensitivity metadata. Core validates its revision and allowed shape. The exact raw input remains bound by digest but is not automatically copied into the presentation. Secret-bearing fields must render as presence/purpose, never value.

#### 8.3 Existing privacy hotspots to change or pin

- `apps/desktop/src-tauri/src/ws_client.rs:433` currently audits every enforcement result and supplies the exec command even when the posture is `ask`; the challenge path must not write pending command/input to audit.
- `packages/core/src/agents/turn-mapping.ts:43-63` drops approval parts but persists ordinary tool-call input/result parts. The common Approval lane must keep the pending exact input out of response-message/timeline persistence and store only an approved sanitized tool record or digest/reference where required.
- `packages/core/src/server/ws-server.ts:52-63,80-91` currently logs connection events and method names, not frame payloads; retain this boundary.
- `packages/core/src/capabilities/capability-broker.ts:117-174` logs request/attempt/capability outcome metadata, not input; retain and extend tests.
- `apps/desktop/src/lib/cache-persist.ts:16-30` is a closed disk-cache allow-list; Approval must remain absent and receive source-sweep tests.
- CLI necessarily renders the ephemeral presentation to the operator's terminal, but must not echo it in errors, generic `/call` output, or a durable history file.

### 9. Operator methods and surfaces

#### 9.1 Common methods

Recommended operator contract:

| Method | Direction | Purpose |
| --- | --- | --- |
| `approval.request` | Core -> one operator socket notification | Present one pending exact request; includes id, expiry, canonical labels, safe presentation, allowed choices, current generations |
| `approval.respond` | Same operator socket -> Core request | Submit one choice; durable allow includes disclosure acknowledgement and expected generation |
| `approval.closed` | Core -> owning socket notification | Remove a prompt invalidated/expired/cancelled elsewhere |
| `approval.list` | Operator -> Core request | List durable canonical decisions and reconfirmation candidates without raw input |
| `approval.revoke` | Operator -> Core request | Revoke one durable decision using expected `approvalGeneration` |

`approval.respond` returns an explicit status such as `accepted`, `late`, `wrong_session`, `invalidated`, or `scope_not_allowed`; it must not reveal another socket's pending detail. Unknown ids remain normal fail-closed results, not stack errors.

List rows expose decision id, canonical capability/subject labels, cell, verdict, disclosure status, created/updated times, provenance category, and current usability. They do not expose raw input, classification payload, secret values, socket identity, or mutable MCP display-name authority.

#### 9.2 Desktop

The prompt should be a modal/overlay owned by the `WsClient` generation that received `approval.request`, not a Home-only broadcast or a cross-window Tauri event. This matters because Home currently has a shared settings-family socket and the Chat page has its own socket; the chat socket initiating a turn must own the prompt.

Each Desktop `WsClient` needs targeted inbound handlers for request/closed events and outbound respond/list/revoke methods. The window root installs an in-memory Approval store and clears it on client retirement. A second socket using the same persisted device identity must neither see nor answer the first socket's prompt.

Durable decision management can live as an Approval section/page in Home, loaded fresh from Core on each authenticated generation. Like permission state, it must not use `useCachedFetch`, Zustand persistence, or localStorage. A list surface does not own pending prompts.

#### 9.3 CLI

Retain the existing shared stdin queue behavior in `apps/cli/src/main.ts:68-76`, but render the common safe presentation and explicit choices:

- allow once;
- allow for this CLI connection;
- always allow, followed by an explicit future-background disclosure confirmation;
- deny current request.

Remove implicit durable never. Generic `/call approval.list` and `/call approval.revoke` remain useful scriptable parity, while dedicated human-readable commands may be added later without changing server authority.

### 10. Legacy migration and compatibility

- Keep legacy Shell and Core Approval files/modules for compatibility tests and deny-only reading; do not delete them in Slice 4.
- Remove `Approver` from production `NodeConfig`, `select_approver`, native dialog selection, and scripted-approver production composition. Test fakes may continue to exercise dormant legacy modules.
- Do not construct the old Core broker/gate/decision writer from `main.ts`.
- Legacy `never` remains a stricter compatibility floor when its mapping is exact.
- Legacy `always`, Shell `Remembered::Always`, process-global session entries, relaxed Level, and ambiguous keys are never authority.
- An unambiguous old allow may appear in `approval.list` as an inert reconfirmation candidate. Reconfirmation must show current canonical identity and the current future-background disclosure, then create a new canonical decision at the current generation.
- Ambiguous legacy identity fails closed and requires operator repair; never guess a server/tool/Host subject mapping.
- Do not create a third temporary decision store. Canonical decisions live only in SQLite; old files remain read-only migration inputs.

### 11. Affected-file map

The exact split can change during implementation, but these are the live seams that should be expected in review.

| Layer | Existing files / likely new domain | Required change |
| --- | --- | --- |
| Shared Approval | `packages/shared/src/approval-schema.ts`, tests, shared exports | Canonical request/respond/list/revoke/closed schemas, choices, presentation, disclosure, generation, lifecycle revisions |
| Shared Host control | `packages/shared/src/host-control-schema.ts`, `host-control-api.ts`, tests | Challenge evidence and resume authorization; protocol bump; cross-language fixtures |
| Core DB | `packages/core/src/db/migrations/015-approval.ts`, test, `index-list.ts` | Singleton generation and canonical durable decision table |
| Core Approval domain | replace/augment `packages/core/src/approval/*` | Repository, serialized service, pending broker, targeted subscription/notification, legacy reconfirmation adapter |
| Core connection | `server/connection-registry.ts`, `ws-server.ts`, tests | Core-minted session correlation, physical-connection ownership, per-connection removal cleanup |
| Core methods | `server/methods/approval-*.ts`, method index/registration, tests | respond with connection provenance; list/revoke; closed notification support |
| Core governed tools | `governance/governed-tool.ts`, MCP/Core/Skill adapters | Consult common Approval service at trusted classification seam; never invoke raw closure before authorization |
| Core Host routing | `capabilities/capability-broker.ts`, `route-capability.ts`, tests | Real generation; challenge/resume pending states; nested authorization; invalidation |
| Core composition | `packages/core/src/main.ts` | Construct one Approval service, register methods, inject adapters, remove dormant gate wiring |
| Rust protocol | `apps/desktop/src-tauri/src/protocol.rs` and protocol tests/fixtures | Mirror revised challenge/resume/authorization exactly |
| Rust Host session | `host_session.rs`, tests | Pending challenge binding, authorization generation/digest/deadline checks, one-use consumption and replay cache |
| Rust execution | `ws_client.rs`, tests | Classify -> challenge; handle resume; final revalidation; audit privacy; no prompt |
| Rust composition | `node.rs`, `lib.rs`, debug node composition | Remove production approver injection; preserve deny-only legacy readers/audit/classifiers |
| Desktop transport | `apps/desktop/src/lib/ws-client-routes.ts`, `ws-client-methods.ts`, `ws-client.ts`, tests | Per-client-generation Approval handlers and methods |
| Desktop UI | Home/chat window roots, new Approval modal/store, Settings decision section, component tests | Targeted one-dialog UX; session/disconnect behavior; fresh list/revoke; no persistence |
| CLI | `approval-prompt.ts`, `main.ts`, chat client/routes, tests | Common DTO, disclosure, explicit deny, targeted socket, list/revoke parity |
| Privacy | timeline/turn mapping, audit, cache tests, log source sweeps | Prevent pending raw input from every durable/diagnostic surface |
| E2E | `e2e/src/fixture/*`, new one-scenario-per-file tests | Real Core/operator/Host/MCP lifecycle, two-socket ownership, restart/revoke, replay/tamper, privacy |

### 12. Independently testable implementation batches

#### Batch A: canonical state and schemas

- Add common operator schemas and SQLite migration/repository/service.
- Freeze canonical binding, disclosure revision, scope ceiling, and generation mutation rules.
- Keep production `ask` fail-closed; do not enable prompts yet.
- Proof: schema round trips, migration once/reopen, no-op/material generation tests, list/revoke/restart, no raw input columns.

#### Batch B: Core-local/MCP interactive lifecycle

- Add connection-owned pending broker and same-`Connection` respond provenance.
- Wire governed Core-local/MCP adapters to one targeted prompt.
- Add timeout, cancel, policy invalidation, session teardown, list/revoke, and closed notification.
- Proof: two sockets with same device id; wrong-socket response rejected; closing one socket affects only its state; raw execution closure invoked once only after allow.

#### Batch C: Host challenge/resume

- Revise shared/Rust protocol and bump version.
- Add Host classification challenge, immutable-control/nested-authorization resume, and exact at-most-once validation.
- Remove production Rust approver composition and pending-input audit writes.
- Proof: generation transition matrix, tamper/replay/reconnect/cancel tests, cross-language fixtures, Rust unit/integration tests.

#### Batch D: operator product surfaces

- Add Desktop per-socket modal and fresh decision management surface.
- Update CLI presentation/disclosure and list/revoke parity.
- Proof: client-generation retirement clears dialogs, same-device second window cannot answer, scope ceilings are rendered and server enforced, no localStorage writes.

#### Batch E: legacy reconfirmation and end-to-end privacy

- Expose only unambiguous inert legacy allow candidates and preserve exact denies.
- Complete timeline/audit/log/cache/error source sweeps.
- Add real process E2E for Core-local/MCP and Host paths.
- Proof: legacy allow never executes before reconfirmation; legacy deny still narrows; repository/log/audit/timeline/cache scans contain no sentinel pending secret/input.

Each batch must leave the tree fail-closed and independently testable. Batch C must not land a temporary Host-local prompt if Batch B is incomplete.

### 13. Verification matrix

| Risk | Required proof |
| --- | --- |
| Canonical identity drift | Descriptor/subject/classifier/disclosure revision change makes old decision inert; display-name changes do not create a new grant accidentally |
| Material/no-op generation | One increment per material mutation/teardown batch; zero for once, current deny, timeout, unknown revoke, repeated identical write |
| Session ownership | Two simultaneous physical connections with same `deviceId`; grant from A works only for A; B still asks; A close removes A only |
| Pending ownership | Response from B to A's approval id returns `wrong_session`; no detail leaks; A can still answer |
| One dialog | Core-local/MCP and Host actions each emit exactly one prompt; Rust native approver is never invoked |
| Scope ceiling | `once-only` rejects session/always at schema/service level even from a handcrafted client frame |
| Background disclosure | Always without current acknowledgement fails; current acknowledgement persists; later revision makes it inert until reconfirmed |
| Durable restart | Always survives SQLite close/reopen; session and pending do not; generation prevents pre-restart resume |
| Revoke/policy change | Future matching use stops immediately; pending/authorization invalidated; durable rows are deleted only by explicit revoke/reconciliation rule |
| Host exact binding | Original control exact; nested authorization binds control/challenge/decision digests; tampering any field executes zero effects |
| At-most-once | Duplicate challenge/respond/resume/terminal, late response, cancel race, Host reconnect, and route replacement start at most one effect |
| Unattended behavior | Heartbeat and no-operator calls never notify a UI; scheduled remains a structured pause/skip boundary, not surprise prompting |
| Legacy compatibility | Exact legacy denies hold; old allows/process sessions are inert; ambiguous/corrupt state fails closed; reconfirm creates one canonical row |
| Privacy | Sentinel raw input/secret absent from SQLite, old/new decision files, Core/Rust logs, audit, timeline, run history, cache/localStorage, error responses, and crash diagnostics |
| Desktop parity | Chat-socket prompt renders in that window; settings socket receives none; dialog clears on close/invalidation; list/revoke reads fresh Core state |
| CLI parity | Same choices and disclosure semantics; unknown/late prompt handling is fail-closed; no implicit never |

Use the established test layers:

- Shared Vitest schema and protocol-fixture tests.
- Core repository/service/broker/method/adapter tests with real file-backed restart cases.
- Rust unit tests in `host_session.rs`, `ws_client.rs`, and protocol fixtures; `cargo test` and `cargo clippy -D warnings`.
- Desktop route/store/component/cache tests and production build/typecheck.
- CLI prompt, routing, disconnect, and operator-call tests.
- One scenario per E2E file through `withStack`; use the relay only for adversarial Host frame mutation, and assert bounded no-replay/no-audit-growth behavior as in the existing stale-projection test.

### 14. Merge hotspots and sequencing hazards

- `packages/shared/src/host-control-schema.ts`, Rust protocol mirrors, and fixtures must move together; a partial merge causes unsafe mixed protocol behavior.
- `packages/core/src/main.ts`, method registration, governed MCP/Core adapters, and connection cleanup are shared Slice 4 hotspots. Merge the state/service foundation before parallel client/Host wiring.
- `packages/core/src/db/migrations/index-list.ts` is append-only and likely to conflict with other slices adding migrations. Re-number against moving main immediately before merge; never reuse a version.
- `apps/desktop/src/lib/ws-client*` is shared by multiple Home features. Approval handlers must preserve generation retirement, request deadlines, and existing timing-policy subscriptions.
- Home has two sockets by design. A global singleton Approval store or Tauri broadcast would violate session ownership even if the UI appears to work locally.
- Removing `Approver` from Rust composition touches `lib.rs`, `node.rs`, and the debug binary/harness. Preserve test-only legacy modules and adjust the E2E scripted bypass deliberately rather than deleting it blindly.
- Timeline persistence and Rust audit are privacy hotspots: a functional prompt can pass behavioral tests while still leaking exact pending input.
- Do not release a branch state that enables canonical prompts on Core-local/MCP paths while Host `ask` still opens or can fall back to a native dialog.

### 15. Files found

- `packages/shared/src/approval-schema.ts` - legacy MCP-only operator Approval shapes.
- `packages/shared/src/host-control-schema.ts` - canonical Host control, minimal challenge/resume, governance evidence.
- `packages/shared/src/governance-registry.ts` - descriptor revisions and `approvalMemory` ceilings.
- `packages/core/src/approval/` - dormant old broker, decision file, and AI SDK gate.
- `packages/core/src/mcp/legacy-mcp-deny.ts` - production deny-only legacy adapter.
- `packages/core/src/governance/governed-tool.ts` - current common fail-closed governance wrapper.
- `packages/core/src/capabilities/capability-broker.ts` - sealed Host request/terminal owner and current generation placeholder.
- `packages/core/src/capabilities/canonical-input.ts` - exact input canonicalization/digest.
- `packages/core/src/server/connection-registry.ts` - physical socket identity and removal events.
- `packages/core/src/server/ws-server.ts` - socket-local notify and close callback owner.
- `packages/core/src/db/migrations/014-governance-policy.ts` - singleton generation/storage precedent.
- `packages/core/src/governance/governance-policy-repo.ts` - atomic mutation/no-op generation precedent.
- `packages/core/src/agents/turn-mapping.ts` - current tool-call/result timeline persistence hotspot.
- `apps/desktop/src-tauri/src/ws_client.rs` - live Host classification/final enforcement and current fail-closed ask.
- `apps/desktop/src-tauri/src/host_session.rs` - exact control binding, duplicate suppression, and terminal cache.
- `apps/desktop/src-tauri/src/gate.rs` - legacy Gate plus Slice 3 audit/deny compatibility.
- `apps/desktop/src-tauri/src/gate/decisions.rs` - deny reader and dormant legacy writers.
- `apps/desktop/src-tauri/src/gate/approver.rs` - native/scripted prompt implementations to remove from production composition.
- `apps/desktop/src-tauri/src/node.rs` and `lib.rs` - current approver composition.
- `apps/cli/src/approval-prompt.ts` and `main.ts` - existing targeted CLI prompt path and disclosure gap.
- `apps/desktop/src/lib/ws-client.ts` and `ws-client-routes.ts` - per-window operator transport seam.
- `apps/desktop/src/windows/home/pages.ts` - current Home page registry with no Approval surface.
- `apps/desktop/src/lib/cache-persist.ts` - closed persistent-cache allow-list.
- `e2e/src/fixture/with-stack.ts`, `operator-drivers.ts`, and `ws-relay.ts` - full-stack process harness and adversarial frame seam.
- `e2e/src/governance-authority.e2e.test.ts` and `governance-stale-projection.e2e.test.ts` - current real-process policy and no-replay patterns.

### 16. Code patterns to reuse

- Material mutation exactly once/no-op zero: `packages/core/src/governance/governance-policy-repo.ts:121-153`.
- Migration transaction and reopen safety: `packages/core/src/db/migration-runner.ts:13-40`; `packages/core/src/db/migrations/014-governance-policy.test.ts:15-30`.
- Same-socket server push and close cleanup: `packages/core/src/server/ws-server.ts:42-58,125-136`.
- Physical connection removal listeners: `packages/core/src/server/connection-registry.ts:84-96,110-121`.
- Full Host control equality and provenance before terminal settlement: `packages/core/src/capabilities/capability-broker.ts:137-174,269-270`.
- Host duplicate/cancel/terminal exact binding: `apps/desktop/src-tauri/src/host_session.rs:64-128,260-331`.
- Per-capability policy-lineage conflict rejection: `apps/desktop/src-tauri/src/host_session.rs:136-160,446-482`.
- Operator channel auto-unsubscribe precedent: `.trellis/spec/backend/server-push-and-connection-auth.md:7-12`.
- Fresh-generation permission state and no cache: `.trellis/spec/frontend/state-management.md:28-30`; `.trellis/spec/frontend/home-window.md:35-49`.
- Test-only relay with bounded no-replay assertions: `.trellis/spec/backend/e2e-harness.md:24-35`; `e2e/src/governance-stale-projection.e2e.test.ts:43-65`.

### 17. External references

No new external fetch was required for this live-source map. Relevant prior research already grounded the boundary in:

- MCP specification revision `2025-11-25` - human-in-the-loop guidance is not a standard Approval persistence or generation protocol; Taki must define its own lifecycle.
- Installed `@ai-sdk/mcp@2.0.10` - current MCP closures are prepared around a specific client generation; the common Approval service must authorize before invoking the raw closure.
- `.trellis/tasks/08-10-skills-mcp-productization/research/standards-and-reference-prior-art.md:214-226` - canonical MCP identity, explicit future-background disclosure, and unattended fail-closed convention.
- `.trellis/tasks/08-10-skills-mcp-productization/research/vps-secret-backend-options.md:69-95,265-280` - asymmetric sensitive APIs, no secret echo, and failure handling; reused here only for privacy posture, not credential implementation.

### 18. Related specs and decisions

- `.trellis/spec/backend/permission-authorization.md` - canonical governance registry, stricter-wins authority, hard floors, operator-only mutation.
- `.trellis/spec/backend/host-operation-lifecycle.md` - sealed Host control, generation ownership, cancellation, at-most-once and outcome-unknown boundaries.
- `.trellis/spec/backend/server-push-and-connection-auth.md` - socket-local push, auto-cleanup, and connection authentication boundaries.
- `.trellis/spec/backend/database-guidelines.md` - numbered TypeScript migrations and repository-per-aggregate pattern.
- `.trellis/spec/backend/logging-guidelines.md` - separate audit and no-secret logging boundary.
- `.trellis/spec/backend/e2e-harness.md` - real-stack L1 coverage, relay constraints, and no-content-in-logs assertions.
- `.trellis/spec/frontend/state-management.md` - Core as durable source of truth and closed persistent-cache allow-list.
- `.trellis/spec/frontend/home-window.md` - independent per-window sockets and fresh-generation permission state.
- `.trellis/tasks/08-12-governance-authority/research/live-governance-migration-map.md` - Slice 3/4 ownership, deny-only legacy rule, canonical policy projection, and current fail-closed seam.
- `docs/HANDOFF.md` - Slice 3 verified baseline and prohibition on releasing between governance and Approval productization.

## Caveats / Not Found

- No canonical Approval repository, service, migration, list/revoke API, Desktop dialog, or production prompt wiring exists yet.
- `CapabilityChallenge` and `CapabilityResume` are only minimal TypeScript schemas; no Rust mirror/handler for their current shapes was found in the live execution path.
- The immutable-control plus nested post-decision authorization contract is the concrete recommendation from this research. It must be frozen in the Slice 4 technical design and cross-language fixtures before implementation; silently retaining `approvalGeneration: 1` is not acceptable.
- The exact canonical subject vocabulary for every future Host/Skill/MCP class is not fully enumerated here. Slice 4 needs only the subjects exercised by current governed capabilities; unknown/unstable subjects remain once-only or fail closed.
- Safe operator presentation schemas for exec, shell-open, MCP arguments, and future secret-bearing inputs are not currently defined. Raw `JSON.stringify(input)` is explicitly not the fallback.
- Immediate revocation means no future dispatch or not-yet-consumed authorization may proceed. An already-started non-cooperative side effect can still settle `outcome_unknown`; the product must not claim distributed rollback.
- Scheduled/Heartbeat Run Receipt pause/resume is outside this task. This research defines only the no-surprise-prompt boundary those later contracts must consume.
- Existing general timeline tool-part persistence and Shell audit rules predate this PRD. They require focused privacy changes/tests where they would capture a pending Approval input; this artifact does not redesign all historical tool/audit records.
- No external MCP server, real secret, paid service, production deployment, GUI, or network endpoint was invoked. Findings are based on current repository source, tests, specs, and retained prior research.
