# Research: Compaction and avatar-tool failure causes

- Query: Explain measured compaction and avatar tool failures, their cost mechanisms, and safe optimization boundaries.
- Scope: internal; read-only production SQLite evidence plus current worktree source.
- Date: 2026-11-01

Planning update: the owner subsequently accepted independent context compaction and atomic local source capture. Historical measurements and failure chains below remain evidence; the initial recommendation to preserve synchronous flush-before-compaction is superseded by `../design.md` and `simplification-scope-review.md`. Do not treat the original repair recommendation as the current implementation requirement.

## Findings

Owner-authorized task: `.trellis/tasks/11-01-cache-token-cost-diagnosis`; the root session resolves this task, while this delegated session has no task pointer and the legacy global pointer is stale. No pointer was modified. Source data is `C:/Users/55473/.takiagent/taki.db`, opened exclusively with SQLite URI `mode=ro`, `query_only=ON`, and `busy_timeout=10000`. Queries below expose metadata, counts, and bounded tool-error classes rather than private dialogue.

### 1. Memory provenance gaps block ingestion, which blocks compaction

The strongest local explanation is an unresolved ingestion provenance gap after interrupted/unsettled primary runs, not a summary-length or summary-model problem.

| Measured fact | Value |
| --- | --- |
| Active memory authority selection | `canonical-local` |
| Current summary | revision 5, through seq 3715, 6,845 characters, updated 2026-10-24T12:16:58.398Z |
| Ingestion eligibility baseline | seq 3703 |
| Ingestion coverage cursor | seq 3812, last updated 2026-10-25T08:13:20.625Z |
| Ingestion span journal | 5 spans, all `complete`; no unfinished extraction/receipt span observed |
| Primary witnesses | 525 total; 417 unassigned to an ingestion span, seq 3813–4232 |
| Post-baseline user rows missing any primary witness | exactly seq 3816, 3838, 3847; all on October 25 |
| Compaction operations with `MEMORY_FLUSH_INCOMPLETE` | 22; 26 failed attempt events; October 25–28 |
| Failed compaction retirement endpoints | seq 3882–4186; every endpoint is beyond all three gaps |
| Failed operation recorded pressure | 52,927–77,171 estimated input units; not billed-token measurements |
| Stored failed-operation start-to-terminal interval | approximately 4–11 ms |
| History after summary boundary | 517 rows: 129 user, 223 assistant, 165 tool |

The durable chain in current source is:

1. `packages/core/src/memory/canonical-local-ingestion.ts:74` reads the existing baseline, computes the requested retirement target, calls `drainSources`, then advances coverage. `:97` asks `pendingEntries` before processing a new span.
2. `packages/core/src/db/canonical-ingestion-source-repo.ts:134` calls `assertNoMissingPrimary` before selecting pending entries. At `:187`, the exact query finds **any post-baseline user row without a witness in the active epoch** and throws `MEMORY_INGESTION_SOURCE_UNPROVEN`. Each measured failed retirement target includes the three real gaps. Later valid witnesses cannot be processed through this path while those gaps remain.
3. `packages/core/src/memory/memory-flush-port.ts:50` calls this ingestion runner. At `:66`, most errors become the closed `MEMORY_FLUSH_INCOMPLETE` class. Thus the operation code alone loses the deeper diagnosis; the source/journal evidence identifies a concrete current-code blocker. Missing adapter, malformed coverage, and other errors can also produce this class and should not be conflated.
4. `packages/core/src/agents/compaction-coordinator.ts:156` returns immediately after failed pre-retirement flush. The summary model call is later, at `:166`. The 26 failed events have no corresponding successful flush/summary transition for those attempts. The millisecond failures are consistent with a local precondition failure. They are not evidence of 26 paid summary calls.
5. Successful summary replacement requires later quality validation, source digest validation, and fenced CAS commit (`compaction-coordinator.ts:181`, `:198`, `:205`). Keeping the old summary on failure is a truth-preserving guard; bypassing it would discard unprocessed memory source evidence.

The three gaps align closely with three primary Run admissions (17–36 ms earlier). This is a **timestamp association**, not an immutable Run-to-Timeline identity join:

| User seq | Candidate Run | Durable state / last useful observations |
| --- | --- | --- |
| 3816 | `e0df11da-99c6-4889-a10a-58f0f02ae882` | `recovering/reconciliation_required`; model request started, no response or Run settlement |
| 3838 | `08304805-42b4-4f4f-9a80-13cc9eb6e50c` | same state; model request started, no response or Run settlement |
| 3847 | `87a8dbda-9db8-4267-adba-bcbbc69b5075` | model response and avatar rejection settled, then another request started; no Run settlement |

All three were classified for reconciliation by October 28. No cancellation request or terminal outcome is recorded. The ledger supports incomplete lifecycle/recovery, but does not establish whether termination, process crash, iterator loss, or another interruption caused it. Run provenance contains provider/trigger request ID, not a direct Timeline row ID. Do not use the timestamp match alone to manufacture exact historical commit witnesses.

#### Current code status and remaining risk

- Current `packages/core/src/agents/chat-agent.ts:230` appends the primary user row before request execution. Its later `finally` calls `finishRecordedTurn` (`:264`), which witnesses retained user/assistant/tool rows even on ordinary exceptional and iterator-close endings (`:300`). `chat-agent-primary-commit.test.ts:43` covers a thrown ending with visible partial text. This is already stronger than success-only witnessing and must not be proposed as wholly absent.
- That is still a gap between the initial durable append and end-of-turn witnessing. An abrupt process exit cannot run `finally`. `packages/core/src/memory/canonical-local-subsystem.ts:54` also catches witness-write failure and only logs `MEMORY_INGESTION_WITNESS_FAILED`. This is an additional possible gap mechanism, not a confirmed cause of these three rows.
- Startup only initializes a missing eligibility baseline (`canonical-local-subsystem.ts:34`; `canonical-ingestion-source-repo.ts:171` returns an existing baseline unchanged). It does not resolve historical holes. `packages/core/src/db/run-recovery-repo.ts:31` records recovery state and an event; this path does not write ingestion witnesses. Current source therefore does not demonstrate recovery of the measured blocker.
- Current production compaction configuration already has a retry budget of 3 and a 30-second cooldown (`packages/core/src/memory/runtime-composition.ts:154`). The coordinator uses per-operation budget plus Character cooldown (`compaction-coordinator.ts:247`, `:261`); growing source ranges create new operation identities (`:336`). Repeated deferral across 22 ranges is compatible with bounded retries; reducing the retry count cannot fix missing source proof.

#### Cost and behavior implications

The rolling summary stays at seq 3715, so later requests must continue admitting a larger unreduced tail until other projection limits intervene. `packages/core/src/agents/conversation-store.ts:184` loads from that checkpoint; `:203` folds and `:204` applies a token-window cut. This supports a mechanism for additional history processing and earlier hard-window pressure. It does **not** prove every subsequent request sent all 517 rows, nor quantify the counterfactual billed savings of a successful summary. The exact historical prompts are not retained.

Repeated guard failures are chiefly a local availability/progress problem; the cost impact is downstream context and potential repeated ordinary ingestion attempts. In this dataset the blocker is before the ingestion model call too, so no separate paid extraction retry should be inferred for those millisecond failures. This mechanism can increase absolute token spending without necessarily lowering cache percentage, since repeated history may remain cached.

Recommended planning boundary: preserve the flush gate; design durable primary-source origin/settlement evidence and recovery for interrupted runs, then resolve existing holes only with exact recoverable evidence or an explicit, reviewable historical classification. Do not silently advance the cursor, set flush to `not_required`, delete the three messages, fabricate a successful model outcome, or mark whole interrupted transcripts as processed. A split between durable input-origin receipt and later complete-turn witness is a candidate architecture, requiring review of retraction and incomplete-turn semantics before implementation.

### 2. Avatar validation failures are real empty inputs; most execution rejections are normal outcomes

This section joins the 163 observed `tool.result.settled` records to persisted `timeline_messages.parts` using `toolCallId`. It does not treat missing persisted assistant arguments as evidence that the model sent `{}`. The validation **result itself** independently records `Value: {}`.

| Observed outcome | Count | Persisted-result diagnosis |
| --- | --- | --- |
| completed | 78 | 8 legacy `{ok:true}`, 70 `applied` |
| validation / `tool_validation_failed` | 66 | all 66 join to `AI_InvalidToolInputError`, input `{}`, missing required `name` |
| execution / `avatar_rejected` | 19 | 18 join to `reason: already_active`; 1 result absent from Timeline in the unsettled seq-3847 Run |

All 66 observed validation errors have 1,151 characters of diagnostic text, including allowed enum values repeated in the Zod message. Their total stored diagnostic length is 75,966 characters. This is a storage/replay-size observation, not a tokenizer measurement; projection reduction and window admission determine actual request impact. Earlier Timeline-only history contains costume-vocabulary mismatch errors, but those are outside this 163-event cohort and are not the explanation for its 66 failures.

`packages/core/src/avatar/set-expression-tool.ts:25` requires `name` through a current-vocabulary schema; invalid arguments fail before `execute`. Valid execution waits for the renderer outcome (`:28`). `apps/desktop/src/renderer/live2d/avatar-commands.ts:63` deliberately returns `rejected/already_active` when the requested expression is already selected. `packages/core/src/avatar/avatar-tool-result.ts:29` tells the model this is normal, with no retry or apology. Generic observability classifies `{ok:false}` as failed (`packages/core/src/agents/tool-outcome.ts:33`), so the chart's failure count is not identical to functional failure or wasted work.

#### What actually happens after the failures

For every avatar settlement, find the next `model.request.started` in the **same Run and Attempt** with greater event sequence. Match that event's model Effect ID to `run_usage`. Tool settlement has explicit `modelEffectId` on 58/66 invalid calls, all 19 rejections, and 73/78 completed calls; the remaining older events are ordered using Run/Attempt event sequence. None of the following counts require interpreting private assistant prose.

| Settlement class | Another model request | No later request |
| --- | --- | --- |
| validation failure | 39 | 27 |
| execution rejection | 11 | 8 |
| completed | 28 | 50 |

The 66 invalid calls occur in 49 Runs: 32 Runs have one invalid call, and 17 have two. The 39 immediate next requests after an invalid call yield:

- 17 another invalid expression call, again `{}`;
- 13 a completed expression;
- 5 an expression rejection (`already_active` in available results);
- 4 no observed tool settlement in that next model step.

| Immediate continuation cohort | Model calls | Input tokens | Cache-read | Non-cache input | Output tokens | Reasoning tokens (subset of output) |
| --- | --- | --- | --- | --- | --- | --- |
| All next requests after invalid input | 39 | 2,309,939 | 2,289,920 | 20,019 | 2,694 | 1,033 |
| Next request repeats invalid expression input | 17 | 1,011,447 | 1,002,880 | 8,567 | 807 | 248 |

All 39 model Effects have usage records, and in this cohort `input_tokens = cache_read_tokens + input_no_cache_tokens`. Cache reads are approximately 99.13% of the first row, illustrating why high cache percentage can coexist with avoidable calls. These are measured costs of the associated requests, **not an assertion that all their content or cost can be deleted**. A request can still contain required user-facing text; successful corrections preserve presentation capability. Cached input still has a provider price and latency, but no currency estimate is made here.

Reproducible example of a repeated invalid correction: Run `10ab8b34-0014-4ada-a495-2216dc6d3105`, invalid settlement event seq 13, next model request seq 15, Effect `39c600a4-6ce6-4acb-9fa8-57111b4f2705`: 51,931 input tokens (51,456 cache-read, 475 non-cache), 24 output; that next step settles another invalid expression.

Of the 11 next requests after an execution rejection, 4 follow a step containing an informational tool (`recall`, `update_memory`, `manage_interaction_pattern`, or `retain`) as well as the avatar call. Six have persisted avatar-only assistant tool-call rows with no text, consistent with express-first-then-talk. One has no persisted assistant row because its Run remained unsettled. Thus there is no evidence that these 11 are generic useless rejection retries. The six rows do not by themselves prove the entire prior Run lacked text; that limitation is retained.

#### Current defenses already present; hypothesis limits

- `packages/core/src/avatar/presentation-stop.ts:25` stops after a spoken presentation-only valid step; the first invalid presentation step gets feedback, the second invalid presentation step stops. Mixed informational steps and express-first steps preserve required continuation. `packages/core/src/main.ts:489` wires this into primary Chat; `packages/core/src/agents/agent-attempt.ts:135` composes it on the ordinary path. This is a bounded correction policy, not an unbounded retry loop.
- `packages/core/src/avatar/vocab-name-schema.ts:13` already adds an explicit required-object description, a current-name object example, and guidance not to repeat `{}`; `:15` keeps the allowed values once rather than duplicating them in the message. Existing `chat-agent-presentation.test.ts` covers correct-once, repeat-empty-stop, rejected outcome stop, and express-first behavior. These files were inspected, not re-tested or deployed in this research.
- The measured historical error text does not include the current new object guidance. It cannot establish whether the current change improves a real model's correction rate.
- `packages/core/src/agents/turn-mapping.ts:48` intentionally persists names and IDs without raw tool input; `:110` replays those calls with `input: {}`. Successful old calls therefore become examples with empty argument objects. This is a plausible contributor to repeated empty new calls, especially with a large replay tail, but exact prompts/model internals are unavailable and the causal contribution is not proven. The fresh error result proves the new invalid input independently; replay omission itself is not evidence of failure.
- Do not restore arbitrary tool arguments or remove dynamic enum validation to raise success statistics. The names-only privacy boundary and multi-costume vocabulary boundary are explicit contracts. Candidate follow-up is a privacy-preserving representation of historical presentation outcomes or narrowly typed safe presentation state, evaluated against the current representation, plus real corrected-call/fulfilled-intent metrics. Any persisted safe-argument exception needs its own reviewed contract.

### Prioritized validation and tradeoffs

1. **Recover memory progress without losing evidence.** Use deterministic interrupted/failed/clean-retracted lifecycle cases to verify that a retained primary user row has recoverable exact provenance, that retracted rows do not gain eligibility, and that next ordinary ingestion/compaction makes progress after recovery. Test existing-hole migration separately from preventing new holes. Real data mutation and paid extraction/summarization require later authorization; none was performed here.
2. **Verify existing empty-input guidance before adding another patch.** Compare initial validity and one-correction success under identical current tool schemas and a captured privacy-safe replay fixture. Preserve two-step failure stop, correct-once behavior, express-first reply, mixed informational result consumption, and multi-costume vocabulary changes. Count completed user intent, model requests, non-cache/cache-read/output charges, and presentation results. Lowering the correction budget saves a call but removes the opportunity to fulfill the presentation intent.
3. **Make observability expose progress and semantic outcomes.** Preserve raw existing generic failed classification for compatibility, but distinguish validation from normal `already_active` in projections and expose the closed underlying ingestion failure class, first unresolved sequence, pending witness count, checkpoint age, and no-progress deferral count. Counts/IDs/codes suffice; private prompts or full tool arguments are unnecessary.

## Reproducible Read-Only Queries

Open the DB with Python's standard library; all snippets are read-only:

```python
import sqlite3, json, collections, re
c = sqlite3.connect('file:///C:/Users/55473/.takiagent/taki.db?mode=ro', uri=True)
c.row_factory = sqlite3.Row
c.execute('PRAGMA query_only=ON')
c.execute('PRAGMA busy_timeout=10000')
```

Missing user witnesses, using the actual per-Character active epoch baseline:

```sql
SELECT t.seq, t.created_at, p.timeline_seq AS witness_seq
FROM canonical_memory_ingestion_cursors cur
JOIN timeline_messages t ON t.character_id=cur.character_id
LEFT JOIN canonical_memory_primary_commits p ON p.timeline_seq=t.seq
JOIN canonical_memory_authority_state a ON a.active_epoch_id=cur.authority_epoch_id
WHERE t.seq>=cur.eligibility_start_seq AND t.role='user'
  AND (p.timeline_seq IS NULL OR p.authority_epoch_id<>cur.authority_epoch_id)
ORDER BY t.seq;

SELECT MIN(timeline_seq), MAX(timeline_seq), COUNT(*)
FROM canonical_memory_primary_commits WHERE ingestion_span_id IS NULL;

SELECT state,failure_code,COUNT(*),SUM(attempt_no),MIN(selected_through_seq),MAX(selected_through_seq)
FROM conversation_compaction_operations GROUP BY state,failure_code;

SELECT character_id,through_seq,revision,LENGTH(text),updated_at FROM conversation_summary;
SELECT kind,COUNT(*) FROM conversation_compaction_events GROUP BY kind;
```

Safe tool-result class extraction (never print raw private chat or arbitrary tool payloads):

```python
observed = [dict(r) for r in c.execute("""
 SELECT run_id,attempt_id,seq,payload_json FROM run_events
 WHERE kind='tool.result.settled'
 AND json_extract(payload_json,'$.toolName')='avatar_set_expression'
""")]
results = {}
for row in c.execute("SELECT parts FROM timeline_messages WHERE role='tool' AND parts LIKE '%avatar_set_expression%'"):
    for part in json.loads(row['parts'] or '[]'):
        if part.get('toolName') == 'avatar_set_expression':
            results[part['toolCallId']] = part.get('output')
classes = collections.Counter()
for row in observed:
    p = json.loads(row['payload_json']); out = results.get(p['toolCallId'])
    if out is None: label = 'not_persisted'
    elif out.get('type') == 'error-text':
        label = 'empty_object' if 'Value: {}.\nError message:' in out.get('value','') else 'other_validation'
    else:
        v = out.get('value', {}); label = v.get('reason', v.get('outcome', 'legacy_ok'))
    classes[(p.get('errorCode','completed'), label)] += 1
print(classes)
```

Immediate same-Attempt model continuation and usage totals, including the repeated-invalid subset:

```sql
WITH failures AS (
 SELECT run_id,attempt_id,seq,
   json_extract(payload_json,'$.errorCode') AS error_code
 FROM run_events WHERE kind='tool.result.settled'
 AND json_extract(payload_json,'$.toolName')='avatar_set_expression'
), next_request AS (
 SELECT f.*, (SELECT MIN(n.seq) FROM run_events n
   WHERE n.run_id=f.run_id AND n.attempt_id=f.attempt_id
   AND n.kind='model.request.started' AND n.seq>f.seq) AS next_seq
 FROM failures f
), linked AS (
 SELECT n.*,json_extract(e.payload_json,'$.effectId') AS next_effect,
   (SELECT MIN(z.seq) FROM run_events z WHERE z.run_id=n.run_id
    AND z.attempt_id=n.attempt_id AND z.kind='model.request.started'
    AND z.seq>n.next_seq) AS following_seq
 FROM next_request n LEFT JOIN run_events e
 ON e.run_id=n.run_id AND e.seq=n.next_seq
)
SELECT error_code, next_seq IS NOT NULL AS continued, COUNT(*)
FROM linked GROUP BY error_code,continued;
```

For usage and repeat classification, reuse the CTE and replace the final `SELECT` with:

```sql
SELECT EXISTS(SELECT 1 FROM run_events t WHERE t.run_id=l.run_id
 AND t.attempt_id=l.attempt_id AND t.seq>l.next_seq
 AND (l.following_seq IS NULL OR t.seq<l.following_seq)
 AND t.kind='tool.result.settled'
 AND json_extract(t.payload_json,'$.toolName')='avatar_set_expression'
 AND json_extract(t.payload_json,'$.errorCode')='tool_validation_failed') AS repeated,
 COUNT(*) AS calls,SUM(u.input_tokens),SUM(u.cache_read_tokens),
 SUM(u.input_no_cache_tokens),SUM(u.output_tokens),SUM(u.reasoning_tokens)
FROM linked l JOIN run_usage u ON u.effect_id=l.next_effect
WHERE l.error_code='tool_validation_failed' GROUP BY repeated;
```

## Files Found

- `packages/core/src/agents/compaction-coordinator.ts` — flush-before-summary lifecycle, pressure capture, retries, and CAS summary commit.
- `packages/core/src/memory/memory-flush-port.ts` — canonical/local and legacy retirement coverage adapters.
- `packages/core/src/avatar/set-expression-tool.ts` — dynamic expression schema and renderer-outcome execution.
- `packages/core/src/agents/turn-mapping.ts` — persisted tool-call/result replay, including omitted argument privacy boundary.
- `packages/core/src/db/canonical-ingestion-source-repo.ts` — exact-primary provenance, pending work, and guarded cursor advancement.
- `packages/core/src/memory/canonical-local-ingestion.ts` — durable gate/extraction/Bank receipts and coverage computation.
- `packages/core/src/memory/canonical-local-subsystem.ts` — canonical runtime binding, baseline initialization, witness failure logging.
- `packages/core/src/agents/chat-agent.ts` — user append, end-of-turn persistence, exceptional cleanup, and primary witness timing.
- `packages/core/src/avatar/presentation-stop.ts` — one-correction policy and presentation-only stop semantics.
- `packages/core/src/avatar/vocab-name-schema.ts` — current dynamic enum and object-shape correction guidance.
- `packages/core/src/db/run-recovery-repo.ts` — durable nonterminal recovery classification.
- `packages/core/src/agents/chat-agent-primary-commit.test.ts` — existing normal, retracted, and thrown-ending witness tests.
- `packages/core/src/agents/chat-agent-presentation.test.ts` — existing SDK-path one-correction, bounded failure, and presentation tests.

## Related Specs

- `.trellis/spec/backend/compaction-harness.md` — retirement durability, privacy-safe evidence, reduction, retries, summary quality.
- `.trellis/spec/backend/agent-runtime.md` — presentation stop semantics and replay privacy.
- `.trellis/spec/backend/canonical-local-memory-runtime.md` — ingestion receipts and canonical retirement coverage.

## External References

External pi/DeepSeek/provider evidence is owned by a separate researcher; this file establishes local causal evidence only.
The inspected Core manifest declares `ai: 7.0.148`, `@ai-sdk/openai-compatible: 3.0.75`, `@ai-sdk/mcp: 2.0.81`, and `zod: ^4.4.0`. These are current manifest declarations, not a reconstruction of the October producer's installed dependency tree.

## Caveats / Not Found

- Production data ends in October; current dirty worktree source can differ from the producer and is not proof of deployed behavior.
- Exact prompt bytes and historical tool-call arguments are unavailable; preserve the intentional omission of tool arguments instead of proposing their unrestricted retention.
- Do not equate estimated context pressure or character counts with billed tokens, or high failure count with a retry loop.
- No production code/config/database/process/task-pointer/Git mutation, external model request, dependency installation, or test fixture execution occurred. Only this research document was written. Read-only SQL produced the reported counts; existing test bodies were inspected but not run.
- The deep compaction blocker is reproducible from current source predicates and real missing-witness rows. Historical executable identity and process-stop cause remain unknown; the broader 68% cache ratio cannot be attributed to this defect alone.
- Any cache-hit or currency comparison must preserve the parent analysis's denominator and provider normalization. The continuation subset explicitly reconciles inclusive input against non-cache plus cache-read; it does not assume all other historical usage has identical semantics.
- All embedded SQL queries were executed against the read-only database after documentation was written and reproduced the listed gaps, operation counts, continuation counts, and usage subtotals. The artifact is UTF-8 without BOM.
