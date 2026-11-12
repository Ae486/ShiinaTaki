# Parent interface implementation and acceptance — 2026-11-04

Scope: requirements 15–18 of the existing interactive delegation task. Owner authorization is session
`01a1a607-29a8-7c12-8a34-c6d90f0eb1aa`. This record covers the interface optimization, not parent-task
closeout or owner visual acceptance. Workspace: `H:/TakiAgent-worktrees/t4`; branch:
`task/t4-skills-mcp-productization`; starting HEAD: `a2269ad` with extensive pre-existing changes.

## Delivered contract

The model calls `handle_agent_event({ eventId, intent, text, target })` with five explicit intentions:

| Model intent | Meaning | Existing durable action |
| --- | --- | --- |
| `record` | Retain private evidence without public speech | `retained` |
| `ask_user` | Ask for user input | `needs_user_input` |
| `reply` | Propose the actual public answer | `speech_proposed` |
| `answer_child` | Send a private child reply, answering the selected question when applicable | `answered_child` |
| `continue_child` | Approve a permitted exact check-in | `continue_child` |

Core derives stable operation identity inside the existing transaction. An equivalent canonical action
reuses its original key, receipt and consumer Run, including historical arbitrary keys; a changed action
refuses. Ordinary reads and model termination never implicitly handle an event. Historical `no_action`
remains readable and is not reinterpreted as `record`.

Ordinary `send_subagent_message` remains separate because private inbox tools and ordinary tools have
different static recording/activity boundaries. This preserves a simple fixed privacy boundary. No new
wait/yield tool, scheduler, coordinator, migration, provider routing or dynamic privacy classifier was added.
The child interaction/completion tool surface is unchanged.

Child actions require the complete exact target and existing Stop/check-in authority. For `answer_child`,
Core derives `replyToEventId` from the selected immutable event: the `needs_input` ID, or null for ordinary
message/final/interrupted evidence. A nonblocking reply cannot accidentally answer a later question.

Stop revokes the original delayed-publication authority. Explicit user Continue restores the same child's
work/reporting and resets unattended approvals; later legitimate parent check-in approvals increment the
new interval. Continue does not recreate the cancelled speech root. A fresh user request can obtain the
completed finding through ordinary foreground speech.

## Production and deterministic evidence

- The 27 owned source/test/index paths and actual dirty-worktree preimages are recorded in
  `artifacts/delegation-interface-20261104/implementation-files.json` and `implementation.diff`.
  Eight production TS files, fourteen tests and five indexes changed. All 27 final hashes were checked.
- `implementation-checks.md` records the failing-before/passing-after flat schema, historical replay,
  ordinary private reply and publication regressions. Final affected four suites passed 52 tests.
- `pnpm -r --workspace-concurrency=1 test --maxWorkers=1`: 6,719 passed / six skipped
  (Shared 727, CLI 50, Desktop 1,369, Core 4,573). No unchanged full-suite rerun is needed for later
  E2E-only assertion corrections.
- `pnpm -r typecheck`: passed. Root `pnpm lint` fails on one pre-existing historical backup:
  `artifacts/runtime-inbox-preimages-20261025/packages/shared/src/index.ts` exceeds max-lines.
  `pnpm exec eslint . --ignore-pattern 'artifacts/runtime-inbox-preimages-20261025/**'` passed.
  The same complete source-lint command passed again after the final E2E changes (`final-source-lint.log`).
- Rust clippy and 211 tests passed. Current `taki-node` was rebuilt with locked offline dependencies;
  binary SHA-256 `c700f0c07a0e0c05ca368b910d4c9930b5580f104ca18d23fc3ed92b2a096fc0`.
- Scripted interface/native preflight checks passed 13 tests with one real-gated skip. A separate missing
  canonical-argument regression passed. Native preflight proves actual paired Host hostname execution,
  escalation refusal, source parity and process cleanup; it makes zero model calls.
- Final check-in regression passed both scripted SDK/Core/SQLite branches (2/2): parent continuation
  after the user reset, and a genuine later `ask_user` followed by one authenticated user Continue.
  Scoped E2E lint/typecheck/diff checks passed. The first compact-wait parser failure remains in
  the evidence history; it did not indicate a production failure.

Logs: `target/delegation-interface-20261104-validation/`. Native and no-model artifacts:
`artifacts/delegation-interface-20261104/`. These are source/integration observations, not manual UI acceptance.
Final coordinator checks verified all 27 production/test/index and 12 E2E manifest hashes, strict UTF-8
without BOM across 47 scoped source/doc files, scoped diff whitespace, and both Trellis context manifests.

## Actual-model campaign

Configured model: `deepseek-v4-flash`, provider host `api.deepseek.com`, through the existing ignored
credential loader. Retained usage labels say `deepseek-flash`; no undocumented alias equivalence is assumed.
Prompts describe work and outcomes without tool names or argument recipes. Each run uses isolated synthetic
data, production Core, finite request/time bounds, source hashes and mandatory cleanup. The delayed case
uses a real native exec Host; the other cases use production Core workspace operations without a native Host.

| Scenario | Requests | Status and evidence |
| --- | --- | --- |
| Delayed reports plus useful foreground work | 10 | Passed: `delayed/interface-delayed-native-tuonGs` |
| Ordinary guidance plus exact private question answer | 12 | Passed: `question/interface-exact-question-MTzA7h` |
| First check-in/Stop attempt | 24 | Failed assertion timing, plus one refused request: `checkin/interface-checkin-stop-Afbe7F` |
| Corrected check-in/Stop rerun | 23 | Failed waiting for an additional user decision: `checkin-corrected/interface-checkin-stop-6UwlHc` |
| Check-in/Stop with a bounded optional user response | 29 confirmed + one uncertain fetch | Passed: `checkin-user-decision/interface-checkin-stop-OKB1an`; extra user branch was not selected |

Paths above are relative to `artifacts/delegation-interface-real-20261104/`. `campaign.json` records the
executed counts and announced bound revision: initial ceiling 64, then 80 before the corrected rerun
(46 used + 32 rerun + two reserve), then 103 before the bounded user-response run (69 used + 32 + two reserve).
There are no automatic scenario retries. Observer attempts, successful
upstream requests, completed generations and model Effects are different measurements.

Final accounting is 98 response/transport-confirmed upstream requests and one additional uncertain fetch,
conservatively charged as 99 against the 103 ceiling. The last ancillary non-streaming primary Memory
eligibility request was captured and attempted, then cancelled as `observer-closed` without a response.
Its provider receipt, billing and Memory decision outcome are unknown. It is not worker compaction and
does not add a completed task-model step. `usage-accounting.json`, regenerated by `summarize.py`, records
per-scenario hashes/counts and reported token subtotals; unreported usage remains unknown. No further
model calls are needed for this slice.

The delayed case acknowledged in approximately 5.3 seconds and completed actual hostname retrieval in
approximately 2.45 seconds while both child requests were held. Two separately delivered reports produced
one final public answer: A=45, B=89, difference=44, with a sent publication. One redundant all-workers read
remained; cross-batch result reads had a purpose. This is not a claim of zero coordination overhead.

The question case delivered ordinary preservation/offline guidance without prematurely answering a future
question. The private answer supplied 300ms to the exact question, resumed the same work in a new Run and
produced the correct public choice Amber (250ms; Cobalt is 700ms). An unproductive `dir /b` returned
`NO_NODE`, and one child completion returned `MATERIAL_NOT_FOUND` before successful recovery.

The first check-in attempt reached validated total 308. Its immutable check-ins were `(steps=3,start=0,
approvals=0)`, `(6,3,1,user)`, then after exact user Continue `(9,6,0,parent_or_user)`. A later legitimate
parent continuation produced final progress `(11,9,1)`. Requiring final approvals to stay zero was wrong;
reset must be checked at the user receipt and subsequent approvals counted separately. The final event
was not handled before budget refusal. Original failed evidence remains unchanged and is not called a pass.

The corrected run proved the immediate user reset but paused normally at step 9 when the parent selected
`ask_user`. Its note explicitly honored the original user prompt's one-approval allowance. All seven
values had been read and the parent's factual subtotal was 308; the child had not committed its final
report. The fixture did not provide the additional requested user decision and timed out. All 23 requests
succeeded, with no source drift, cleanup failure or budget refusal. This remains a failed scenario,
not a production counter defect or evidence of final delivery.

Independent review selected a narrow fixture correction: permit one additional authenticated user Continue
only for an actual open check-in already handled as `needs_user_input`. Verify quiescent child/no prior
resume, retain the original action, assert another immediate user reset and account final approvals after
the latest user input. Both valid choices (parent continuation or user request) need scripted regression
coverage. A further request or missing final evidence still fails. No prompt rewrite, shorter evidence
chain, injected parent action, restart machinery or production change is used to manufacture a pass.

The final run passed in 87.86 seconds with the original prompt and all seven sources. It took the parent
continuation branch at step 9, so the optional extra user decision was not exercised by this model sample.
The actual user reset at step 6 was followed by one accepted parent continuation, then a validated final
at step 10 with approvals=1. All seven original values were retained and the final total was 308.
The exact final event was handled as `speech_proposed`; publication correctly returned `source_unavailable`
because Stop had cancelled the original root. No old delivery was sent. A new foreground user request
obtained a real committed public answer of 308. Source hashes stayed unchanged and cleanup succeeded.
No waiting command, unknown execution/inspection input or repeated identical inspection was observed.
Two child `read_file({})` validation failures were corrected; this was not flawless first-attempt behavior.
One misaddressed ordinary guidance call was also refused and corrected. The independent final audit
(`final-checkin-audit.json`) verified 18 named facts, including four exact private action joins, all
seven sequential reads, the original user reset, same work across four Runs, the refused old speech
and the actual new foreground answer. Four terminal handler raw payloads are unavailable; their
canonical receipts establish accepted semantics only. The cancelled primary Memory request contained
committed public primary rows and excluded the four private inbox actions.

Independent review of the first two retained artifacts verified four action/consumer/membership/model
Effect/input-digest joins, private recording and actual sent publication. See `post-run-audit.json`.
Four terminal handler raw inputs were not retained; canonical receipts prove accepted semantics only.
Both execution inputs were present, so that gap does not hide a waiting command. The corrected evidence
helper records unavailable inputs as null and rejects strict no-wait/no-polling claims when execution or
inspection inputs are unknown. Old paid artifacts were not rewritten.

## Remaining acceptance and limits

All three scoped real-model scenarios now have successful evidence, with independent retained-artifact
review complete and no remaining scoped blocker. Existing source checks establish exact
controls, atomicity, retries, publication and privacy within their tested boundaries. A few real-model
samples do not establish general reliability or causal token/latency savings.

Full long-audit/compaction, full eight-event natural handling, owner UI acceptance, native Hindsight and
T4/main SQLite convergence remain separate parent-task gates. No real-user database, dependency,
commit/push/archive or deployment changes were performed.
