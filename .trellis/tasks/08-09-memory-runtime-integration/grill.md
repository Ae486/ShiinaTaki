# B6 Policy Readiness - Confirmed Owner Decision

## Status

On 2026-09-11 the owner accepted the conclusion below and explicitly authorized design and implementation through
Trellis. Resume this existing B6 task; no new task is needed. The previous blanket recommendation to wait for a model
assessment was withdrawn after reviewing the already accepted Unclassified Memory definition in CONTEXT.md.

## Accepted behavior

- A confirmed native memory with valid Taki policy may participate in recall immediately under that policy.
- A confirmed, valid memory with verified Bank ownership but an unresolved Taki layer may participate in recall under
  an explicit safe neutral policy. Detailed model assessment runs in the background and is not a foreground prerequisite.
- Unknown ownership, invalid lifecycle, an unverified native identity/version, or an invalid binding is not equivalent
  to an unclassified memory. Resolve the basic integrity condition before exposing the affected content.
- Neutral policy is an actual versioned Taki policy with declared defaults and an explicit assessment state; it is not
  a fabricated model assessment, fabricated provenance, or permission to bypass an existing hidden/invalidated rule.
- Native confirmation, policy assessment and replayable Pending Memory remain separate facts. A confirmed observation
  awaiting assessment must not be relabeled as an unconfirmed write.
- The same policy contract serves Local and Hindsight. Local remains independently useful without reproducing
  Hindsight extraction, graph retrieval, observation evolution or mental-model maintenance algorithms.
- Bidirectional and repeated provider switching must preserve or reconstruct the agreed consumable memory state.
  Reuse verified baselines, identity mappings and subsequent changes. There is no authorization for unspecified,
  irrecoverable logical-data loss merely because the receiving provider has fewer capabilities.
- Memory maintenance concerns durable memories, observations, policy and Memory Blocks. Conversation Compaction is
  a separate context-management concern and cannot stand in for memory maintenance acceptance.

## Existing rulings reused

- [CONTEXT.md](../../../CONTEXT.md), Unclassified Memory: verified Bank ownership plus safe neutral searchability
  before classification maintenance. This already determines the basic admission direction.
- [ADR 0009](../../../docs/adr/0009-single-memory-authority-with-local-replica.md): per-fact native layer labels,
  provider-specific semantic maintenance, single authority, incremental replica synchronization and repeated switches.
- [B1 design](../archive/2026-08/08-09-memory-provider-foundation/design.md), section 4.7: registry policy and separate
  source-backed/provider-derived provenance; neutral defaults must not claim an unavailable original source.
- [G2-08 and G1 review](../09-07-hindsight-recovery-evidence/grill.md): accepted Pending content is usable, and factual
  recovery confirmation does not wait for later native derived maintenance.
- [T5 kickoff rulings](../archive/2026-08/07-28-memory-context/notes.md): model-led maintenance with deterministic
  process constraints, scheduled and on-touch organization, a Utility Slot and configurable development values.

## Implementation and authorization boundary

D77 application-state preservation/binding, truthful native hydration, neutral policy production, the narrow Taki
curator and complete B6 provider/runtime/recovery wiring may now proceed. Preserve frozen G1/D78 wire identities,
receipts, certificates and prior verified Local work. Engineering gaps are not new product questions.

B7 remains a separate task and requires its own grill before implementation, including planned Local switch-back,
re-entry and Emergency Local Takeover. This B6 authorization does not activate a live authority, access the original
user database, issue real model requests, commit/push, archive tasks or modify another worktree.

Reopen a grill only for a concrete incompatibility or behavioral tradeoff not settled by these sources. Present the
actual affected data, existing ruling, alternatives and recommendation; do not repeat an abstract loss-tolerance or
blanket pre-assessment question.
