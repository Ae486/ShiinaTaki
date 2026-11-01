# Research: Independent maintainer review

- Query: Challenge the cost diagnosis and proposed planning against the original owner request, measured evidence, and current authority contracts.
- Scope: internal review of local evidence and source; no provider calls or production changes.
- Date: 2026-11-01

## Findings

### Review verdict

The measured diagnosis is useful and supports proceeding to owner review of planning. It does not establish an invoice amount, a guaranteed savings percentage, historical per-request causes, or implementation readiness for a new persistence contract. No numerical blocker was found in the independently checked core aggregates. The missing-source guard is an integrity protection with an availability consequence; bypassing it would be an unsafe repair.

Two planning clarifications were sent to the parent: distinguish optional diagnostics from authoritative usage settlement, and explicitly prevent an early origin receipt from satisfying complete-source ingestion/retirement proof. Both were corrected and read back in the planning artifacts: `design.md` Findings 1 and 5 and `implement.md` Stages 1 and 2. No unresolved defect blocks delivery of this diagnosis and planning. A future independent review of the concrete persistence/recovery design remains necessary; this review cannot approve a schema that has not been designed.

### Essential correction 1: Optional observation cannot swallow authoritative settlement failure

- Original Stage 2 wording broadly required observer failure not to change provider results. Applied to the existing canonical usage observer, that would conflict with the current contract.
- `.trellis/spec/backend/observability-projection.md:68` separates optional event append failure from authoritative Effect/usage settlement failure. The latter must be rethrown at the owning boundary before successful turn completion.
- `packages/core/src/agents/model-observability.ts:121` performs authoritative settlement; its catch saves the failure, and `:62` exposes it through `assertHealthy()`. `packages/core/src/agents/agent-attempt.ts:213` invokes that check.
- Corrected plan: isolate added optional diagnostics; preserve fail-closed authoritative settlement, explicit failure/recovery, original provider outcome, and no automatic reissue of an already dispatched paid action.
- Disposition: corrected by the parent and read back in the planning documents. No production change was made.

### Essential design boundary 2: Input origin is not completed transcript proof

The proposed split is a reasonable direction, but its acceptance rule must be explicit:

1. Atomically capturing exact input origin must not, by itself, allow ingestion or compaction to consider an unsettled primary transcript complete.
2. Retraction must not leave eligible input behind; retained partial cancellation must keep its actual committed evidence without inventing successful Run completion.
3. Exact settled rows and their complete commit boundary remain immutable. Do not insert an early `canonical_memory_primary_commits` witness and later silently extend `committed_through_seq`.
4. Recovery must distinguish provable retained source, still-unsettled work, and irrecoverable/ambiguous history. A reconciliation label or timestamp-nearby Run is insufficient evidence for a witness.

These constraints follow from `.trellis/spec/backend/canonical-local-memory-runtime.md:83` (exact complete commit boundary), `:96` (unresolved source/receipt prevents retirement), and `packages/core/src/db/canonical-ingestion-source-repo.ts:95` (repeated commits must have the same row identity, digest, Run and complete boundary). The current user-gap query checks user rows, so changing the meaning of a user witness without an explicit settlement rule could accidentally remove the protection for a partly persisted turn.

Current `chat-agent.ts:230` appends the user before execution; `:264` finishes ordinary exceptional/iterator endings; `:292` commits recorded rows before `:303` writes witnesses. This exposes multiple interruption/write boundaries, not only process death during a model request. In particular, distinguish death after user append, death after transcript commit but before witness, and witness-write failure; `canonical-local-subsystem.ts:54` currently catches witness failure. The future fault matrix should cover those concrete boundaries and clean retraction, using an isolated DB.

This is a required invariant for the future design, not a request to broaden this planning task into a general recovery framework. Reuse existing Run, Timeline, authority, journal and CAS ownership. Do not weaken existing gates or assume historical holes can be repaired from today's code.

Disposition: the parent added the explicit origin-versus-settlement and immutable-boundary constraints, and they were read back. Concrete transaction/schema/recovery design and fault verification remain future work under Stage 0/1, as intended.

### Independent numerical and guard checks

Read the actual SQLite DB in one read transaction with URI `mode=ro`, `query_only=ON`, and `busy_timeout=10000`. Only counters, sequence metadata and bounded part-type labels were printed; no private conversation bodies or credentials were exported.

| Check | Independently observed result |
| --- | --- |
| Usage rows / distinct Effect IDs | 288 / 288 |
| Known input rows / input sum / output sum | 282 / 16,657,760 / 82,441 |
| Input/cache-paired rows | 263 |
| Paired input / cache-read | 15,268,640 / 10,446,464 |
| Token-weighted cache fraction | 68.4177766% |
| First primary paired requests | 152; 9,057,135 input; 4,421,632 cache; 48.8193231% |
| Primary continuation paired requests | 104; 6,157,736 input; 5,987,840 cache; 97.2409340% |
| Active-epoch post-baseline user witness gaps | exactly seq 3816, 3838, 3847 |
| Eligibility baseline / cursor / unassigned witnessed rows | 3703 / 3812 / 417 |
| Failed compaction operations / attempts | 22 / 26; `MEMORY_FLUSH_INCOMPLETE` |
| Every failed retirement range | starts 3716; endpoints 3882 through 4186, all including the gaps |
| Model Effects | 288 terminal, 3 intent-committed |

For usage rows with a corresponding `model.request.started` Effect identity, classifying first versus continuation by usage order agreed with event order (zero disagreements). Twenty-two legacy usage rows lack such start events, so this cross-check does not independently certify their original dispatch order. That limitation does not invalidate the reported definition as first recorded request per Run.

Two other unwitnessed post-baseline rows are assistant rows at seq 3725 and 3774. They are not the identified user-gap blockers, and their role alone does not establish primary origin. No additional defect or repair is inferred from them.

The source chain was independently read:

- `canonical-ingestion-source-repo.ts:134`, `:187`: reject unknown post-baseline user source before returning pending entries.
- `canonical-local-ingestion.ts:97`: pending-entry read occurs before `ingestSpan`; `:131` calls the gate only afterward. A current gap blocks this path before paid extraction.
- `compaction-coordinator.ts:156`: failed flush returns before summary dispatch at `:166`.
- `compaction-coordinator.ts:181`, `:198`, `:205`: summary quality, source digest and fenced commit remain later guards.
- `run-recovery-repo.ts:31`: recovery classification updates Run/event state; it does not manufacture missing ingestion witnesses.

Therefore the observed failed operations are evidence of blocked local progress, not evidence of 26 paid summary requests. Their downstream token cost is plausible and source-supported, but a monetary counterfactual requires functioning compaction and actual request accounting.

### Evidence consistency corrections

The initial `usage-coverage.md` still treated `.usage` versus `.totalUsage` as unresolved and left canonical ingestion/private-summary paths unclassified. This conflicted with the parent's already completed SDK/source verification. The parent subsequently reconciled the artifact: SDK 7.0.148 `generateText().usage` aliases aggregate usage; canonical-local gate/extract bypass the Run observer; private-task summaries have direct Effect settlement; the current on-demand screenshot caller does not forward execution identities. Those new caller checks are parent evidence, not independently rerun in this review.

The final report should retain that distinction. A conditional helper that accepts execution identities is not proof its production caller supplies them. A durable memory receipt is not a provider request ledger. No whole-account conclusion follows from a mostly-primary Run ledger.

### Strengths and already addressed tradeoffs

- The plan answers the original cache/cost question using the real DB rather than arbitrary prompt shortening. It separates first requests and continuations, missing fields, reasoning overlap, cached-but-still-billable requests, and tool-result character proxies.
- Source-proof failures, bounded avatar corrections, large replay bodies, prefix representation changes, and accounting gaps have distinct owners. Existing schema guidance, sorted tools and late minute-time placement are acknowledged instead of proposed again.
- Historical deployment, current dirty source, November provider documentation and separate October 30 test traffic are correctly separated. No claim of exhaustive provider-account billing is justified or made.
- The replay probe demonstrates a current-code mechanism on real rows, with fixed calibration stated; it does not pretend to identify eight historical provider misses. No raw prompt telemetry or restoration of arbitrary tool arguments is proposed.
- pi's standalone summary and DSH's replay-shaped summary are presented as alternatives with cost/quality tradeoffs. No new provider-private cache control, second runtime authority or universal cache quota is necessary.
- Historical repair, paid validation and implementation retain separate authorization. Planning checkboxes do not claim production optimization or owner acceptance.

### Nonblocking refinements

- Separate one-time catch-up cost from steady-state savings. Repairing 417 pending witnesses can resume real gate/extraction and summarization work; total cost may initially rise even while correctness and future replay improve. Meter that recovery work rather than promising an immediate bill reduction.
- Preserve the distinction between the first *recorded* model request and a proved first physical dispatch when older start/retry evidence is absent. A model Effect or Utility task is not automatically every HTTP attempt.
- For future replay changes, measure both saved replay input and additional detail retrieval, summary/gate work, output and failure costs. The current plan already requires successful-task quality; a numerical benefit should be reported only after that matched comparison.

## Files Found

- `prd.md`, `design.md`, `implement.md`: original goal, diagnosis, alternatives and future authorization/verification sequence.
- `research/runtime-data-map.md`, `analyze_runtime.py`: cohort definitions and reproducible extraction logic, inspected without executing its output writer.
- `research/failure-root-causes.md`: observed user provenance gaps, tool-error result evidence and bounded correction cohorts.
- `research/usage-coverage.md`: caller-level coverage and normalization limits, reconciled during review.
- `research/reference-cache-practices.md`: local pi/DSH and official provider/SDK mechanisms with version caveats.
- `packages/core/src/db/canonical-ingestion-source-repo.ts`: exact source witnesses, immutable boundaries and cursor guards.
- `packages/core/src/memory/canonical-ingestion-source.ts`, `canonical-local-ingestion.ts`, `canonical-local-subsystem.ts`: source sanitization, gate/extraction ordering, witness-write failure behavior.
- `packages/core/src/agents/chat-agent.ts`, `compaction-coordinator.ts`: persistence/retirement lifecycle boundaries.
- `packages/core/src/agents/model-observability.ts`, `agent-attempt.ts`: authoritative usage settlement and stream-boundary health check.
- `packages/core/src/db/run-recovery-repo.ts`: recovery classification without ingestion-source repair.

## Related Specs

- `.trellis/workflow.md`: planning artifacts, independent review, no activation inferred from research.
- `.trellis/spec/backend/canonical-local-memory-runtime.md`: exact-source and retirement guard contracts.
- `.trellis/spec/backend/agent-runtime.md`: cancellation/retraction, primary-source witnessing, provider-neutral semantic prefixes.
- `.trellis/spec/backend/observability-projection.md`: real producers, missing versus zero, authoritative settlement and optional observers.
- `.trellis/spec/backend/database-guidelines.md`: canonical database/transaction ownership and immutable evidence.

## External References and Versions

This independent review did not contact a provider or re-fetch external documentation. External claims are scoped to the source-linked `reference-cache-practices.md`: local pi 0.84.2, local DSH 0.1.1-rc.2, installed AI SDK 7.0.148 and OpenAI-compatible adapter 3.0.75. These are artifact version observations, not proof of the October historical deployment or applicable invoice tariff.

## Reproducible Focused Checks

Connection setup used for all SQL checks:

```python
import sqlite3
c = sqlite3.connect('file:///C:/Users/55473/.takiagent/taki.db?mode=ro', uri=True)
c.execute('PRAGMA query_only=ON')
c.execute('PRAGMA busy_timeout=10000')
c.execute('BEGIN')
```

```sql
SELECT COUNT(*), COUNT(DISTINCT effect_id), COUNT(input_tokens),
       SUM(input_tokens), SUM(output_tokens) FROM run_usage;
SELECT COUNT(*), SUM(input_tokens), SUM(cache_read_tokens),
       1.0*SUM(cache_read_tokens)/SUM(input_tokens)
FROM run_usage WHERE input_tokens>0 AND cache_read_tokens IS NOT NULL;

SELECT t.seq, t.created_at
FROM canonical_memory_ingestion_cursors cur
JOIN canonical_memory_authority_state a ON a.active_epoch_id=cur.authority_epoch_id
JOIN timeline_messages t ON t.character_id=cur.character_id
LEFT JOIN canonical_memory_primary_commits p ON p.timeline_seq=t.seq
WHERE t.seq>=cur.eligibility_start_seq AND t.role='user'
  AND (p.timeline_seq IS NULL OR p.authority_epoch_id<>cur.authority_epoch_id)
ORDER BY t.seq;

SELECT state,failure_code,COUNT(*),SUM(attempt_no),
       MIN(selected_from_seq),MAX(selected_from_seq),
       MIN(selected_through_seq),MAX(selected_through_seq)
FROM conversation_compaction_operations GROUP BY state,failure_code;
```

## Caveats / Not Found

- The legacy task pointer was read and names a different task; the parent verified the session-scoped pointer and explicitly assigned this research output. No task pointer was changed.
- Planning is not implementation. This review will not authorize historical data repair or paid validation.
- No source/test/config/database mutation, process control, Git command, paid model call or new dependency was performed. Only this assigned research file was written.
- Full suites were not run: the deliverable is a planning review and read-only SQL/source verification, not a production regression claim.
- Exact historical prompts, historical raw provider detail presence, the initiating interruption cause, applicable account tariff and whole-account totals remain unavailable. There is no justified currency saving or causal percentage to report.
- Current-state source was verified directly. Memory was used only for prior measurement and workflow cautions (`MEMORY.md:562-568`), not as current runtime evidence.
