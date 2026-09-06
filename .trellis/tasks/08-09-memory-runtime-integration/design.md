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
