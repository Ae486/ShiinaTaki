# Tidy repair: final independent review

Date: 2026-11-01. Checkout: `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`, base HEAD `9326955` plus the current tidy repair.

## Verdict

No confirmed blocking defect was found in the reviewed repair. The implementation
matches `tidy-repair-design.md`: it repairs the demonstrated canonical recovery
failure while preserving unsuccessful work as an error with actual committed
counts. It does not weaken revision/authority checks or introduce a persistence
migration, retry framework, automatic replay, or model-quality reduction.

This verdict covers source review and the evidence below. It is not a claim that
the original cache/cost investigation is complete, that full repository gates
have passed, or that the owner has accepted the real desktop behavior.

## Reviewed behavior

| Requirement | Verified implementation and evidence |
| --- | --- |
| Exact correction only | `canonical-local-tidy.ts:259` hashes verb, admitted epoch/Bank/memory identity and the full semantic payload; only reference revision is omitted. `target()` still admits only captured or own-returned references. Tests cover different target, verb, disclosure and every replacement field, plus object-order stability and copied identities. |
| Failures remain truthful | `canonical-local-tidy.ts:228` clears only `revision:<action>` after fresh success. Unknown/internal, authority, malformed and request-ID conflicts use persistent fatal keys. SDK input/unknown-tool failures are separately captured by `tidy-pass.ts:196` and cannot disappear through unrelated success. |
| Receipt and effect accounting | Cached receipt return precedes action clearing and effect counting (`canonical-local-tidy.ts:236`). Canonical counts come from the captured review, including when a later model step fails. `referenceResult()` propagates `outcome === applied`; unchanged lifecycle results do not count as new edits. The supersede policy-write path always commits a revision in the existing repository, so its returned applied flag does not currently omit the earlier copy/text effects. |
| Whole-pass completion | `reviewOutcome()` requires finish, current authority and no unresolved issues. `tidy-pass.ts:147-163` also requires settled execution and no SDK failure before advancing the watermark or recording the completed tidy event. Canonical text-only, capped and stopped-slot runs stay incomplete. |
| Legacy/Hindsight compatibility | Canonical completion checks are gated on the optional review outcome. Existing Legacy accepted row-error and bounded-cap semantics remain; its prior success tests are unchanged. The Hindsight curator/adapter code is unchanged; failed adapter results receive generic typed failure detail when they have no precise diagnostic producer. |
| Compatible and bounded protocol | The success schema remains `clean | ran`. `memory-tidy.ts` uses existing JSON-RPC internal-error envelopes with strict separate details. `memory-tidy-diagnostics-schema.ts:18` limits issues to 20, preserves the total, and enforces partial iff committed edits are positive. No raw arguments or memory identities enter this projection. |
| Current client and optional reads | The controller uses a client/epoch guard and retains the pending lock across replacement (`memory-tidy-controller.ts:34-75`). It clears earlier results before another attempt, rejects retired outcomes, performs no automatic replay and keeps refresh errors separate from known mutation outcomes. The real Operations read coordinator also publishes ordinary read failures through its existing per-resource state. |
| Safe diagnostics | Tool and pass logs use closed names/codes and guarded logger calls. Unknown model/SDK errors are not printed as raw text. Logger exceptions do not change committed work or trigger another model call. |

Existing canonical tests for hidden evidence, uncaptured revisions, wrong scope,
user-owned blocks and replacement transaction rollback remain present. The model
schema now offers only background-owned blocks while retaining the user card as
read-only report evidence; repository writer policy remains the final guard.

The installed AI SDK aggregates `toolResults` across steps. The earlier
last-step-only counting hypothesis is not a finding and is not a reason for
further changes.

## Integration evidence inspected

Inspected `target/tidy-repair-20261101/ui-integration.mjs`, its JSON/log output,
and all three rendered screenshots. The fixture uses isolated copies of real
SQLite data, production canonical runtime/TidyPass/RPC registry/WS path, the
production browser WsClient, React hook and tidy card, and a scripted model.
It reports zero paid calls and no live-data writes.

| Scenario | Observed result | Watermark |
| --- | --- | --- |
| Successful exact correction | `ran`, 2 edits, 4 steps; UI reports the same | Advances |
| Unresolved conflict after committed work | `partial`, 1 edit, 3 steps; safe version-conflict detail | Unchanged |
| Failed operation with no committed work | `failed`, 0 edits, 2 steps; safe invalid-operation detail | Unchanged |

Screenshots show distinct success, amber partial and red failure presentations,
legible action/reason/count rows, and no raw tool/error identifiers. These are
styled production-card renders in the integration harness, not a full Tauri
window or owner acceptance. The inspected RPC test log records 5 passing tests;
the parent owns full-gate execution, so this reviewer did not rerun broad tests.

Regression bodies also cover cached replay, unchanged invalidation, unknown
exceptions, authority loss around finish, malformed model tools, logger failure,
client replacement, timeout uncertainty, rapid clicks and failed optional reads.
Test-body inspection is distinguished from executing those tests here.

## Nonblocking observation

An execution failure or unfinished run with no captured tool issue can display
`Unresolved issues: 0` in the Chinese card. The headline and reason still identify
the failed/incomplete pass correctly. Hiding a zero tool-issue count, or naming
that count specifically as operation issues, would make the explanation clearer.
This is wording, not a recovery, persistence or protocol blocker.

## Remaining parent-owned work

- Complete the required final gates and record the intentional canonical-only
  explicit-finish semantics in the runtime spec.
- Observe the authorized live manual tidy path without claiming scripted-model
  or rendered-card checks as real-model quality or owner UI acceptance.
- Resume the original old/new real-conversation usage analysis. Separate normal
  foreground work from tidy/catch-up/experiments and preserve unknown usage fields;
  this repair alone proves neither cost savings nor unchanged real-model quality.
- Preserve the historical limitation: the real November 1 run's first tool error
  was not retained. The isolated reproduction proves a reachable defect, not that
  precise historical error.

Only this review document was written by the reviewer. No production code,
database, process, task pointer or Git history was changed; no model calls or
broad tests were run.
