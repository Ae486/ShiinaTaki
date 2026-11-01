# Prompt and tool optimization implementation evidence

Date: 2026-11-01. Status: implementation, deterministic verification and independent review complete. A subsequent [bounded real-model validation](PROMPT-AND-TOOL-REAL-VALIDATION-2026-11-01.md) completed with open behavioral findings; manual visual acceptance remains unperformed.

The [approved proposal](PROMPT-AND-TOOL-OPTIMIZATION-2026-11-01.md) owns requirements and field decisions. This record owns the implementation checkpoint and verification results. No new Trellis task was created; current session task source is `none`. The T4 checkout is `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, baseline HEAD `6b36d0d`. External changes are limited to the approved QQ model-facing interfaces. Both worktrees contain extensive pre-existing edits; no repository reset, commit or push is part of this work.

## Implementation checkpoint

| Area | Implementation | Verification state |
| --- | --- | --- |
| Primary prompt | Task, completion and capability-choice guidance follows the exact active tool subset at each SDK step. Primary-only; existing worker, initiative and Utility contracts remain separate. | SDK request checks passed for disclosure, exclusions, active Memory procedure and private/worker/selected initiative roles. |
| Base and avatar guidance | Result-supported truthfulness, historical omitted arguments, truthful presentation outcomes; dynamic Zod correction example preserves current enum and removes its repeated default message. Stop policy unchanged. | Missing input does not execute; corrected call executes once; repeated empty input stops after two requests; existing busy/tail-stop/costume cases pass. |
| Delegation | Family-owned compact control/navigation/inbox views, exact targets/materials retained; explicit detailed worker list; mode-specific inbox guidance. | Exact targets, material round trips, raw collectors, frozen claims and paging checked; one-unit Unicode page regression repaired and independently rechecked. |
| Memory/Skills/extensions/Hosts | Semantic evidence, deep metadata, mutation privacy, raw disclosure metadata and captured closures retained; unavailable Host state remains explicit. | SDK and existing contract checks pass. Unknown MCP results preserve their complete indirect JSON payload. |
| Co-watching/media/scheduler/patterns | Domain result projection and intent guidance; scheduler full list retained. | 7 files / 53 focused tests passed; actual SDK retains mixed completed/unknown/cancelled outcomes and functional selectors. |
| QQ consumer/producer | Three read-only tools retain evidence/progress semantics; summary independently preserves sender/quote attribution and treats preceding summary as data. | 4 files / 52 focused tests and QQ typecheck passed. No QQ result reduction was justified by the audit. |

## Validation boundaries

Scripted models exercise the installed SDK and application paths without paid model calls. They can establish which instructions, schemas, errors and projected results reach the model, and which original records remain intact. They cannot establish improved real-model task completion or first-call accuracy.

Avatar historical evidence remains as described in the [diagnosis](research/AVATAR-CALL-DIAGNOSIS-2026-11-01.md). Repeated empty input is observed; historical empty replay is a candidate influence, not a proven cause. This implementation neither retains new private arguments in Timeline nor changes the bounded presentation stop policy.

## Request-size observations

These are synthetic fixtures through the installed SDK (`ai@7.0.148`), measured as UTF-8 bytes, not tokens, billing or traffic statistics. Each comparison holds the relevant fixture fixed. Added primary guidance can increase initial request size; these local comparisons do not establish net savings for every user task.

| Fixture | Before | After | Scope |
| --- | ---: | ---: | --- |
| Two-worker navigation, one-item first page | 12,205 | 11,746 | Actual second provider request's serialized prompt and tools, including governance/source/material wrapping; `subagent-model-output.test.ts`. |
| Avatar missing argument, 30 synthetic current names | 1,788 | 1,286 | Serialized SDK error output; original `z.enum(names)` versus current name schema. |
| Same Avatar fixture | 2,889 | 2,503 | Serialized second-request prompt and tool definitions, including the new parameter description. |

Avatar measurement used names `expression_01` through `expression_30`, one `avatar_set_expression` tool with description `Set the current expression.`, input `{}`, prompt `Show a fitting expression.`, and a scripted second text response. Both versions used `ToolLoopAgent` with two-step bound. Count `Buffer.byteLength(JSON.stringify(errorOutput))` and `Buffer.byteLength(JSON.stringify({prompt: secondRequest.prompt, tools: secondRequest.tools}))`; no provider was contacted.

## Independent review and retained limitations

- The independent advisor reproduced the one-code-unit Unicode paging stall. Regression first failed on both event/action paths, then passed after guaranteeing cursor progress over a whole surrogate pair. Existing larger page behavior remains unchanged.
- The advisor found that forwarding indirect MCP output through the SDK's content-only projector discarded unique `structuredContent` selectors and `isError`. The bridge now conservatively preserves complete unknown MCP payloads. Known Skill projection stays compact; direct MCP behavior remains unchanged. Indirect JSON image/resource presentation is an existing limitation, not a newly implemented multimodal feature.
- The independent advisor rechecked both fixes against actual tool/SDK requests and closed the findings. No remaining evidence-backed blocking issue was reported within the reviewed scope.
- Both-scope Memory recall already returns only the first branch error when every branch fails. Model output preserves that error and requested scope; successful/partial results retain existing branchFailures. No new hidden diagnostic state or aggregate protocol was introduced.
- Default prompt cards and integration Skills are source assets. Existing customized workspace copies and installed packages were not overwritten. Runtime prompt/Skill caches and captured Run contexts require their normal reload/restart/new-admission boundary before observing changes; frozen older requests and summaries remain unchanged.
- The implementation stage did not include paid model calls. Subsequent owner-authorized validation used 37 initial requests, nine in the first RV-2 follow-up, eight and eleven in the delayed-report rounds, and three final decision probes (68 total). Delayed final delivery passed once; wait-only command behavior remains open and the RV-1 wording needs dedicated behavioral revalidation. Live Avatar rendering, deployment and manual acceptance remain unperformed; other boundaries are listed in that report.

## Workspace gates

| Check | Result |
| --- | --- |
| `pnpm -r typecheck` | Shared, CLI, Desktop and E2E passed. Initial Core errors in new tests were fixed; final `pnpm --filter @taki/core typecheck` passed after the MCP review correction. |
| `pnpm lint` | Reports a pre-existing archived source file: `artifacts/runtime-inbox-preimages-20261025/packages/shared/src/index.ts` exceeds the production line limit. The baseline already contained `artifacts/`; that file's last-write timestamp predates this work. No archive or lint policy was changed to conceal it. |
| `pnpm exec eslint . --ignore-pattern 'artifacts/runtime-inbox-preimages-20261025/**'` | Passed on the final current source and all other normally included files. |
| `pnpm -r test --maxWorkers=2` | Shared: 77 files / 684 tests; CLI: 8 / 50; Desktop: 215 / 1,289 passed. First Core sweep: 536 files / 4,351 passed, one skipped file / six skipped tests, one failure while the MCP review correction was being integrated. |
| Final affected integration rerun | Six files / 55 tests passed: extension model output, registry, Run context, disclosure, subagent model output and Companion guidance. |
| Final stable Core full regression | `pnpm --filter @taki/core exec vitest run --maxWorkers=4` passed: 537 files / 4,354 tests; one file / six tests skipped, no failures. All four workspace packages together: 6,377 passing tests. |
| `cargo clippy --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings` | Passed. |
| `cargo test --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | Passed: 204 library tests + seven secret-key tests; no Rust source edits in this implementation. |
| QQ focused tests and typecheck | 52 focused tests passed, including `test/contract/mcp-tools.test.ts` and `test/unit/summary/validator.test.ts`; final MCP contract rerun: 24 passed. `pnpm exec tsc --noEmit` passed. |
| Whitespace / review | Owned diff checks passed. Independent final review closed both reproduced findings. |

The full unit/integration suite does not run the separate key-gated real-provider E2E track. No paid-provider effectiveness claim or manual acceptance is inferred from these checks.

## Owner-directed uncertainty clarification after real validation

Following RV-1, the owner requested a global rule to look up unclear Memory facts and avoid unsupported assertions.
The base Memory procedure and shared source-interpretation rule now implement that instruction while preserving
authority-specific tool names, lookup-failure truth and the distinction between unknown and a negative/pending fact.
The change is covered by six focused files / 37 passing tests plus scoped lint and whitespace checks. The original
real-validation samples remain unchanged; this follow-up has not been claimed to establish a lower real-model error rate.

## Owner-directed asynchronous reply clarification after real validation

RV-2 guidance now distinguishes completion of a reply from completion of the original user task across the primary
prompt, delegation/inspection descriptions and both inbox modes. Pending notified work can continue after the main
reply ends; later events support integrated delivery without another user message. Purposeful inspection/guidance,
silent work and exact publication authority retain their contracts. Only dynamic guidance changes; frozen inbox
claims and all execution/data contracts remain intact.

Five focused files / 41 tests, scoped ESLint, Core/E2E typechecks and whitespace checks passed. One unchanged real
reimbursement scenario delivered the correct integrated answer and settled its foreground inbox with nine upstream
requests, but still made five inspections. Complete report previews were already present before two redundant history
reads, and the full diagnostics view was still requested. RV-2 therefore remains an open behavioral finding. The rerun
did not exercise an early ACK followed by idle final publication. See the real-validation report for the exact trace,
new evidence root, usage and limitations; no further production wording change or live retry followed that observation.

## Minimal semantic follow-up and delayed-report validation

The owner approved the next revision with an explicit simplicity constraint. Seven existing production files now
clarify the interface; there is no new production module, waiting tool, coordinator, persistent state, background
timer or scheduling path. Production changes net approximately 25 lines, including the existing idle guidance fix.

- The truthfulness floor distinguishes personally executed actions from accepted, attributed worker reports. Its
  existing 54-line prompt guard still passes; duplicate wording was consolidated rather than raising the limit.
- Accepted work receipts expose the actual automatic/silent reporting policy and a short next-action hint. Exact
  targets remain; ordinary message/stop receipts do not imply a newly delegated job.
- `workers` now uses the compact model list; `diagnostics` explicitly requests the existing full view. Native execute
  results and operator APIs are unchanged. The legacy unused `afterSeq` remains accepted but is no longer required;
  `cursor` owns paging and omitted `limit` defaults to 20.
- Model inspection separates `readStatus` and `bodyComplete` from terminal outcomes. Whole result records expose a
  `resultStatus`; `not_recorded` means no terminal report is recorded, not inferred running/failure/success. These
  fields wrap existing serialized bodies without changing their bytes or offsets, including previous cursors.
- New inbox claims explicitly allow complete report previews to be used directly. Interrupted recovery guidance is
  present only for interrupted batches and applies only to those events. Frozen historical claims remain unchanged.
- The existing test-only acknowledgement reader now uses accepted work plus its exact target instead of requiring
  an input ID that compact work receipts correctly omit.

Nine affected Core files / 68 tests, four no-model E2E/preflight tests, Shared/Core/E2E typechecks, scoped ESLint and
whitespace checks passed. A timed real test then held each child request until the parent returned, accepted an
unrelated greeting while both children were held, and released the two reports into separate idle batches.

That first timed run used eight upstream calls (54 cumulative). Foreground responsiveness, actual child completion
and both idle handlers passed; final delivery failed. The second handler assumed A had not reported because A was
absent from its current batch, although the first handler had already retained A. The exact failed evidence is
preserved under `artifacts/prompt-tool-semantics-20261101/`.

The existing idle instruction now explains that a batch contains newly delivered events and directs one retained-result
lookup when another required report is absent from context, before treating it as pending. This adds no runtime
state or automatic history copy. Four relevant files / 38 tests and scoped lint passed after that change.

After the owner extended the aggregate ceiling to 68, the same timed scenario passed with 11 upstream calls. The main
reply ended while both children were held, an unrelated greeting was answered, and separately delivered reports led
to one recorded/sent integrated final answer without a reminder. The three inspections were one compact initial list
and two cross-batch result lookups. All production/fixture source hashes match that passing run.

A residual wait-only `exec` command was refused with `NO_NODE` before the initial reply ended. Three bounded model-only
probes of an explicit no-sleep instruction still proposed sleep commands. The ineffective one-sentence addition was
withdrawn instead of growing the prompt. Those probes executed no tools; cumulative upstream use reached 68. Thus
cross-batch final delivery is verified once, while efficient waiting with an execution Host remains unresolved. No new
waiting tool, scheduling layer or persistent coordination state was added. Detailed receipts, original failures and
candidate probe outputs remain linked from the real-validation report.
