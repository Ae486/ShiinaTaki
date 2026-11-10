# Remaining delegation acceptance — November 4 follow-up

> 2026-11-10 freeze addendum: the remaining summary repair and tests are preserved
> as a stage checkpoint. Fresh Core checks passed 70 tests; scripted upgrade/relay
> E2E passed six tests; Core/E2E typechecks and scoped lint passed. The upgrade seed
> now actually builds through 068 before exercising current migrations. This does
> not close the historical real-provider long-work or owner UI acceptance below.
> Current execution authority is [the freeze handoff](../../../../docs/T4-FREEZE-HANDOFF.md).

Scope: the owner's post-`cd3cd91` authorization to complete long-work and eight-agent validation and
prepare UI acceptance. Workspace: `H:/TakiAgent-worktrees/t4`. This record does not authorize another
commit, push, archive, real-user data change or deployment.

## Current results

| Gate | Current result | Evidence |
| --- | --- | --- |
| Candidate capacity and same-coverage repair | 50 focused tests, Core typecheck and scoped lint passed; independent review found no proven blocker | `artifacts/delegation-completion-20261104/implementation/checks.md` |
| FIFO test transport, upstream concurrency one | Five local tests passed; E2E typecheck/lint passed; both real scenarios observed peak one | `transport.json` in each scenario |
| Original failed-snapshot replay | Pre-repair overflow reproduced; repaired source selects same-coverage rewrite; DB/WAL unchanged | `target/delegation-completion-20261104/diagnosis/replay.json`, `replay-after.json` |
| Full long audit | Failed after 25 task steps, eight summaries and three check-ins; no validated final | `real-long/goals-long-audit-checkin-tKNGU6` |
| Eight-agent full batch | Passed: eight validated reports, eight exactly-once actions and correct public synthesis | `real-eight/goals-full-eight-inbox-pE7EfN` |
| Corrected full long audit | Resource-interrupted after 18 steps, ten summaries and two check-ins; one actual size correction | `real-long-corrected/goals-long-audit-checkin-wyUNuq` |
| Final workspace/native gates | Waiting for memory headroom | No new final acceptance claimed |
| Human UI acceptance | Pending owner observation | Automated checks cannot approve this gate |

Scenario paths above are relative to `artifacts/delegation-completion-20261104/`. The first long run
and eight-agent run retain source parity and successful normal cleanup. The corrected long run was
stopped explicitly under critical system memory pressure; its normal teardown did not complete and
it is neither a product failure nor an acceptance pass. No scenario reached its global deadline.

## Long-work failure and bounded diagnosis

The first repair prevents committing candidates that cannot fit the protected latest round and allows
rewriting an already persisted oversized summary. It does not guarantee every generated candidate will
pass quality, reduction and capacity guards. The real run ended with generic summary failures; the
rejected candidate text was not retained. Three earlier provider failures are separate recorded facts.

One exact request-47 replay used the same synthetic request bytes and route. The fresh output had finish
`stop`, 7,936 estimated summary tokens and passed both quality and the exact original captured boundary
(`sourceDigest=51c38e...`). The read-only replay did not commit it and left DB/WAL hashes unchanged.
This is a new model sample, not recovery of the historical rejected response or end-to-end completion.
Consequently, non-shrinking is not established as the historical cause. The narrow next repair records
closed rejection reasons without arbitrary error/body text, schema changes or altered retry eligibility.

The diagnostic repair passed 57 focused tests and lint. A second exact request-47 sample then reproduced
the stricter size failure: 8,112 estimated tokens passed basic quality but exceeded the 8,100-token
retired model projection. Its exact-boundary replay returned `SUBAGENT_SUMMARY_NON_SHRINKING`. A third
sample added measured reduction feedback to the same original sources and produced 6,041 tokens;
all original guards passed. These samples establish a reachable failure class and a useful correction,
not the missing historical candidate's exact cause. Candidate files and input hashes are retained in
`summary-pilot-2/` and `summary-pilot-3/`, with read-only `replay-pilot-2.json` / `replay-pilot-3.json`.

The resulting reviewed extension permits the existing second generation for size-only rejection,
including both strict shrink checks and protected-envelope capacity. Final acceptance stays unchanged;
blank/truncated/forbidden output, provider failures and authority failures receive no additional call.
Both generations use the original sources and unchanged failure identity. The cost tradeoff is at most
one extra generation for a non-shrinking candidate that previously stopped immediately, while the
existing maximum of two calls per captured operation remains. Implementation passed 67 focused tests
and scoped lint. Core typecheck was not started because the checker memory guard observed 2.488 GiB
free against its 2.75 GiB threshold. A fresh full long run retained the original 24 files and all
assertions, but system free physical memory fell to 0.423 GiB. The coordinator stopped only its
verified Core PID and test descendants. It had completed 18 task steps, ten summaries and two
check-ins, with one actual size-feedback request; the final report was not reached. Retained files
`resource-interruption.json`, `resource-test-cleanup.json` and `resource-final-snapshot.json` record
the explicit stop and durable state. No unrelated application was terminated. Final acceptance must
resume after sufficient memory is available; this interrupted run must not be labelled passed.

## Eight-agent semantic review

All eight independent workers completed their original work. One actual primary request contained all
eight events. Seven were retained privately and the eighth proposed the combined public answer. Every
event had exactly one action. The public answer correctly identifies cases 1/3/5/7 as violating record
preservation, cases 2/4/6/8 as violating offline reads, and all eight as failing the combined requirements.
It preserves the external Mina-1 through Mina-8 source attribution. This is one successful sample, not
a general model-reliability estimate or causal proof of the interface's token savings.

## Resource and request accounting

`campaign.json` owns the 320-request ceiling. Current physical/conservative attempts: first long 48,
summary pilots three, eight-agent 12, interrupted corrected long 42, total 105. `observations.json`
summarizes integrated scenarios; the three `summary-pilot*/observation.json` files record the pilots.
HTTP attempts, completed model Effects,
reported token subtotals and provider billing are different quantities. Unreported usage remains unknown.

One test worker and 768 MiB Node heap per test/Core process were used. Physical upstream concurrency
was one. `resources.jsonl` records Core PID/RSS and system free memory; the heap setting is not an RSS
guarantee. No unrelated process was terminated.

Final lightweight checks passed: `git diff --check` and both Trellis context manifests. Independent
review verified all seven final source/spec hashes, the 67-test/lint logs, the pilot sources and the
eight-event request/action/publication chain. Latest Core typecheck, the final workspace suite and
refreshed native UI execution remain unrun after the last production delta. The owner was asked
whether to continue after memory is released or deliver this partial state; no answer is assumed.

The public answer names all eight external sources. Its existing structured publication sidecar
anchors the triggering eighth event; the complete eight-source lineage is in the actual inbox and
event chain. Do not claim that the publication sidecar itself enumerates all eight sources.

## Owner UI acceptance preparation

The existing isolated native entry is `node apps/desktop/test/s7-subagent-runtime-smoke.mjs`, with
`TAKI_E2E_EVIDENCE_DIR` selecting a fresh evidence root and `NODE_OPTIONS=--max-old-space-size=768`.
It uses production Core, authenticated WS, actual WebView2 and a local scripted model. It does not use
the user's application database or paid provider. Its screenshots and automated controls establish
native integration only; the owner must separately confirm visual and interaction acceptance.

Review the next refreshed native evidence for these original requirements:

1. Main Chat remains usable and surfaces child attention while the child page is hidden.
2. Each child has one readable continuous transcript; user, parent and System/check-in sources differ.
3. Stop and exact Continue/redirect behave clearly, with truthful cumulative usage and progress.
4. Draft text/selection and reading position survive refresh, navigation, paging and reconnect.
5. Accepted input with a lost acknowledgement resolves from canonical evidence without duplicate send.

The refreshed native result and screenshot paths will be added after execution. Human acceptance
remains pending even if every automated assertion passes. Native Hindsight, T4/main migration convergence,
retained-data cleanup and routed background approvals remain separately scoped work.
