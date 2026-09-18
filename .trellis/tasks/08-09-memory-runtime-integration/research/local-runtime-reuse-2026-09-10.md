# Canonical Local Runtime Reuse Review

Read-only review of `H:/TakiAgent` on main; verified before the reviewed B4/D78 commit `3c63a80`. The review used one focused
`jbcontext` query and direct reads. The configured context-explorer model was unavailable (HTTP 404); the ordinary explorer
completed the bounded review instead. No database, service or live model was used.

| Surface | Reuse and verified gap |
| --- | --- |
| `memory/canonical-local-runtime.ts:21-37` | Real Local provider/tools exist; retention, tidy and background tools are empty placeholders. |
| `memory/runtime-composition.ts:78-103` | Existing background chain installs only legacy maintenance and clears it on canonical binding. |
| `memory/auto-memory.ts:90-120` | Reuse detached per-Character serial maintenance, then independent Compaction; the Utility Slot is process-shared. |
| `memory/episodic-writer.ts:58`, `write-convention.ts:14`, `auto-layer-policy.ts:57` | Reuse extraction, first-person/source-grounded wording and automatic importance ceiling. Old episodic/flush gates cannot both run in the new one-gate flow. |
| `memory/memory-engine.ts:216-237` | Existing lexical duplicate detection reinforces instead of adding an identical fact; avoid extra LLM diffing. |
| `memory/local-memory-provider.ts:75-84`, `db/canonical-memory-repo.ts:21-69` | Provider currently turns source text into one fact; repository supports one source to multiple units. Preserve raw approved source separately. |
| `memory/render-transcript.ts:9`, `auto-memory.ts:168` | Role/text rendering and an origin log are insufficient as primary-only provenance filtering. |
| `shared/src/memory-provider-operation-schema.ts:89-101`, `db/canonical-memory-repo.ts:33,199` | Public edit lacks importance/disclosure/reinforcement and retention deletion; add a real narrow maintenance write boundary. |
| `memory/tidy-report.ts:43`, `tidy-pass.ts:122`, `tidy-tools.ts:37` | Reuse five report classes, zero-call clean exit, success watermark and maintenance verbs; replace file identities with canonical revisions. |
| `memory/retention-sweeper.ts:75-98`, `scheduler/sweep-runner.ts:24` | Registry-based policy and updated-time anchor already exist; successful durable effects must precede counts. |
| `db/structured-memory-block-repo.ts:16-27` | Reuse scoped writer/CAS whole-block replacement and registry budgets; user card is not background writable, blocks are outside FTS. |
| `memory/canonical-local-runtime.ts:51`, `pinned-block.ts:18-40`, `assembler.ts:69-139` | Current pinned-only LIMIT 32 loses high-importance profile behavior and can truncate relationship content; reuse budgets and observed fences. |

Paths in the table are relative to `packages/core/src/`, except `shared/`, which is under `packages/`.

## Binding decisions

- B6 PRD explicitly requires complete disconnected Local maintenance with persisted results. Empty tools/results cannot pass.
- [T5 decisions](../../../workspace/pleia/t5-decisions.md), R7-R11: user-card precedence, recoverable episode/intention
  retention, rolling machine hard-delete, lexical reinforcement, source-grounded first-person wording and one Utility Slot.
  The archived final T5 PRD refines early decisions. T5's old file storage and tool-only recall are superseded.
- [ADR 0009](../../../../docs/adr/0009-single-memory-authority-with-local-replica.md): cross-Bank correction copies supported
  source/fact state with provenance, then reversibly invalidates the original; Hindsight owns its semantic maintenance.
- [Confirmed interoperability direction](../../09-07-hindsight-recovery-evidence/grill.md): preserve supported logical state,
  prefer proven reuse, and do not re-ask settled decisions. Missing implementation is engineering work.

No new unresolved product decision was found in this Local review. A concrete new loss, supported-input restriction,
ownership change or semantic timing tradeoff must be raised before implementing that dependent behavior.
