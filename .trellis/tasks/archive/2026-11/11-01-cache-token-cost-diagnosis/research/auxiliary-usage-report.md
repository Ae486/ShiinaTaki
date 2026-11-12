# Auxiliary accounting delivery and real reasoning comparison

## Delivered behavior and actual runtime

Migration 065 adds a metadata-only `auxiliary_model_calls` ledger, independent of authoritative `run_usage`.
The resolved Utility model, detached image-description model and shared screenshot describer are now metered.
Each observed provider-model invocation, including an SDK retry, gets one row; existing Run-owned invocations are
suppressed through immutable AsyncLocalStorage ownership. Zero-call tasks create no rows. Optional accounting failures
do not alter provider results/errors or cause model replay. Missing counters remain null, and reasoning is never added
twice to output. Boot explicitly marks unfinished observations interrupted without inventing completion time.

The operator-only `observability.auxiliaryUsage` endpoint provides bounded chronological pages, full-filter totals,
known-count denominators and paired input/cache-read ratios. `DISABLED` refuses this optional query while recording
continues. This delivery adds no UI page, pricing engine, fake Run, automatic retry queue, or new dependency.
The ledger describes observed calls, not proof of provider billing or complete historical account usage.

The real database `C:/Users/55473/.takiagent/taki.db` is now at migration **065**. Five previously captured catch-up calls
were imported exactly and idempotently with original timestamps and usage. Unknown task identity stays null. These
rows total 107,987 input, 28,829 output and 20,201 reasoning tokens; the 288 existing Run usage records are unchanged.
Older unobserved auxiliary calls were not reconstructed. The six new experiment calls remain in an isolated ledger.

A consistent pre-065 backup is at `target/auxiliary-usage-20261101/before-065.db`, SHA-256
`093bf8a11a25899b3fa1f7bdce865eb2c12006cffe01f245bfaf876eb4da4a39`.
Rehearsal and actual import preserved all **150 pre-existing business tables / 21,046 rows** exactly, excluding the
migration journal by definition. Integrity and foreign-key checks passed. Repeating the import still produced five rows.

After migration, normal Core was started from this T4 worktree with the existing `.env.local`, PID **13956**, listening
on **127.0.0.1:8974**. Its already-configured monitor mode remains `FULL_LOCAL`; no production reasoning/provider defaults
changed. An authenticated real WebSocket query returned all five completed observations with the expected counters.
At 2026-11-01T12:25:39Z, actual state remained: **4,223 original Timeline rows**, tail/cursor **4232**, pending **0**,
summary **revision 6 / through 4182**, and the latest **50 original rows** available after the summary. Core is left running.
No commit, push, archive, historical Run replay or experimental memory/summary overwrite was performed.

## Fixed-input model experiment

The five earlier real thinking calls were reused. We issued only two nonthinking gates, two nonthinking extractions and
one nonthinking summary initially. All five provider prompt digests matched. Extractions used the same original gate
in both modes, so this does not measure downstream extraction after the newly expanded gate. Same prompt content can
still yield slightly different provider token totals because the mode changes provider framing.

The initial nonthinking summary ended at **8,192 output tokens / `length`**. The official
[Chat Completion contract](https://api-docs.deepseek.com/api/create-chat-completion.md), read 2026-11-01, specifies an
omitted output limit of 8K in nonthinking versus 64K in thinking/high. One additional identical-prompt control explicitly
allowed 65,536 output tokens. It finished with `stop` and 2,311 output tokens. This is a second stochastic response;
raising the ceiling does not establish that it caused the shorter answer.

| Sample | Input tokens | Cache-read tokens | Output tokens | Estimated CNY at returned cache usage | Estimated CNY with all input uncached |
| --- | ---: | ---: | ---: | ---: | ---: |
| Earlier thinking baseline, five calls | 107,987 | 896 | 28,829 | 0.22242492 | 0.223303 |
| Initial nonthinking, five calls; summary truncated | 107,861 | 640 | 8,585 | 0.14157380 | 0.142201 |
| Nonthinking using the completed summary control | 107,861 | 83,968 | 2,704 | 0.03638836 | 0.118677 |

The completed control benefited from a warm cache: 83,328 of its 83,578 input tokens were cached. The comparable
full-cold estimate falls **46.85%**, but this is **not an accepted quality-preserving saving**. Do not attribute the much
larger apparent actual-price difference to reasoning alone. Observed latency also reflects cache and single-sample noise.

All **six new paid calls** used 191,439 input and 10,896 output tokens; public Sunday off-peak CNY rates imply
**CNY 0.15273436**, about **CNY 0.15**. These are estimates from returned usage and the
[published tariff](https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md), not measured invoice deductions.
The nonthinking raw responses omit reasoning counters: the ledger correctly records null even though the SDK synthesizes
zero. The explicit request mode and returned text are separate evidence; absent usage is not silently promoted to zero.

## Quality decision and next work

**Keep production thinking defaults unchanged.** The [independent source-grounded quality review](reasoning-quality-review.md)
found material preference omissions, source attribution errors and consequential layer/retention changes in nonthinking
extraction. The completed short summary loses still-live commitments and hard constraints and reverses several sources.
The production structural check rejects the truncated summary but accepts the short control; structural acceptance does
not prove semantic preservation. Neither experiment summary was committed to the real database.

The thinking baseline is not a gold standard: the review also found scope/layer concerns and temporal/causal inaccuracies.
The current summary transcript omits original per-row timestamps, despite asking for absolute dates. Both extraction
prompts list layer names without the existing semantic glosses. These are focused follow-up candidates, not justification
for adding a general validator/retry framework. A separate successful retain receipt prevents treating an automatic
extraction omission as proof that live memory lost the same fact.

Next, observe normal interactions with the now-running runtime, separating foreground Run costs from auxiliary work.
Compare cost per completed interaction, uncached input, output/reasoning, repeated tool work, and first-call versus
continuation cache rates. Normal-chat cache improvement has **not** been measured by this background experiment.
Before changing reasoning defaults, use the concrete missed commitments/preferences and layer/date cases as acceptance
inputs. Gate-only reduction is a candidate, but two keep cases, no skip cases and no expanded-gate downstream run are
insufficient for a production switch. Preserve the current simple pipeline while evaluating those narrow fixes.

## Verification and reproduction

- Independent [implementation review](auxiliary-final-review.md): no confirmed defects.
- Workspace typecheck and Rust Clippy passed. Root lint found only the pre-existing overlong copied source at
  `artifacts/runtime-inbox-preimages-20261025/packages/shared/src/index.ts`; lint excluding `artifacts/**` passed without
  changing lint rules. The final three test-only expectation edits also passed targeted lint.
- Workspace test coverage: **6,456 passed / 6 skipped**, after targeted retests corrected two migration-tail expectations
  for version 065 and one existing truthfulness-phrase expectation (`personally ran a tool`). The initial broad run had
  those three failures; their complete affected files then passed (23 + 7 tests). No production behavior or tested
  truthfulness requirement was weakened. The broad passing set was not needlessly rerun. `e2e` has no `test` script;
  the separate generic E2E suite was not run. Real Core/WS acceptance is recorded below.
- Isolated actual Core boot/WS smoke passed, including restart interruption classification with null finish time and
  clean shutdown. Actual-data boot and authenticated query passed after the real migration.
- Experiment rows survived closing/reopening their isolated SQLite database; ordinary business data was not used as
  an experiment sink. Quality evidence is an automated/independent review, not owner acceptance.

Private evidence root: `target/auxiliary-usage-20261101/` (backups, preservation checks, logs, live state and `reasoning/`).
Sanitized aggregates: [reasoning-comparison-metrics.json](reasoning-comparison-metrics.json).
Drivers under this research directory:

```powershell
node --env-file-if-exists=.env.local .trellis/tasks/archive/2026-11/11-01-cache-token-cost-diagnosis/research/compare-reasoning.mjs prepare
# run and summary-control are explicit paid phases and refuse already-started ledger cardinality.
node .trellis/tasks/archive/2026-11/11-01-cache-token-cost-diagnosis/research/query-auxiliary-live.mjs
```

`import-auxiliary-ledger.mjs <database> <report>` is an explicit migration/import operation, not a read-only query.
`smoke-auxiliary-core.mjs` uses a disposable database and dummy model endpoint. Logs/PID for the normal running Core are
`core-live.stdout.log`, `core-live.stderr.log`, `core-live.pid`; its startup command uses the worktree's existing env file
and `packages/core/src/main.ts`. Future code changes require restarting that process to load them.
