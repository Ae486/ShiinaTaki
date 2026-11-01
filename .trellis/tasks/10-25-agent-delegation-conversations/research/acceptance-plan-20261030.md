# Research: S7a and S8-S12 integrated acceptance preparation

- Query: Prepare exact deterministic, production-Core/WebView2 and goal-only real-model acceptance commands while Core contracts are implemented.
- Scope: internal, with installed dependency/version evidence; no external HTTP or model requests.
- Date: 2026-10-30
- Ownership: this research file only. Other agents own production and test changes. No Git operation, task creation, archive, real-user mutation or suite run was performed.

## Findings

### Authority and current environment

The coordinator explicitly assigned `.trellis/tasks/10-25-agent-delegation-conversations`, whose `task.json` is `in_progress` and records `task/t4-skills-mcp-productization`. Actual PowerShell location was `H:/TakiAgent-worktrees/t4`. The legacy `.trellis/.current-task` still points to `09-03-avatar-presentation-lab`; it must not override the coordinator's active-session assignment. This research role prohibits Git operations, so actual branch/worktree-list verification remains the coordinator's gate.

The owner approved S7a/S8-S12, configurable defaults N=50/K=3, and later real-model/E2E use. This preparation did not start paid requests. Original PRD acceptance, especially foreground/private isolation, immutable receipts and explicit user Stop, remains authoritative.

Observed installed versions, read directly from the worktree/package installations:

| Component | Installed version / state |
| --- | --- |
| Node | v24.18.0 |
| pnpm | 10.22.0; matches root `packageManager` |
| `ai` | 7.0.148 |
| `@ai-sdk/openai-compatible` | 3.0.75 |
| `@ai-sdk/mcp` | 2.0.81 |
| Vitest | 4.1.10 |
| cargo / rustc | cargo 1.97.0 / rustc 1.97.0 |
| WebView2 directory | `156.0.4314.50` under the installed EdgeWebView Application directory; actual launch not tested |
| Native fixture | `apps/desktop/src-tauri/target/debug/examples/c2-presence-fixture.exe` exists, 19,401,216 bytes; existence does not prove source parity |
| `CARGO_TARGET_DIR` | absent in the research process; default worktree target used |

Safe allow-listed configuration inspection confirmed main model `deepseek-v4-flash`, endpoint host `api.deepseek.com`, and a nonempty main API key. VLM is separately configured; no Utility key/model was present. No model request or provider connectivity check was made. The installed SDK versions are current local evidence; a comment in `provider-factory.ts` mentioning an older adapter version is historical.

### Files found and executable owners

| Path | Purpose |
| --- | --- |
| `prd.md`, `design.md`, `implement.md` in this task | Original requirements, delivered/planned contracts, S7a/S8-S12 order and acceptance matrix |
| `.trellis/spec/backend/e2e-harness.md` | Isolation, real-provider capture, no-content diagnostics, teardown and evidence distinctions |
| `.trellis/spec/backend/private-agent-inbox.md` | Durable delivery/handling, private activity and foreground routing safety |
| `.trellis/spec/backend/private-worker-context.md` | Same-work context, segmentation, receipts, raw paging and required retention checks |
| `.trellis/spec/backend/quality-guidelines.md` | Mandatory checks and actual Node strip-only boot gate |
| `package.json`, `packages/core/package.json`, `apps/desktop/package.json`, `e2e/package.json` | Exact pnpm scripts, engine constraints and locked direct SDK versions |
| `e2e/vitest.config.ts` | Serial process-heavy files, 120-second default test timeout and 60-second hook timeout |
| `e2e/src/fixture/paths.ts` | Provider credentials from explicit env-file override or root `.env.local`; dummy provider; headless binary location |
| `e2e/src/fixture/agent-context-scenario.ts` | Existing production-Core scenario, actual request evidence, source hashes, isolated Canonical Local database and finite request/session budgets |
| `e2e/src/fixture/initiative-process.ts` | Production entry with test-only IPC supervision, authenticated WS and bounded process cleanup |
| `e2e/src/fixture/agent-context-inbox.ts` | Parse actual delivered events/tool outputs and join durable action/model receipts |
| `e2e/src/agent-context-runtime.e2e.test.ts` | Deterministic selected context, addressed input, Memory mutation exclusion, record-only/request-parent behavior |
| `e2e/src/agent-context-restart.e2e.test.ts` | Restart actual Core using the same isolated database; retain stop/input/unknown facts without automatic model replay |
| `e2e/src/agent-context-real.e2e.test.ts` | Existing paid opt-in suite; current R1 prompt dictates tool names/arguments, so not S12 natural-use evidence |
| `e2e/src/agent-context-r2.e2e.test.ts` | Real request timing through transparent relay and actual cancel/Stop/Continue APIs |
| `apps/desktop/test/s7-subagent-runtime-smoke.mjs` | Actual Home/WsClient/Core/SQLite/SDK HTTP with scripted provider and WebView2 |
| `apps/desktop/test/s7-subagent-native-smoke.mjs` | Actual UI with scripted RPC state; useful UI failure cases, but no actual Core lifecycle |
| `apps/desktop/test/s7-subagent-native-server.mjs` | Scripted private-conversation RPC fixture for the UI-only native smoke |
| `apps/desktop/test/c2-native-driver.mjs` | Existing CDP connection, evaluated interaction and wait helpers |
| `apps/desktop/src-tauri/examples/c2-presence-fixture.rs` | Debug-only Home/Pet shell; temporary profile, loopback assets/WS and scoped fixture permissions |
| `packages/core/src/config/provider-config.ts`, `provider-factory.ts` | Main `TAKI_PROVIDER_*` route and `taki-provider` OpenAI-compatible language model |
| `packages/core/src/config/agent-config.ts`, `context-config.ts` | Existing main-turn cap, context tuning and usage opt-in; do not replace these with the child check-in counter |

### Code patterns and critical adaptation points

- `agent-context-scenario.ts:29` gates paid use with `TAKI_E2E_REAL_AGENT_CONTEXT=1` plus provider configuration. `withScriptedAgentContextScenario` only accepts loopback HTTP and supplies synthetic credentials. `paths.ts` honors `TAKI_E2E_REAL_ENV_FILE`, allowing an empty fixture file to suppress older key-only L2 suites despite a populated root `.env.local`.
- `agent-context-scenario.ts` currently fixes main `TAKI_MAX_STEPS=6`, includes streaming usage, disables initiative and uses Canonical Local synthetic data. Keep the main cap unchanged; add explicit scenario options for child check-in settings, context pressure and a finite longer session deadline. Record effective values, not just requested ones. Existing 240-second scenario deadline is not sufficient evidence for an arbitrary 50-step real child.
- `agent-context-scenario.ts` already captures exact synthetic outgoing request bodies before forwarding, alongside concurrent Effect/execution observations. These observations are not an invented one-to-one physical-request/Effect correlation. Preserve request numbering, `upstreamAttempted`, refusal reasons, admitted Effects and completed usage as distinct counts.
- `agent-context-inbox.ts:16-26` derives delivered identities from the actual request. Its helpers unwrap actual tool output envelopes. Update only fields changed by S9; derive work/event identity from actual output. `handledEvents` and `assertHandledEvent` at `:68-92` must retain digest/Effect joins in internal SQLite evidence even when S9 removes those fields from model-visible output.
- `s7-subagent-runtime-smoke.mjs:56-62,175-185` currently produces 55 progress steps plus a final and asserts exactly 56 requests in one Run. Under N=50 this intentionally reaches a check-in. Replace this with (a) a below-N multi-segment regression crossing old caps, and (b) a 56-step work that visibly pauses at N, continues through the actual Home action and completes the same `workInputId`. Preserve the old cancelled Run, distinct continuation Run identities where the finalized contract requires them, and same-work history. Do not simply raise N to hide the new boundary.
- `s7-subagent-runtime-smoke.mjs:74-75` assumes every non-worker request exposes `delegate_subagent`. Route actual inbox requests first and assert it is absent for idle consumers after S8, while retained/answer/stop actions remain available. Foreground tool assertions remain separate.
- `s7-subagent-runtime-smoke.mjs:259-277` hashes frontend sources, fixture entry/driver, Rust manifest/lock/example and actual executable. Core/Shared/E2E hashes are independently captured by the scenario fixture. Add build/config inputs missing from those manifests and record build command/toolchain; an unchanged prebuilt executable can still be stale relative to Rust inputs.
- `s7-subagent-runtime-smoke.mjs:321-378` loads production Home assets into real WebView2, redirects the normal WS constructor to a fixture loopback relay and scopes profiles under a temporary directory. This establishes the actual frontend/Core path; it does not establish packaged app startup, production Shell keyring/Host governance or human acceptance.
- `s7-subagent-native-smoke.mjs:113-117` writes evidence before sequential cleanup. A failed write can prevent later closes; bootstrap resources are also allocated before its `try`. The minimum native harness hardening is to put all acquisitions inside an owned lifetime, close all independent resources with `allSettled`, fail previously passing runs if required evidence/cleanup fails, and record actual exit/process closure. The runtime smoke already has stronger independent close behavior and should be the primary production-Core gate.
- Runtime native temp assets/WebView profile are retained, not removed by the current runtime smoke; scenario data is retained in evidence. This is not deterministic temp-directory deletion. Prefer moving intentional evidence/profile retention into the explicit evidence root or otherwise recording retained paths, then remove only validated fixture-owned disposable directories after all processes close. No real-user path is eligible.

### Minimal harness changes for the integration owner

1. Extend the existing scenario fixture, not production APIs: optional effective child-policy settings, context/compaction tuning, finite `sessionDeadlineMs`, and requested-versus-effective configuration evidence. Do not invent the S10 config key names before the Core owner freezes them.
2. Extend `databaseEvidence` with frozen S8-S10 tables/columns: durable per-work counter/check-in wait/continuation count, pending questions, reconciliation states, events/deliveries/actions/claims/speech and per-child `run_usage`. Existing table snapshots omit several private inbox/summary owners; explicit allow-listed SQL is enough.
3. Add actual request assertions for S9 compact output and recovery: no model-visible digests/internal receipts, bounded page with all body offsets traversable, ordinary follow-up after the child begins, stale protected actions refused with an actionable refreshed target. Keep internal receipt/digest assertions.
4. Add focused deterministic scenarios for N-1 completion, completion in step N, unfinished step N, rollover across N, restart, trusted continue/redirect reset, K unattended continuations and user Stop. Default N=50/K=3 must be exercised at least deterministically; lower explicit settings may shorten separate race/native/real scenarios but cannot replace default coverage.
5. Adapt the existing native runtime smoke to check actual visible needs-input/reconciliation/check-in/usage, preserve current drafts/paging/reconnect/Stop cases, and complete the long child through actual UI continuation. Reuse Shared schemas and current controls rather than fixture-internal mutations.
6. Add a separate opt-in goal-only real campaign file, e.g. `e2e/src/agent-delegation-goals-real.e2e.test.ts`, using `withAgentContextScenario`. This filename is proposed and does not exist in the research snapshot. Retain the older explicit-tool suites as historical/directed regressions; do not relabel them autonomous evidence.

### Scenario matrix and acceptance signals

| Scenario | Deterministic/native requirement | Goal-only real-model observation |
| --- | --- | --- |
| Natural delegation | Actual model tool/public WS creates linked work; foreground remains responsive | Ask for independently owned research subtasks and a combined answer; observe actual delegation calls without prescribing tool names/arguments |
| Follow-up | Message accepted while child running; complete pending batch at captured watermark; ordinary model message resolves current work | Give a natural correction referring to the work by its role; verify it reaches that same child and influences a later real result |
| Needs-input | Child releases lane; visible user question; exact pending question reply; stale reply refuses | Give a decision task with one essential missing requirement and tell the agent to obtain it; answer the actual clarification naturally |
| Full 8-event inbox | Eight actual child-produced eligible events, bounded FIFO advancement, each disposition exactly once; timer/fresh-opportunity race | Request eight separate small investigations. A test-only timing relay may coordinate delivery, but may not fabricate answers/events or edit successful provider output. Retain proof the actual request contained eight events; fewer events is incomplete batch coverage |
| Long work / compaction / check-in | Real ChatAgent SDK segmentation, durable summary, raw paging, source/negation/input truth, N boundary, same work continuation and K escalation | Give a multi-pass consistency/audit goal over synthetic material; observe actual multiple segments and check-in. If it completes early or never compacts, report that limitation and rerun only a purposeful revised case |
| Config / usage | Defaults, operator config.set, actual loaded values, persistence/restart and usage summed across actual child Runs/segments; unknown is not zero | Capture requested model and actual attempt model/usage. No guessed cost/billing from request counts; provider omissions remain unknown |
| Foreground/private | Public text plus ordinary public tool plus private inbox action in one SDK step; paired partitions, next SDK request, Timeline/activity, raw receipt, Local/Hindsight source exclusions and restart replay | During child work submit a normal foreground message; inspect real outgoing context and durable private/public evidence; goal campaign supplements deterministic failure matrices |
| Unattended / stuck state | No delegate tool in idle requests; answer/retain/stop remain; needs-input and reconciliation reach Home/user; bounded pre-intent retry and no post-intent unsafe replay | Observe real request tool menus and spontaneous inbox dispositions; a model declining to act is not silently recorded as handled |
| User Stop / private read-only | Stop suppresses automatic parent reporting across races/restart; only trusted user Continue clears latch; record-only and child Memory write exclusions persist | Natural stop/redirect, plus actual UI/RPC trusted controls; directed timing suites remain valid for precisely controlled cancellation |

Suggested synthetic goal prompts contain no tool names, schema keys, IDs or tool argument instructions. Examples:

- Natural delegation: "Please assign independent reviewers to compare the compatibility and migration implications of these synthetic options, continue helping me while they work, and combine their conclusions when available."
- Follow-up: "The compatibility review should preserve offline support. Send that correction to the reviewer already working on it."
- Needs-input: "Have a reviewer select an option using the user's hard requirements. One requirement is missing; obtain clarification before deciding."
- Full batch: "Ask eight independent reviewers to check the eight supplied cases separately, then review every returned finding and summarize any unresolved decisions."
- Long work: "Have a reviewer audit this synthetic specification in multiple passes, preserve corrections and source distinctions, report progress when a check-in is needed, and continue the same review after confirmation."

Final prompts and materials must make these objectives meaningful. Reaching a scripted number of model calls is not itself proof that a real model can do useful long work.

### Executable planned command sequence

These commands are for the coordinator after S8-S10 source and tests freeze. They were not executed in this research turn. Run from the T4 root, capture stdout/stderr and exit status per gate, and stop on failed required gates. Preserve failed campaign directories separately. Restore task-specific environment variables afterward.

First create an explicit empty real-env fixture and remove inherited paid opt-ins in the verification process. This prevents `realProviderEnv()` from finding the root credentials during ordinary deterministic E2E. Do not load root `.env.local` for deterministic gates.

```powershell
Set-Location -LiteralPath 'H:/TakiAgent-worktrees/t4'
$taskEvidenceRoot = Join-Path (Get-Location).Path '.trellis/tasks/10-25-agent-delegation-conversations/research/final-acceptance-20261030'
New-Item -ItemType Directory -Force -Path $taskEvidenceRoot | Out-Null
$taskNoProviderFile = Join-Path $taskEvidenceRoot 'no-real-provider.env'
[System.IO.File]::WriteAllText($taskNoProviderFile, '', [System.Text.UTF8Encoding]::new($false))
Get-ChildItem Env: | Where-Object Name -Like 'TAKI_E2E_REAL_*' | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
$env:TAKI_E2E_REAL_ENV_FILE = $taskNoProviderFile
$env:TAKI_E2E_EVIDENCE_DIR = $taskEvidenceRoot
python .trellis/scripts/task.py validate 10-25-agent-delegation-conversations
pnpm -r typecheck
pnpm lint
pnpm -r test
pnpm --filter @taki/core exec vitest run src/agents/chat-agent-worker-context.test.ts src/agents/chat-agent-worker-retention.test.ts --pool=forks --execArgv=--expose-gc
pnpm --filter @taki/e2e test:e2e
pnpm --filter @taki/desktop build
```

The Core/SDK retention command is explicitly required by `private-worker-context.md:143`; ordinary tests without exposed GC are not sufficient evidence for its retained-reference checks. Focused owner tests should run before this full pass. Existing useful focused commands, with package-relative paths:

```powershell
pnpm --filter @taki/core exec vitest run src/harness/subagent-interactive.test.ts src/harness/subagent-inbox-recovery.test.ts src/harness/subagent-inbox-retry.test.ts src/harness/subagent-recovery.test.ts src/harness/subagent-service.test.ts src/harness/subagent-tool-materials-retention.test.ts
pnpm --filter @taki/desktop exec vitest run src/features/subagents/subagent-inbox-controller.test.ts src/features/subagents/subagent-controller.test.ts src/features/subagents/subagent-conversation-pages.test.ts src/features/subagents/subagent-activity-retention.test.ts src/features/subagents/subagent-tool-display.test.ts src/features/subagents/subagent-presentation.test.tsx
pnpm --filter @taki/e2e test:e2e src/agent-context-runtime.e2e.test.ts src/agent-context-restart.e2e.test.ts
```

The final full E2E includes these focused E2E files; do not redundantly rerun them after a passing frozen-source full pass. Add new S8-S10 files named by their owner to focused commands, rather than guessing their names now.

Native production-Core smoke, after verifying/building the fixture and required Rust inputs:

```powershell
cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --example c2-presence-fixture
node apps/desktop/test/s7-subagent-runtime-smoke.mjs
node apps/desktop/test/s7-subagent-native-smoke.mjs
```

The second native script is supplemental UI-failure evidence and requires its assertions/selectors/teardown to be brought to the frozen UI contract. It cannot substitute for the first. Required Rust checks if native inputs change, or if source/toolchain parity cannot justify reusing valid evidence:

```powershell
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
```

The coordinator additionally owns scoped Git diff checks and actual branch/worktree verification. This researcher did not run any Git command. Run source-before/source-after hash capture for Core/Shared/E2E, frontend/fixtures, Rust inputs/executable, pnpm lockfile/package manifests, TS/Vite configuration and assets consumed by the build. Secrets and raw env files must never enter this manifest/evidence. Record non-secret effective settings separately.

Existing directed real suites are callable only after provider opt-in and evidence directory setup:

```powershell
$env:TAKI_E2E_REAL_ENV_FILE = 'H:/TakiAgent-worktrees/t4/.env.local'
$env:TAKI_E2E_REAL_AGENT_CONTEXT = '1'
$env:TAKI_E2E_EVIDENCE_DIR = Join-Path $taskEvidenceRoot 'directed-real-regressions'
pnpm --filter @taki/e2e test:e2e src/agent-context-real.e2e.test.ts src/agent-context-r2.e2e.test.ts
```

Do not run those optional directed suites merely to satisfy S12: their explicit-tool prompt coverage is different. The new goal-only campaign command after its proposed file exists:

```powershell
$env:TAKI_E2E_REAL_ENV_FILE = 'H:/TakiAgent-worktrees/t4/.env.local'
$env:TAKI_E2E_REAL_AGENT_CONTEXT = '1'
$env:TAKI_E2E_EVIDENCE_DIR = Join-Path $taskEvidenceRoot 'goal-only-real'
pnpm --filter @taki/e2e test:e2e src/agent-delegation-goals-real.e2e.test.ts
Remove-Item -LiteralPath Env:TAKI_E2E_REAL_AGENT_CONTEXT
$env:TAKI_E2E_REAL_ENV_FILE = $taskNoProviderFile
```

Each real scenario must set an explicit finite upstream budget and deadline in code before running. Suggested initial ceilings for the five distinct cases are 24 / 32 / 40 / 64 / 96 upstream requests respectively; these are preparation estimates, not observed usage or billing. The long case needs a finite enlarged deadline and explicit check-in policy; default N=50/K=3 is covered deterministically, while any shortened real setting must be disclosed as such. A budget refusal, skip, incomplete stream, absent delegation, unhandled event or early completion lacking compaction/check-in is a failure or uncovered criterion, never synthetic success. Do not automatically exhaust all ceilings; checkpoint and stop a failing case.

If campaign findings change production source, run focused checks first and then the final required full pass on the final source, as S12 requires. Native reruns depend on affected input parity. Retain prior failed costs/evidence and mark human acceptance pending until the owner confirms.

### Related specs and reference conditions

- `.trellis/workflow.md`: active-task routing and persistence; explicit current authorization supersedes stale global pointers and historical planning-only notes.
- `.trellis/spec/backend/e2e-harness.md`: real-provider opt-in, transparent request capture, mandatory cleanup/evidence, actual Core restart and distinction between deterministic/native/provider/human evidence.
- `.trellis/spec/backend/private-agent-inbox.md`: do not weaken accepted/delivered/handled distinctions, reconciliation, Stop, raw paging or foreground-private partitions. Its pre-intent fresh-opportunity-only retry description must be updated by the implementation/spec owner if S8 adds bounded timer retry.
- `.trellis/spec/backend/private-worker-context.md`: no hard child cap, safe pressure rollover, exact pending raw inputs, summary quality/CAS failure and retained-reference evidence; extend for check-in without deleting these guarantees.
- `.trellis/spec/backend/shared-agent-delegation.md`, `sqlite-migration-lineage.md`, `foreground-chat-activity.md` and frontend `foreground-chat-feedback.md`: preserved policy, historical schema truth, producer-backed presentation and actual rendered state.
- No external docs were fetched. Dependency/version observations are from installed packages and local source, not a claim about latest upstream releases. Provider connectivity, billing and model capability remain unobserved.

## Caveats / Not Found

- No full suite, native executable, model call or provider probe was run; this artifact is preparation, not acceptance.
- Exact S10 configuration names, counter schema, check-in event/action shapes, and new test filenames must be frozen by the Core owner before harness implementation. Do not substitute `TAKI_MAX_STEPS` or fabricate unknown usage as zero.
- Native binary exists and WebView2 is installed; clean build parity and successful actual launch are still unverified. Existing scripts retain some fixture files/profiles and need the bounded lifetime cleanup adaptation described above.
- Existing real R1 explicitly dictates tools and sends a correction through RPC; it cannot satisfy natural-use, current full-batch or long-compaction/check-in acceptance by itself.
- A faulty env-name-only command exposed provider credentials in this research turn's tool output. No credential value is repeated or stored here. The coordinator was notified and informed the owner; credential rotation remains owner-managed.
