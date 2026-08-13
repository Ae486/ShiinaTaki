# Unified Approval Lifecycle and Operator Surfaces

## Goal

Install one Core-owned Approval authority for every canonical capability that resolves to `ask`. The lifecycle must
preserve standard MCP execution and portable `SKILL.md` packages, bind every decision to the existing canonical
governance identity, target one initiating operator connection, and resume Host execution only through a sealed,
single-use authorization.

## Dependencies

- `08-12-host-control-foundation` is implemented and committed at `7427edf`; it remains in `review` until the final
  two-Node convergence gate.
- `08-12-governance-authority` is implemented, formally checked, and committed at `46a8487`; it remains in `review`
  because effective `ask` deliberately fails closed until this child is complete.
- Batch A appended `015-approval` after verifying that the live migration baseline ended at `014-governance-policy`.
  Recheck the registry and `main...HEAD` before every later batch and after every mainline merge; renumber only through
  an append-only semantic merge if another branch claims `015` before integration.

## Execution Status

- Batch A canonical schemas/state is implemented and formally checked. Production `ask` still returns structured
  `APPROVAL_REQUIRED`; no prompt, method registration, governed execution closure, Host protocol, Rust, or Desktop
  lifecycle was activated.
- Batch A verification passed workspace typecheck, lint, full Shared/Core/CLI/Desktop tests, focused Approval tests,
  `git diff --check`, production header/index/size audits, and a real Core boot through migrations `1..15`.
- Batch B Core-local/MCP connection-owned interaction is the next implementation boundary. Batches C-E remain open.

## Productization Boundary

- Core is the sole global Approval authority. The owning Execution Host remains the trusted classifier and final
  stricter enforcer, but it cannot create durable authority or display a second prompt.
- This child extends the common Governance and Host-control contracts. It does not create an MCP-only gate, a
  Shell-only prompt, a Skill permission product, or any third decision store.
- MCP remains standard MCP through the installed `@ai-sdk/mcp` client and its raw-name execution closure. A Skill
  remains an open `SKILL.md` package whose instructions never grant permission.
- The existing `CanonicalCapabilityIdentity` is the authority identity. Display names, paths, commands, prompt text,
  model-facing tool keys, MCP annotations, Skill metadata, client caches, and conversational claims never become
  authority keys.

## Requirements

### Canonical Approval contract

- Replace the legacy MCP-shaped request with strict, versioned Shared schemas for `approval.request`,
  `approval.respond`, `approval.closed`, `approval.list`, and `approval.revoke`.
- Use a base binding `{ bindingRevision, identity: CanonicalCapabilityIdentity, descriptorRevision, classifierId,
  classifierRevision, cellKey, decisionScopeDigest }` for exact/session authority. Durable always-allow extends it
  with required `disclosureRevision`. Core computes domain-separated fixed-order digests from trusted canonical data.
  Raw input, secret values, display labels, and sensitive classifier payloads are excluded.
- Keep exact-attempt `inputDigest` separate from remembered-decision identity. An input digest proves the sealed call;
  it is not sufficient authority for a durable grant.
- Unknown or unstable subject identity, descriptor revision, classifier revision, cell, disclosure revision, or
  decision-scope digest is once-only or fails closed. It can never silently widen into session or durable authority.
- Use explicit operator choices: allow once, allow for this connection, always allow, or deny this request. Do not
  encode durable denial as `approved:false + always`, and do not preserve the legacy CLI `n` shortcut as a writer.
- The descriptor's `approvalMemory` is a server-side ceiling. `once-only` rejects session/always even from a
  handcrafted client frame; `rememberable` permits them only when the canonical subject/classifier contract is stable.

### Durable authority and `approvalGeneration`

- Add one Core SQLite Approval singleton and canonical durable-allow table. SQLite stores only normalized identity,
  revisions, canonical digests, disclosure/provenance metadata, and timestamps. It never stores pending input,
  presentation detail, paths, commands, secrets, socket identity, or Host challenge payloads.
- `approvalGeneration` is one positive global Core lineage. A material durable/session create, change, or revoke
  advances it exactly once. Removing one or more session grants during a single connection teardown advances it once.
- Allow-once, current-request deny, timeout, unknown revoke, identical no-op, and late/duplicate response advance it
  zero times.
- Durable compare/write/generation changes occur in one SQLite transaction. Durable and in-memory session mutations
  pass through one serialized Core service with no asynchronous gap inside its mutation critical section.
- A Core process restart discards every pending request, session grant, and unconsumed authorization and activates a
  new in-memory Approval process epoch before accepting execution. Restart does not by itself mutate the durable
  `approvalGeneration`; pre-restart authorization is invalidated by the non-persisted epoch plus live
  connection/control provenance. Durable allows remain in SQLite.
- Registry/disclosure reconciliation advances once when it materially makes stored authority inert or removes it.
  A database revision newer than the running binary fails startup rather than silently widening behavior.
- Durable create/revoke paths use optimistic `expectedApprovalGeneration`. Stale writers receive a structured conflict
  and must refetch.

### Operator session ownership

- The authoritative operator session is the physical Core `Connection` object for one WebSocket, not `deviceId`, a
  browser generation, a reconnect token, or a process-global map.
- A pending request, its targeted notification, its response provenance, and every session grant belong to exactly
  one initiating/approving `Connection`.
- `approval.respond` accepts only the same live `Connection` that owns the pending request. A sibling Home, Chat, Pet,
  CLI, or second-window socket cannot answer even when it uses the same authenticated `deviceId`.
- Disconnect cleanup cancels only that connection's pending requests, deletes only its session grants, performs at
  most one generation advance for the teardown batch, and leaves every other connection untouched.
- Reconnect with the same `deviceId` creates a new session and cannot recover old session authority. Turn cancellation
  cancels the exact pending request; the legacy global `denyAll` behavior is forbidden in production.

### Decision scopes and disclosure

- Allow once authorizes only the current sealed attempt and is never persisted.
- Allow for session authorizes future matching calls only when initiated through the exact approving physical
  connection. It is unavailable to unattended work and disappears on disconnect or Core restart.
- Always allow creates one canonical SQLite decision and requires an explicit, current acknowledgement that the grant
  includes future background runs.
- Store the disclosure revision with the durable decision. A newer disclosure revision makes an older allow inert
  until the operator explicitly reconfirms it; no migration may silently upgrade consent.
- Deny rejects only the current pending request. Exact legacy `never` rows remain stricter compatibility constraints
  through Governance; canonical durable deny is not part of this MVP.

### Interactive lifecycle and one-dialog invariant

- Interactive Core-local and MCP actions enter one Core pending state before opening the raw execution closure.
- Host-owned classified actions use `request -> challenge -> one Core prompt -> resume/terminate`. Rust performs no
  native prompt and writes no new decision.
- Heartbeat and calls without an initiating operator connection fail closed without prompting. Scheduled work remains
  behind the later Run Receipt/pause contract; this child creates no surprise background dialog or ad hoc queue.
- `approval.closed` removes an expired, cancelled, disconnected, generation-invalidated, or otherwise retired prompt
  only from its owning client generation.
- Unknown, late, duplicate, wrong-session, invalidated, disallowed-scope, and stale-disclosure responses return bounded
  explicit statuses without leaking another connection's pending details.

### Host challenge/resume

- Keep the original `HostOperationControl` byte-for-byte immutable. Add a Core-minted nested
  `CapabilityAuthorization` to `CapabilityResume` and bump the Host-control protocol revision.
- Bind the authorization to one `authorizationId`, the current post-decision `approvalGeneration`, decision scope,
  immutable-control digest, trusted challenge/classification digest, decision-scope digest, issue time, and expiry.
- Allow-once keeps generation `G`. A material session/always answer advances to `G+1` and, in the same serialized
  transition, mints one `G+1` authorization only for the pending request whose answer caused the change. Other `G`
  pending/resume entries become invalid.
- Host validates request/challenge/control/digests/generation/deadline/connection/catalog provenance and consumes the
  authorization before starting execution. Tamper, replay, reconnect, cancellation, and duplicate resume execute no
  additional effect.
- A mixed old/new Core and Host rejects challenge/resume as unsupported. It never falls back to a native prompt or a
  hard-coded Approval generation.

### Privacy and operator surfaces

- Exact pending input may exist only in the active Core pending record, the active Host request/challenge record, and
  the initiating client generation's ephemeral dialog state. Clear it on every terminal or invalidating transition.
- The wire dialog uses an adapter/classifier-produced, versioned, bounded, redacted presentation DTO. Clients never
  render arbitrary `JSON.stringify(input)` and never derive allowed choices from presentation text.
- Pending input and secrets are prohibited from SQLite/JSON stores, Core/Rust logs, Rust audit JSONL, timeline/tool
  history, Run history, Memory, caches/localStorage, navigation, Tauri events, generic errors, and crash diagnostics.
- Desktop installs the prompt handler on the exact window-owned `WsClient` generation. Durable decision management may
  live in Home but reads fresh Core state and does not own or broadcast pending dialogs.
- CLI uses the same targeted socket, safe presentation, explicit choices, current disclosure confirmation, and
  list/revoke semantics.

### Legacy compatibility

- Keep legacy Shell/Core Approval files and modules as read-only compatibility/test inputs until migration evidence is
  complete. Do not compose the legacy broker/gate/decision writer in production.
- Exact legacy denies continue to narrow. Legacy allows, process-global sessions, relaxed levels, and ambiguous keys
  never authorize the canonical system.
- An unambiguous legacy allow may appear only as an inert reconfirmation candidate. Reconfirmation creates a new
  canonical durable allow using current identity, revisions, generation, and background disclosure.
- Ambiguous or corrupt legacy state fails closed and surfaces a repairable diagnostic; no adapter guesses identity.

## Implementation Batches

1. **Batch A — canonical schemas and state**: Shared operator schemas/exports plus migration `015`, Approval
   repository/service, digest and reconciliation rules, tests, module headers, and directory indexes. Production
   `ask` remains fail-closed; do not touch prompt, Host challenge, Desktop, CLI, or `main.ts` execution wiring.
2. **Batch B — Core-local/MCP interactive lifecycle**: connection-owned pending/session state, same-connection respond,
   targeted request/closed notifications, governed closure gating, timeout/cancel/invalidation, list/revoke methods.
3. **Batch C — Host challenge/resume**: protocol bump, TypeScript/Rust fixtures, nested authorization, single-use Host
   consumption, no native prompt, and audit privacy.
4. **Batch D — operator product surfaces**: Desktop per-socket modal, Home durable-decision management, CLI parity,
   background disclosure UX, reconnect retirement, and no-cache proof.
5. **Batch E — legacy reconfirmation and end-to-end privacy**: inert candidates, deny preservation, source sweeps, and
   real Core/operator/MCP/Host process evidence.

Every batch must remain independently fail-closed and testable. No intermediate batch may restore a Host-local prompt
or release the parent initiative with only part of the Approval lifecycle active.

## Acceptance Criteria

- [ ] Every effective `ask` uses one canonical Core Approval authority; MCP, Skill-mediated, Core-local, and Host
      actions do not create separate policy or decision systems.
- [ ] One action produces at most one dialog, and only the initiating physical operator connection can view/respond.
- [ ] Two simultaneous sockets sharing one `deviceId` cannot consume each other's pending request or session grant;
      disconnect/reconnect removes only the owning connection's state.
- [ ] Material durable/session mutations and teardown batches advance `approvalGeneration` exactly once; once, deny,
      timeout, unknown revoke, and identical no-op advance zero times.
- [ ] Always allow survives SQLite close/reopen, requires the current future-background disclosure, and becomes inert
      rather than silently upgrading when binding/revision/disclosure changes.
- [ ] Host challenge/resume preserves immutable control, validates the nested authorization, and rejects every stale,
      tampered, duplicated, cancelled, reconnected, or replayed resume before a second effect can start.
- [ ] Heartbeat/no-operator execution never prompts, and session grants never authorize unattended work.
- [ ] Legacy exact denies remain effective; legacy allows and sessions execute nothing until explicit canonical
      reconfirmation.
- [ ] Sentinel pending input/secret values are absent from persistence, logs, audit, timeline, run history, Memory,
      cache/localStorage, Tauri events, errors, and crash diagnostics.
- [ ] Shared/Core/Desktop/CLI/Rust focused tests, migration/restart tests, workspace gates, protocol fixtures, and real
      process E2E pass; packaged WebView behavior is reported as unverified until the owner actually observes it.

## Definition of Done

- All five batches are implemented through high-effort `trellis-implement` dispatches and proportionate checks; the
  substantial authority/protocol convergence receives xhigh `trellis-check` review.
- Every touched production file has the required English `INPUT`/`OUTPUT`/`POS` header, and every touched production
  directory has an accurate English `index.md` entry.
- Current-runtime contracts are reflected in executable specs, `CONTEXT.md`, relevant ADRs, task docs, HANDOFF, and the
  developer journal after verified behavior lands.
- `main` is checked before every implementation batch. If it advances, merge `main` into T4 without rebase and rerun
  focused tests for every semantically conflicted integration seam.
- Host-control and Governance children remain in `review` until the approved convergence/closeout point. No push,
  finish/archive, reset, rebase, force operation, or manual acceptance claim occurs without owner authorization.

## Out of Scope

- Host credential encryption/catalog implementation and extension CRUD.
- MCP desired-state reload generations, leases/draining, and runtime lifecycle.
- Skill package install/update/enable/remove and progressive discovery implementation.
- Autonomous Run, Run Receipt, Scheduled Task, Heartbeat, or Experience Review behavior.
- Durable canonical deny, surprise background prompting, cross-window prompt broadcast, or device-id session sharing.
- Replacing standard MCP, `@ai-sdk/mcp`, or portable `SKILL.md` with a Taki-only extension format.

## Research References

- [`research/live-approval-lifecycle-map.md`](research/live-approval-lifecycle-map.md) — verified live/dormant Approval
  seams, physical-connection ownership, generation/privacy rules, Host transition, batches, files, and evidence matrix.
- [`../08-12-governance-authority/research/live-governance-migration-map.md`](../08-12-governance-authority/research/live-governance-migration-map.md)
  — canonical identity/evaluator/legacy-deny contracts and the deliberate Slice 3/4 boundary.
- [`../08-10-skills-mcp-productization/research/current-gap-and-dependency-map.md`](../08-10-skills-mcp-productization/research/current-gap-and-dependency-map.md)
  — parent live gaps, shared integration anchors, ordering, and merge risks.
- [`../08-10-skills-mcp-productization/research/standards-and-reference-prior-art.md`](../08-10-skills-mcp-productization/research/standards-and-reference-prior-art.md)
  — standard MCP/open Skill preservation and established Approval/least-authority patterns.
