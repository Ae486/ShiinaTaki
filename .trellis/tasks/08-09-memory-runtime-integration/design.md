# Runtime Recall, Tools, and Memory Policy - Technical Design

## Boundary

B6 consumes the stable B5 provider, replica reader, Pending Memory, and recovery contracts. It wires those contracts into
RunSnapshot admission, foreground recall, canonical memory tools, and provider-specific policy/maintenance. B6 does not
implement B5 sync storage or B4 activation and does not make Local/Hindsight authority changes.

## RunSnapshot and capability consistency

At admission, capture provider ID, provider lineage, authority epoch, contract version, and the complete stable capability
snapshot once. The provider coordinator, memory tools, and `run-snapshot-capture.ts` all consume that same immutable
snapshot. A capability or authority change during a call yields a structured authority/outcome-unknown result according
to the Shared contract; the run never silently re-resolves a different provider.

`RunSnapshot` freezes memory identity, caps, and tools alongside extension, governance, approval, model, and budget
references. Runtime wiring must preserve the split already established by snapshot capture: exact executable context is
process-local, while persisted snapshot data is bounded and redaction-safe.

## Foreground recall and ingestion

Automatic foreground recall runs after the outgoing user content is known and joins the ephemeral `<turn-context>` suffix
before request-preparation measurement. It uses the active Global and Character banks under one shared budget, tolerates a
partial bank failure, and never enters stable instructions, timeline, summary, compaction gate, Write Gate input, or
Retain payload. Explicit recall/reflect tools may use their normal higher budgets.

The 2026-09-13 owner continuation removes the initial 1500 ms automatic-recall business deadline. Normal automatic
recall waits for completion or cancellation; explicit finite caller deadlines remain supported. This does not remove
provider transport failure handling. Hindsight Reflect receives one five-minute operation allowance spanning its
synchronization, admission, policy-context upload and guarded native request; ordinary connection operations keep their
existing budgets. The native Reflect operation also retains its five-minute boundary.

Automatic ingestion is primary-only conversational input. Delivered autonomous speech has separate provenance and must not
be treated as a user conversational source merely because it was displayed. Silent autonomous controls (expression,
motion, scheduling decisions) are excluded. A committed span goes through one Write Gate and then the provider retain
contract; recalled text, hidden prompts, secrets, and unsafe tool payloads remain scrubbed.

## Provider-specific policy and durability

Local mode keeps complete policy/maintenance behavior. Hindsight mode delegates extraction, consolidation, and semantic
maintenance to Hindsight; the narrow Taki curator handles layer, visibility, retention, and Memory Block projection only.
Every durable Hindsight correction calls the authority provider and lets B5 update the replica; the replica is never a
mutation target.

`MemoryFlushPort` remains the pre-retirement durability seam. Before retiring legacy maintenance after Hindsight binding,
flush accepted Local work through the port and preserve the result; do not replace it with generic blind Effect replay.
Pending replay uses B5's ordered recovery coordinator and expected-revision CAS.

## Verification

Focused tests must prove snapshot identity/capability consistency, recall ordering and exclusion, partial/timeout
degradation, primary-only ingestion provenance, canonical/legacy tool advertisement, policy-curator scope, and flush
durability. Offline tests do not prove live Hindsight health, B4 current-Local coverage, or activation; those remain
explicit owner-approved gates.

## Canonical Local maintenance implementation (2026-09-10)

The [source review](research/local-runtime-reuse-2026-09-10.md) confirms that canonical records, sparse recall, foreground
tools, and structured blocks already exist. Port the useful T5 policy and orchestration rather than reviving its Markdown
store. The Local slice does not reduce the remaining snapshot, automatic-recall, Hindsight-policy, or flush scope above.

- Keep a narrow canonical maintenance store/provider boundary. Reads carry epoch, Bank, memory identity and revision;
  policy changes, reinforcement, lifecycle changes and permitted machine retention are authority-checked, revision-fenced
  and retry-safe. Unit, policy, sparse index and historical receipt changes commit together. Preserve unrelated logical
  fields and source/fact relationships, including supported state imported from Hindsight.
- Automatic ingestion takes sanitized committed primary-conversation spans through exactly one Write Gate. Keep the
  approved original source distinct from extracted Local facts. Reuse first-person/user-wording extraction and automatic
  importance limits. Near-duplicate writes reinforce with lexical matching, not a second classification model call; retain
  the new source evidence and make retries idempotent. Hindsight receives the approved source and owns native extraction.
- Reuse the tidy report and bounded Utility Slot loop, adapting its operations to canonical identities/revisions. Tidy may
  deliberately promote policy; automatic extraction may not silently make entries always visible. Same-Bank layer repair
  preserves identity. Cross-Bank repair follows ADR 0009: copy the source/fact with provenance to the correct Bank and
  reversibly invalidate the original; never silently change ownership under an existing identity.
- Reuse registry retention: permanent layers remain permanent, expired intentions and low-importance episodes are
  recoverably invalidated, and only the machine rolling-window layer may be hard-deleted. Count effects only after durable
  success. A revision race or authority change is a refusal, not a successful sweep.
- Use the structured Block repository and its writer/CAS rules. The user card stays user-owned. Projection follows registry
  order/budgets, keeps non-truncatable relationship content, includes eligible high-importance profile memories, and fences
  observed content. Blocks remain outside searchable memory/FTS.
- Install the Local chain in existing per-Character detached background scheduling. All model work shares the process
  Utility Slot; never wrap a chain that calls `slot.run` in another call to that same slot. Compaction remains independent.
  Runtime selection and retirement install the selected provider's maintenance and durability ports, rather than clearing
  maintenance on canonical binding. Hindsight selection must stay fail-closed until its real provider is wired.

Use fresh temporary SQLite databases and deterministic model substitutes for this slice. Do not read or alter the original
user database, historical migration backup, another worktree, or existing private D78 acceptance targets. Existing live D78
evidence remains its own completed gate and does not establish B6 runtime acceptance.

## Local runtime contract and Hindsight continuation (2026-09-11)

The executable Local contract is now in [Canonical Local Memory Runtime](../../spec/backend/canonical-local-memory-runtime.md).
It covers exact primary-source witnesses, late-source assignment independent of retirement cursors, T5's 20-message
automatic cadence, fixed gate/extraction/Bank receipts, canonical maintenance, immutable Run capture, and post-marker
Legacy retirement. Verification records automated coverage separately from live/owner acceptance.

The [D77 source review](research/d77-hindsight-runtime-gap-2026-09-11.md) identifies the missing provider application-state
and exact native-version projection without reopening settled preservation or native semantic ownership decisions.
The [policy-readiness ruling](grill.md) was accepted on 2026-09-11: basic verified/neutral policy permits recall while
detailed assessment runs asynchronously. Native recall/reflect client methods do not by themselves constitute a
Hindsight MemoryProvider or authorize enabling the guarded runtime branch. Complete the D77 state/projection and
B6 provider/recovery composition before replacing that guard; production activation remains a separate operation.

The current detailed engineering design is [D77/B6 Implementation Contract](research/d77-implementation-contract-2026-09-11.md).
It adopts the bounded native and Taki source plans, freezes neutral policy and independent application-state semantics,
and defines the native read-admission, restoration, runtime and validation boundaries for this authorized continuation.

## Assembled Runtime and Verified Behavior

The D77 application-state protocol and B6 selected runtime are now implemented. The production contract is
[Hindsight Application State and Runtime](../../spec/backend/hindsight-application-runtime.md), and
[the validation record](research/d77-runtime-validation-2026-09-11.md) separates completed automated proof from remaining
native platform baselines, real-model/manual acceptance and live deployment.

The runtime uses independent application bodies/receipts with the native checkpoint pair. Original sources are
preserved before tracked native dispatch; whole-operation writes keep native completion separate from policy
application. Healthy recall hydrates exact Bank and Memory versions; degraded recall stays under Hindsight Authority.
Known required pins refuse incomplete admission while unavailable rebinding is pending. Classification runs later in
the shared Utility Slot and never gates already valid neutral policy.

Foreground lifetime includes complete tool/automatic-recall/capture calls, preserving frozen Effect sidecars. Queued
Bank work observes its own cancellation/deadline, and shutdown drains all owned consumers before SQLite closes.
Legacy/Local constructors remain independent of Hindsight configuration and network work. This installs the real
Hindsight runtime branch; it does not perform an Authority transition or advance B7.
