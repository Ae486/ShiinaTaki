# Approval Productization Technical Design

> Engineering record for Slice 4. This document freezes the approved contracts and independently fail-closed batch
> boundaries. Batch A is implemented and formally checked. The combined B+D interactive wave is implemented and
> Leader-verified at `2c1c4e5`; C+E remain the binding implementation plan before the Slice's sole final xhigh check.

## 1. Architectural result

Approval becomes one Core authority layered between canonical governance and final execution:

```text
trusted adapter + CanonicalCapabilityIdentity
                  |
                  v
       Core governance at policyGeneration P
                  |
       auto -------+------- deny
                  |
                 ask
                  |
                  v
       Core Approval at approvalGeneration A
          |                         |
          v                         v
 Core/MCP closure          Host challenge -> resume
                                  |
                                  v
                       Host stricter revalidation
                                  |
                                  v
                          execute at most once
```

This is not one physical process for every gate. It is one authority contract with trusted last-mile adapters. Core
owns global policy and Approval decisions; the Host owns trusted argument classification, local/managed/hard floors,
and final OS execution. MCP remains `@ai-sdk/mcp`; Skills remain portable `SKILL.md` packages.

The dormant `approval-broker.ts`, `decision-store.ts`, and `approval-gate.ts` remain historical compatibility/test
inputs until the migration slice finishes. Production must not compose them or copy their global `denyAll`,
process-lifetime session map, MCP display-name keys, arbitrary input presentation, or JSON decision writer.

## 2. Canonical identity and decision binding

Slice 4 reuses the existing Shared identity without introducing a parallel Approval subject model:

```typescript
type ApprovalDecisionBinding = {
  bindingRevision: number;
  identity: CanonicalCapabilityIdentity;
  descriptorRevision: number;
  classifierId: string;
  classifierRevision: number;
  cellKey: PermissionCellKey;
  decisionScopeDigest: string;
};

type ApprovalDurableDecisionBinding = ApprovalDecisionBinding & {
  disclosureRevision: number;
};
```

The binding rules are:

- `identity.capabilityId`, `identity.ownerHostId`, and the optional `{subjectId, revision}` come from the trusted
  Governance adapter. Approval does not parse a display label, path, MCP key, or Skill text to recreate them.
- `bindingRevision` versions the canonical encoding. A future encoding change cannot reinterpret an old digest.
- `descriptorRevision`, `classifierId`, `classifierRevision`, and `cellKey` must match the current canonical registry
  and trusted classification result.
- `decisionScopeDigest` is lowercase SHA-256 over a domain-separated canonical scope produced by Core from trusted
  identity/classification data. It contains no raw input, command, path, secret, or presentation detail.
- `inputDigest` remains the exact-attempt binding in `HostOperationControl`. It is neither persisted as a remembered
  grant key nor treated as a stable subject identity.
- `ApprovalDecisionBinding` is the base exact/session identity and has no disclosure field.
  `ApprovalDurableDecisionBinding` adds the required current disclosure revision for always-allow authority.
- A descriptor marked `subjectRequired` cannot receive remembered authority without the exact stable subject and
  revision. Missing/unstable identity is once-only or closed.
- A descriptor cell marked `approvalMemory: "once-only"` cannot receive session or durable authority regardless of
  client input.

Shared exposes deterministic domain-separated serializers. The decision-scope payload is fixed-order canonical JSON
of `{ domain: "taki.approval.decision-scope", revision: 1, identity, descriptorRevision, classifierId,
classifierRevision, cellKey }`. The durable binding payload is fixed-order canonical JSON of
`{ domain: "taki.approval.binding", revision: 1, identity, descriptorRevision, classifierId, classifierRevision,
cellKey, decisionScopeDigest, disclosureRevision }`. Core hashes the durable serialization to a lowercase SHA-256
`bindingDigest`. A future scope field requires a revision bump; locale, insertion order, display text, and client
serialization never affect the digest.

## 3. Shared operator protocol

### 3.1 Methods and revisions

The common operator method set is:

```typescript
const APPROVAL_METHODS = {
  request: "approval.request",
  respond: "approval.respond",
  closed: "approval.closed",
  list: "approval.list",
  revoke: "approval.revoke",
} as const;
```

Shared also owns positive integer constants for the Approval presentation revision and future-background disclosure
revision. Clients accept only schemas they understand; a stale disclosure acknowledgement cannot create durable
authority.

### 3.2 Choices and response

The wire choices are explicit values rather than `approved + scope` combinations:

```typescript
type ApprovalChoice = "allow_once" | "allow_session" | "allow_always" | "deny";

type ApprovalDisclosureAck = {
  revision: number;
  futureBackgroundUseAccepted: true;
};
```

`approval.respond` carries `approvalId`, `choice`, `expectedApprovalGeneration`, and an optional disclosure
acknowledgement. The server rejects a disallowed choice, missing/currently false disclosure, stale generation, wrong
connection, or retired request even when a handcrafted client bypasses the UI.

The response is a bounded status plus the current `approvalGeneration`:

```text
accepted | late | wrong_session | invalidated | scope_not_allowed |
stale_generation | disclosure_required
```

Unknown/late/wrong-session responses are normal fail-closed results. They never include the pending request or identify
the owning socket.

### 3.3 Safe presentation

`approval.request` contains no raw execution input. It carries:

- UUID `approvalId` and absolute `expiresAt`;
- current `policyGeneration` and `approvalGeneration`;
- the validated canonical decision binding;
- server-computed allowed choices; and
- a versioned `ApprovalPresentation` containing bounded title, capability/subject labels, risk summary, and bounded
  sections/fields of already-redacted strings.

Presentation fields are strict, length/array bounded, and adapter/classifier owned. Detail is a bounded array of
redacted sections and bounded label/value fields, never `unknown` or arbitrary JSON. Secret-bearing data is represented
only as presence or purpose. Client-side `JSON.stringify(input)` is not part of the new protocol.

`approval.closed` carries only `approvalId`, current generation, and one fixed reason: `answered`, `denied`, `expired`,
`cancelled`, `operator_disconnected`, `host_disconnected`, `policy_changed`, `approval_generation_changed`, or
`route_replaced`. It targets the same physical connection that received the request.

### 3.4 List and revoke

`approval.list` returns the current generation/revisions plus durable canonical decisions and, in Batch E, inert legacy
reconfirmation candidates. A decision row contains its id, binding, allow verdict, provenance category, timestamps,
optional bounded safe labels, and binding eligibility. Batch A does not evaluate live Governance posture. Its inert
reason is a closed enum covering binding revision, unknown capability/cell, descriptor/classifier/subject mismatch, and
stale disclosure. It excludes raw input, challenge evidence, secret values, socket identity, and mutable display text
as authority.

`approval.revoke` carries `decisionId` and `expectedApprovalGeneration` and returns `revoked` or `not_found` plus the
current generation. A current-generation material revoke removes one durable row and advances once. A
current-generation unknown id is a no-op with zero increments. A stale expected generation returns conflict before
mutation, even when the requested final state would otherwise be a no-op.

## 4. SQLite and repository contract

Batch A uses migration `015-approval` if the live registry still ends at `014` immediately before implementation.
The minimum durable schema is:

```sql
CREATE TABLE approval_state (
  singleton_id                 INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  approval_generation          INTEGER NOT NULL CHECK (approval_generation > 0),
  governance_registry_revision INTEGER NOT NULL CHECK (governance_registry_revision > 0),
  disclosure_revision          INTEGER NOT NULL CHECK (disclosure_revision > 0),
  updated_at                   TEXT NOT NULL
) STRICT;

CREATE TABLE approval_decisions (
  decision_id           TEXT PRIMARY KEY,
  binding_revision      INTEGER NOT NULL CHECK (binding_revision > 0),
  binding_digest        TEXT NOT NULL UNIQUE
                        CHECK (length(binding_digest) = 64 AND binding_digest = lower(binding_digest)
                               AND binding_digest NOT GLOB '*[^0-9a-f]*'),
  capability_id         TEXT NOT NULL,
  owner_host_id         TEXT NOT NULL,
  subject_id            TEXT,
  subject_revision      TEXT,
  descriptor_revision   INTEGER NOT NULL CHECK (descriptor_revision > 0),
  classifier_id         TEXT NOT NULL,
  classifier_revision   INTEGER NOT NULL CHECK (classifier_revision > 0),
  cell_key               TEXT NOT NULL,
  decision_scope_digest TEXT NOT NULL,
  disclosure_revision   INTEGER NOT NULL CHECK (disclosure_revision > 0),
  provenance            TEXT NOT NULL CHECK (provenance IN ('operator', 'legacy-reconfirmation')),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK ((subject_id IS NULL) = (subject_revision IS NULL))
) STRICT;
```

All stored decisions are durable allows; there is no durable verdict column in the MVP. Exact legacy denies remain
Governance constraints rather than being copied into this table.

The repository is the only SQL owner and exposes synchronous operations with no asynchronous gap:

- read the authority state and ordered decisions;
- reconcile the current registry/disclosure revisions;
- create a durable allow at an expected generation;
- revoke one durable allow at an expected generation;
- advance the generation once for a future material session mutation/teardown batch; and
- read/reconcile restart state.

Every write validates the expected generation inside the same SQLite transaction before no-op detection. Material
decision create/revoke and generation advance commit together. Duplicate identical `bindingDigest` create is a no-op
only when every recomputed canonical binding column is identical; the same digest with different columns is
corruption/collision and fails closed. Unknown revoke at the current generation is a no-op. A stale writer
throws/returns a typed conflict without changing rows.

Migration and repository tests must inspect the real column set and prove that there is no column capable of carrying
raw input, presentation, command, path, challenge, socket, or secret data.

## 5. Process epoch and generation semantics

`approvalGeneration` is durable global authority lineage, not a row id. The initial migration creates generation `1`
with the current registry/disclosure revisions. At Core Approval composition, Core mints one random in-memory process
epoch used only by pending/session/authorization records and never persisted or sent as client authority:

- restart produces a new epoch and discards all old in-memory state without incrementing durable
  `approvalGeneration`;
- old pending/resume authority is rejected by epoch mismatch plus retired operator/Host connection provenance;
- a registry/disclosure reconciliation increments once only when it materially changes durable authority usability or
  removes authority, not once per field;
- an empty decision table or revision metadata change that leaves every canonical decision equally usable advances
  zero times;
- a database registry/disclosure revision newer than the running binary fails startup;
- older stored revisions reconcile to the current values and make old rows dynamically inert where their binding no
  longer matches.

Normal generation effects are:

| Event | Increment |
| --- | ---: |
| material durable allow create/change | 1 |
| material durable revoke | 1 |
| material session create/change | 1 |
| one connection teardown removing one or more session grants | 1 |
| material registry/disclosure reconciliation batch | 1 |
| process restart/epoch rotation alone | 0 |
| allow once, current deny, timeout, late response | 0 |
| identical durable/session no-op | 0 |
| unknown revoke at current generation | 0 |

Batch A implements durable state plus the generic generation-advance seam. Batch B adds session maps and pending
invalidation through the same synchronous service. The service must not contain `await` inside a mutation critical
section; if later work needs asynchronous preparation, it happens before entering the serialized mutation.

## 6. Approval authority service

The Core service sits above the repository and canonical registry. Batch A responsibilities are:

1. validate a candidate binding against `CanonicalCapabilityIdentity`, the current descriptor/classifier/cell, subject
   requirement, `approvalMemory`, disclosure revision, and canonical SHA-256 digests;
2. mint one in-memory process epoch and reconcile durable authority revisions;
3. grant/list/revoke durable always-allow decisions with optimistic generation semantics;
4. report whether a stored decision is currently usable or inert because of descriptor/classifier/subject/disclosure
   drift; and
5. expose a narrow generation-advance primitive for the connection-owned session work in Batch B.

The service does not compose into `main.ts`, install operator methods, open prompts, execute tools, own a `Connection`,
or alter production `ask` in Batch A. `GovernancePolicyService.authorize()` must continue returning structured
`APPROVAL_REQUIRED` for effective `ask` until Batch B installs the complete Core-local/MCP interactive lane.

Stored decisions are not deleted merely because policy temporarily changes. Current Governance is evaluated first;
hard/managed/legacy deny always wins. A previously valid allow may become usable again only when its complete canonical
binding and current disclosure remain valid.

## 7. Physical-connection session contract

Batch B keys transient authority by the exact Core `Connection` object:

```text
physical WebSocket
  -> Core Connection object
  -> pending requests + session decisions
  -> connectionRegistry.onRemove cleanup
```

The pending index is `approvalId -> { owner: Connection, ... }`, with a bounded reverse
`Connection -> Set<approvalId>` for cleanup. Session decisions are
`Map<Connection, Map<bindingDigest, SessionDecision>>`.

`approval.respond` passes `ctx.connection` into the resolver and succeeds only on object identity. `deviceId` remains
authentication metadata and cannot join Home/Chat/Pet/CLI sockets into one Approval session. Notifications use the
owner's existing `Connection.notify`; Approval is not a broadcast subscription.

`connectionRegistry.onRemove` cancels only that connection's pending requests, deletes its session map, and performs
one generation advance only when at least one session decision existed. It never calls the legacy broker-wide
`denyAll`.

## 8. Host challenge/resume transition

Batch C keeps the original `HostOperationControl` exact and adds:

```typescript
type CapabilityAuthorization = {
  authorizationId: string;
  approvalGeneration: number;
  decisionScope: "once" | "session" | "always";
  controlDigest: string;
  challengeDigest: string;
  decisionScopeDigest: string;
  issuedAt: string;
  expiresAt: string;
};
```

The Host challenge includes existing governance evidence, a canonical trusted classification/challenge digest, and a
safe presentation. It never prompts locally or audits pending raw input.

Transition:

1. Core seals the request at generation `G`.
2. Host stores/classifies it and returns one challenge with the exact control.
3. Core verifies Host/connection/catalog/policy/control provenance and prompts the initiating operator connection.
4. Allow once mints a single-use authorization at `G`.
5. A material session/always answer commits at `G+1`; the same synchronous service transition invalidates other old
   pending/authorization entries and mints one `G+1` authorization for the initiating request only.
6. Host checks request/challenge/control/all digests/generation/deadlines/current connection and consumes
   `authorizationId` before execution.
7. Terminal response echoes the immutable outer control; Core also matches the pending nested authorization lineage.

The Host-control protocol version and TypeScript/Rust golden fixtures move together. Mixed versions fail negotiation;
there is no compatibility fallback to a native prompt or hard-coded generation.

## 9. Privacy lifecycle

Raw pending input is memory-only in three places: the active Core pending record, the active Host request/challenge
record, and the initiating client generation's dialog state. It is cleared on answer, deny, timeout, cancellation,
policy/Approval generation change, route replacement, operator/Host disconnect, Core shutdown, or settlement.

Review must sweep and test:

- Core/Rust structured logs and generic error data;
- Rust audit JSONL, especially the current `ask` command path;
- timeline/turn mapping, future Run history, summaries, and Memory;
- SQLite, legacy JSON files, config, migration markers, and crash diagnostics;
- Desktop persistence allow-lists, Zustand/SWR/localStorage, navigation, and Tauri events; and
- CLI generic output/error/history paths.

Only sanitized labels, revision/generation metadata, decision ids, canonical digests, and terminal status may persist.

## 10. Batch A implemented boundary

### Expected production files

- `packages/shared/src/approval-schema.ts` — replace legacy MCP shapes with canonical strict binding, presentation,
  choice, request/respond/closed/list/revoke schemas.
- `packages/shared/src/approval-decision-schema.ts` — isolate canonical binding, version constants, disclosure,
  serializer/digest payload, durable row, and list DTOs from the operator lifecycle envelope.
- `packages/shared/src/approval-api.ts` — focused named facade so the package root remains maintainable.
- `packages/shared/src/legacy-approval-schema.ts` — compatibility-only `LegacyApproval*` shapes used by dormant Core
  modules and the current CLI until Batch B migrates them; canonical authority never imports this leaf.
- `packages/shared/src/index.ts` and `packages/shared/src/index.md` — preserve all current Host/Governance exports while
  exposing the new Approval contract.
- `packages/core/src/db/migrations/015-approval.ts`, `index-list.ts`, and migration `index.md` — append-only migration
  registration after a live numbering check.
- `packages/core/src/approval/approval-state-repo.ts` — sole SQL writer for state/decisions/generation transactions.
- `packages/core/src/approval/approval-decision-service.ts` — registry/disclosure validation, canonical digests,
  process epoch, durable grant/list/revoke, usability, and generic session-generation seam.
- `packages/core/src/approval/index.md` — mark the old broker/gate/store as dormant legacy and document the new
  authority modules.
- `packages/core/src/db/index.md` and `packages/core/src/index.md` — record the new durable authority/repository without
  implying that prompt wiring is active.

New or materially rewritten production files carry the standard English `INPUT`/`OUTPUT`/`POS` header. If the final
implementation needs one additional small binding helper to keep files under the project size limit, it remains within
Batch A and receives tests/index documentation.

### Required tests

- Shared strict accept/reject and round-trip matrix for identity/binding, bounded presentation, allowed choices,
  disclosure, every method/result, unknown fields, and absence of legacy raw `input` protocol.
- Canonical serialization/digest determinism under property insertion/order changes and distinction across every
  authority field.
- Migration once/reopen, singleton/defaults, table constraints, subject-pair constraint, unique binding digest, and
  explicit no-sensitive-column inspection.
- Repository material/no-op create, material/unknown revoke, stale conflict rollback, revision reconciliation once,
  downgrade failure, ordered list, and file-backed restart; service tests prove process-epoch rotation changes no
  durable generation while invalidating in-memory authority.
- Service descriptor/classifier/cell/subject/disclosure validation, once-only rejection, active/inert evaluation,
  duplicate allow no-op, and no raw input in persisted records.
- Focused Shared/Core tests, affected package typecheck/lint, production header/index/size audit, and
  `git diff --check`.

### Explicit Batch A non-goals

- No `main.ts`, `chat-agent.ts`, governed closure, method registration, `Connection`, pending broker, Desktop, CLI,
  Host-control, Rust, audit, or E2E production wiring.
- No prompt becomes live. Effective `ask` remains fail-closed.
- No legacy file is deleted or written, and no new dependency is expected.
- No Approval-specific shared global `ErrorCode` is added before Batch B freezes JSON-RPC mapping and cross-language
  implications; Batch A uses typed Core-domain errors.

### Closure evidence

Batch A passed workspace typecheck, root lint, full Shared/Core/CLI/Desktop tests, focused Approval tests,
`git diff --check`, production header/index/size audits, and a real Core boot that applied migrations `1..15`. The
formal check additionally repaired candidate digest spoofing, distinguished digest mismatch from canonical-column
collision, validated stored digests before revision reconciliation, and separated historical stored-row grammar from
strict current grant grammar. Rust, packaged WebView, and Host challenge/resume verification remain intentionally
unverified because Batch A did not modify or activate those layers.

## 11. Remaining boundaries and proportional checks

The Batch B-E labels remain useful technical boundaries, but they are not separate formal-check cycles. The remaining
work is executed as two coherent waves: B+D for the interactive Core/MCP and operator-client vertical, then C+E for
Host authorization plus legacy/privacy/process convergence. The full Slice receives one xhigh formal check after both
waves; focused tests and Leader review remain continuous.

- **Batch B** adds connection-owned Core-local/MCP prompting and common methods. It is implemented in the same
  interactive wave as Batch D, with focused Core/CLI protocol tests and no intermediate formal check.
- **Batch C** changes Shared/Rust Host protocol and at-most-once enforcement. The Host/convergence wave requires golden
  fixtures, Rust test/Clippy/rustfmt, and adversarial replay/tamper proof; its findings are reviewed by the Slice's one
  final xhigh formal check.
- **Batch D** completes the interactive wave with Desktop/CLI surfaces, connection-retirement and no-cache tests,
  production build, and truthful manual-verification status.
- **Batch E** completes the Host/convergence wave with legacy/privacy/process E2E and documentation convergence, then
  runs the complete release-quality task gate and the Slice's sole final xhigh formal check.

### B+D interactive-wave checkpoint

Commit `2c1c4e5` activates the common interactive lane for Core-local and MCP tools without creating another authority
system. Core remains the sole authority: Governance evaluates the canonical binding, one connection-owned Approval
interaction resolves `ask`, and Governance plus the complete binding/policy lineage are revalidated immediately before
the original closure can execute. Pending and session authority are keyed by the exact physical `Connection`; process
epoch, policy generation, Approval generation, and the full binding must all remain current.

The same checkpoint adds targeted `approval.request`/`approval.closed` routing, canonical respond/list/revoke methods,
CLI and Desktop FIFO prompt controllers, explicit future-background disclosure acknowledgement, Core-backed durable
decision management, connection/client retirement, expiry backstops, and no-cache tests. MCP still uses the installed
`@ai-sdk/mcp` discovery/call closures. Raw tool-call input is removed before new timeline writes and is sanitized from
legacy timeline reads, so it cannot enter timeline APIs or model replay.

Leader verification passed Shared/Core/CLI/Desktop typecheck, 254 Shared tests, 130 focused Core Approval/Governance/
MCP/privacy tests, 36 CLI tests, 386 Desktop tests, changed-production-file ESLint, `git diff --check`, 35 production
header audits, and the Desktop production build (1,290 modules). The build emitted only the existing Live2D non-module
script warnings. Full Core verification by the implementation agent passed 1,290 tests with one existing skip.

Manual packaged-WebView interaction and a real Core/operator process run remain unverified. Historical timeline rows
that predate this privacy boundary are sanitized on read but are not physically rewritten; Batch E must decide and
prove whether a targeted maintenance scrub is required before claiming the final SQLite privacy acceptance criterion.
No formal `trellis-check` ran for this internal wave, by design.

## 12. Merge and release risks

- `packages/shared/src/index.ts` already contains T4-only Host/Governance exports. Never replace it with the older
  `main` version while resolving Approval exports.
- `packages/core/src/db/migrations/index-list.ts` is append-only and migration `015` is provisional until rechecked
  immediately before implementation and every later main merge.
- `packages/core/src/main.ts`, `chat-agent.ts`, operator method registration, `ws-client*`, Home registration, specs,
  HANDOFF, and the journal are semantic hotspots with mainline Memory/Hindsight/reconnect work.
- A shared-file merge resolves both contracts field by field and reruns focused tests. Do not choose an entire side,
  manually copy patches between worktrees, or rebase.
- Do not release the parent between Governance and Approval. Do not release a state where Core-local/MCP prompting is
  live while Host `ask` can still open or fall back to a second prompt.
