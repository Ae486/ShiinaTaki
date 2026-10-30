# R2 independent controls and completion acceptance

Date: 2026-10-23. **R2 passed through production Core, authenticated WS and real SDK HTTP.** The final controlled case and the one bounded live case both passed. This is automated acceptance evidence; human acceptance remains pending. No production Runtime/Source code was changed by this slice.

## Scope and implementation

The actual worktree was verified as `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, HEAD `06a8090`. This child session had no native task pointer; it used the coordinator's explicit existing Runtime/acceptance assignment and left the stale global pointer unchanged. Existing dirty work was preserved.

- Added `e2e/src/agent-context-r2.e2e.test.ts` and `fixture/agent-context-r2.ts`: the same lifecycle exercise runs first with scripted HTTP responses, then behind explicit real-model opt-in.
- Added `fixture/agent-context-timing-relay.ts` and its three local HTTP regressions. The relay only holds/releases requests; successful request/response bytes remain unchanged. Hold, release, forward, HTTP status and abort facts are recorded separately in `transport.json`.
- Narrowly extended the existing `fixture/agent-context-scenario.ts` with optional test-owned `transport(baseUrl, evidenceDir)` and read-only `wsUrl`. The latter was requested by the coordinator for its separately owned actual-Home/native integration. Defaults preserve the existing R1/R3 transport. Cleanup independently attempts socket, Core, observer and timing-relay closure.
- Updated E2E indexes and the existing E2E specification with actual source-wrapper parsing, mandatory evidence-write failure handling and work-ID-based result matching. No observer/operator-driver, Core/Shared source, dependency, production RPC or persistent schema was changed.

The first request gate reads actual serialized Source/acquired-material `result.result` wrappers around Shared-validated delegation acknowledgements. It never edits them. Result assertions use exact work/Run identities rather than assuming history array order is chronology.

## Observable outcomes

| Required distinction | Actual evidence |
| --- | --- |
| Parent stop does not cascade | The actual primary delegates A and B. Both child HTTP requests and the primary's post-delegation request are held. Authenticated `chat.cancel` targets the returned primary `runId`; it becomes cancelled while both children keep their same running Run/control state. Only the original primary request closes at this step. |
| Exact independent child stop | Authenticated `subagent.stop` names A's child/work/control-version/Run. A becomes cancelled and `blocked_user`; B remains on its original running Run and held request. |
| Durable user latch | The subsequent real primary model actually calls `send_subagent_message(continue=true)` on the exact A target. The native tool response contains `SUBAGENT_USER_CONTINUE_REQUIRED`; A's SQLite latch/control version/input sequence, input count and execution count stay unchanged. |
| Explicit user continuation | Authenticated `subagent.continue` clears A's latch. The resumed actual request receives retained private context and the accepted continuation has a real model Effect receipt. A gets a new completed Run; its original Run stays cancelled. Both results retain `record_only` and neither admits a parent continuation. |
| Original stopped-request report | B completes after the original parent is cancelled. Its original `request_parent` policy admits a distinct parent Run. The parent explicitly chooses `reply`, retaining the original primary witness. Existing publication creates a separate no-model Run, one Delivery in `sent` state and one matching relationship Timeline report. |
| Inference and publication stay separate | A new work item reuses B with `request_parent`; its new parent result chooses `internal_result`. It remains inspectable, with `internal_only` publication and no additional Delivery or relationship speech. Exactly two B parent Run IDs exist across these two distinct completed work items. |

The live reused B report included a contradictory phrase referring to `reply` while also specifying `internal_result`. The real parent explicitly noticed that conflict, treated the child report as data, followed the current work direction and retained `internal_result`. The exact text is preserved in `live-summary.json` and the result/phase records. This bounded observation is not a universal model-quality claim.

## Trials, failures and checks

| Trial/check | Result and exact limit |
| --- | --- |
| `controlled-first.json` / `controlled-first/` | **Failed**, 94.80 seconds. The initial fixture incorrectly parsed a bare delegation acknowledgement, so the real Source wrapper prevented the primary hold from matching. The test failed before actual parent cancellation; it is not parent-stop acceptance. Four Core requests, two local scripted upstream requests, zero external model calls. Source unchanged, cleanup successful, no scenario deadline/budget/capture failure. Retained failure was not overwritten. |
| `relay-regressions.json` / `relay-regressions/` | **3 passed**, zero external calls: byte-exact successful request/response forwarding and held cancellation; real filesystem write failure rejects final cleanup while closing the listener; initial evidence failure occurs before `listen`. The coordinator independently challenged the missing failure latch before these corrections. |
| `controlled-repaired.json` / `controlled-repaired/` | **Passed**, 7.69 seconds. Twelve Core requests: ten local scripted HTTP 200 forwards and two requests cancelled while held. All R2 phases reached, source unchanged, relay closed with zero active operations and successful Core/socket cleanup. |
| `live-first.json` / `live-first/r2-live-PguQHq/` | **Passed**, 30.13 seconds, one live attempt. Thirteen Core requests under cap 16: eleven actual upstream HTTP 200 forwards and two requests cancelled before forwarding. Source unchanged; no deadline, request-evidence or cleanup failure. No automatic retry. |
| E2E typecheck | `pnpm --filter @taki/e2e typecheck`: exit 0 after the final TS edits. |
| Scoped ESLint | Five owned TS fixture/test paths including the existing scenario: exit 0 after the final TS edits. |
| Whitespace/encoding | Scoped tracked diff check and owned-file UTF-8/no-BOM/trailing-whitespace verification: see `files-manifest.json`. New/untracked files are included in the owned-file check. |

The coordinator arranged brief Core/Shared/E2E freezes for both production-process trials. The first freeze was released before repair. The second covered the passing controlled trial and separately authorized live trial; it was released immediately after the live run exited. No R1/R3 rerun or full-workspace gate was started by this worker.

Environment: Node `v24.18.0`, Vitest `4.1.10`; each scenario has six maximum SDK steps per execution and a 240,000 ms total fixture deadline. Complete Core/Shared/E2E source hashes and package/lock bytes are in each `baseline.json` and `result.json`. The live lock SHA-256 is `2f66fc75926ca324f353dea4b01eb9fc81822202f8e7044721b87091a58b3391`. Current owned-path hashes are in `files-manifest.json`.

## Live provider and usage facts

Requested model: `deepseek-v4-flash`. All eleven reported usage rows identify `deepseek-flash`; no alias equivalence is inferred. The other two model Effect usage rows are explicitly `unknown` and have null counters; the transparent relay separately proves those two HTTP requests were cancelled before any upstream forwarding.

| Reported measure | Value |
| --- | ---: |
| Successful physical upstream requests | 11 |
| Reported input tokens | 157,409 |
| Reported output tokens | 3,331 |
| Reported total tokens | 160,740 |
| Included cache-read tokens | 123,136 |
| Included reasoning tokens | 1,315 |

Cache-read and reasoning values are subsets, not additional totals. These are reported usage observations, not billing. Candidate Effects saved beside requests remain concurrent observations and are not asserted as exact request attribution. `live-summary.json` is derived from retained Run usage/terminal reports and transport evidence. Request body hashes match the observer capture and relay forwarding records.

Together with the coordinator's prior R1/original-R3/repaired-R3 subtotal, this adds **11** physical real-provider requests and **160,740** reported tokens. The resulting combined subtotal is **26** physical real-provider requests and **382,059** reported tokens; the earlier failed R3 remains included and separately labelled. This does not include other agents' Source campaigns.

## Reproduction

Commands ran from the T4 worktree, with absolute reporter/evidence paths because `pnpm --filter` changes cwd. The local controlled command never enabled real-model opt-in:

```powershell
$env:TAKI_E2E_EVIDENCE_DIR='H:/TakiAgent-worktrees/t4/.trellis/tasks/10-21-agent-context-acceptance/research/r2-20261023/controlled-repaired'
pnpm --filter @taki/e2e exec vitest run src/agent-context-r2.e2e.test.ts -t 'controlled HTTP timing' --maxWorkers=1 --reporter=default --reporter=json --outputFile=H:/TakiAgent-worktrees/t4/.trellis/tasks/10-21-agent-context-acceptance/research/r2-20261023/controlled-repaired.json

$env:TAKI_E2E_REAL_AGENT_CONTEXT='1'
$env:TAKI_E2E_REAL_ENV_FILE='H:/TakiAgent/.env.local'
$env:TAKI_E2E_EVIDENCE_DIR='H:/TakiAgent-worktrees/t4/.trellis/tasks/10-21-agent-context-acceptance/research/r2-20261023/live-first'
pnpm --filter @taki/e2e exec vitest run src/agent-context-r2.e2e.test.ts -t 'with real inference' --maxWorkers=1 --reporter=default --reporter=json --outputFile=H:/TakiAgent-worktrees/t4/.trellis/tasks/10-21-agent-context-acceptance/research/r2-20261023/live-first.json
```

Reproduction should use a fresh evidence directory and requires current owner authorization/source coordination for another live run. Credentials were read by the existing loader, never copied into evidence or displayed.

## Limits, cleanup and handoff

- The transparent gates establish deterministic relative timing, not natural provider latency or reliability under arbitrary races. Only the forwarded eleven requests are real-model observations.
- Durable SQLite latch and model refusal were checked without restarting this Core. Hard process loss, unknown-effect recovery and parent-origin interruption semantics retain their existing separately attributed Runtime test evidence; this R2 does not claim new live coverage for them.
- `sent` means the subscribed authenticated fixture accepted transport. No human perceived speech, TTS, rendered child UI or owner acceptance is inferred. The coordinator's actual-Home/native evidence is separate.
- Test-owned canonical Local state was isolated under the retained evidence directory; Hindsight was disabled. No real-user Memory mutation, native Hindsight extraction, Source A1-A3 or Co-Watching playback acceptance is claimed.
- Both observers/relays and Core/socket closed successfully. The final process query found no matching R2 test or `pattern-process-entry` node process. Evidence directories and their isolated databases are intentionally retained; no user data was deleted or migrated.
- No production defect was confirmed by this slice. No commit, push, reset, archive, main integration, release, full-workspace test campaign or human AC checkmark was performed. The coordinator owns final integration, complete required gates, independent review and remaining human gates.

R2 source ownership is released to the coordinator after this report. No required R2 implementation or live execution remains; this worker stops before human acceptance.
