# Research: Live E2E acceptance preparation

- Query: Identify the existing isolated real-model harness, verify one bounded baseline, and prepare integrated delegation/source-context acceptance without changing production code.
- Scope: internal; live provider connectivity through the existing supported fixture.
- Date: 2026-10-22
- Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization` (read from this worktree's Git metadata; no Git command or mutation).
- Task routing: the dispatched implementation task is `10-21-agent-delegation-runtime`; this report belongs to the explicitly assigned acceptance child. The legacy `.trellis/.current-task` still names the avatar lab and was not treated as current session authority or modified.
- Authorization: the owner's 2026-10-22 instruction permits real-model E2E with bounded calls and test-owned state. This research ran exactly one existing scenario. Broader acceptance waits for prerequisite implementation/check gates, not another request for the same permission.

## Findings

### Readiness and actual baseline

The configured route works through the current production Core and AI SDK stack. One existing synthetic clarification scenario passed. This is route/baseline evidence only: it does not establish delegation, source preservation, child Memory restrictions, Co-Watching integration, or owner UI acceptance.

| Item | Observed result |
| --- | --- |
| Scenario | `initiative-pattern-real.e2e.test.ts`: `unsupported-source clarification sample 1` |
| Test outcome | 1 passed, 0 failed, 7 deselected; test duration 13,078.8336 ms |
| Fixture observation interval | 2026-10-22 11:08:11.622Z to 11:08:24.576Z |
| Configured/requested model | `deepseek-v4-flash` |
| Provider-reported usage model ID | `deepseek-flash` on both rows; do not assume equivalence or aliasing |
| Configured endpoint | `https://api.deepseek.com`; the observer forwards to `/chat/completions` |
| Credential loading | Existing `TAKI_E2E_REAL_ENV_FILE=H:/TakiAgent/.env.local`; required credentials present; no secret values copied into evidence |
| Worktree default | T4 `.env.local` absent; default `realProviderEnv()` returned null; ambient provider keys absent |
| Provider observations | 2 requests, both HTTP 200, no recorded observer error |
| Runtime | One primary Run completed; tools `recall`, `manage_interaction_pattern`; no Pattern, Schedule, or delivery rows |
| Reported usage | 2 `quality=reported` rows; 30,165 input + 882 output = 31,047 total tokens |
| Included usage subsets | 15,360 cache-read tokens are already within input; 512 reasoning tokens are already within output |
| Missing usage | Neither observed request lacks a reported usage row; this is not a provider billing reconciliation |
| Settings | Existing file supplies `TAKI_MAX_STEPS=20`; context token setting is absent, so current Core default applies; fixture explicitly enables usage and `FULL_LOCAL` monitor; no fixture temperature override |
| Scope bound | One selected case, one synthetic user turn, Vitest retry 0; 180 s chat deadline, 240 s scenario timeout; no retry of this campaign |
| Cleanup | Scenario-owned Core/observer teardown completed; isolated fixture data removed; generated Node compile cache removed only after checking its absolute research-directory path; test temp directory empty |
| Source stability | All 11 recorded source/config/lockfile SHA-256 values unchanged before/after this scenario |

The actual answer explicitly states that the system cannot detect stress/fatigue, offers supported alternative conditions, and asks the user to choose before configuring a rule. It does not claim a rule was activated. The alternative conditions correspond to the current Shared schema (`packages/shared/src/interaction-pattern-schema.ts:15`, `:21`, `:23`, `:25`, `:27`). This was researcher inspection of one saved synthetic answer, not owner acceptance or a general semantic reliability estimate. The fixture's hard assertions check absence of invented executable rules and a nonempty answer; preserving the actual answer is necessary to evaluate clarification semantics.

Evidence files, all under `research/live-e2e-baseline-20261022/`:

- `clarification-1.json`: complete synthetic prompt/answer, observer request metadata, reported usage, Run outcome, tool names and relevant empty rule/delivery results.
- `vitest.json`: exact selected/skipped test outcomes and duration.
- `source-hashes-before.json`, `source-hashes-after.json`: reproducible sampled baseline identities, including lockfile, current Core entry/agent/config and used fixtures. These are not a whole-working-tree snapshot; other agents were concurrently working on the persistence slice.

### Exact executed command

Run from the T4 root. A future run must use a new evidence directory instead of overwriting this baseline. Directory creation and environment assignments affect this shell/test process only; the provider file is read, never rewritten.

```powershell
$researchRoot = 'H:/TakiAgent-worktrees/t4/.trellis/tasks/10-21-agent-context-acceptance/research'
$evidenceRoot = Join-Path $researchRoot 'live-e2e-baseline-20261022'
$temporaryRoot = Join-Path $evidenceRoot 'tmp'
New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null
$env:TEMP = $temporaryRoot
$env:TMP = $temporaryRoot
$env:TAKI_E2E_REAL_ENV_FILE = 'H:/TakiAgent/.env.local'
$env:TAKI_E2E_REAL_INITIATIVE = '1'
$env:TAKI_E2E_EVIDENCE_DIR = $evidenceRoot
pnpm --filter @taki/e2e exec vitest run src/initiative-pattern-real.e2e.test.ts --testNamePattern 'unsupported-source clarification sample 1$' --retry 0 --no-cache --configLoader native --reporter json --outputFile (Join-Path $evidenceRoot 'vitest.json')
```

`--configLoader native` avoids bundled config files outside the research directory; `--no-cache` disables Vitest result caching. Node's generated compile cache followed redirected TEMP and was cleaned after the run. No additional harness module was needed. Node was `v24.18.0`, pnpm `10.22.0`, and the installed Vitest CLI reported `4.1.10`. Current Core package pins: `ai=7.0.148`, `@ai-sdk/openai-compatible=3.0.75`, `@ai-sdk/mcp=2.0.81`.

### Files found and reusable code patterns

| File and line | Purpose / verified pattern |
| --- | --- |
| `e2e/package.json:6`, `e2e/vitest.config.ts:4` | `test:e2e` is `vitest run`; serial E2E files, bounded default timeouts |
| `e2e/src/fixture/paths.ts:25` | Reads only provider URL/key/model from the explicitly selected env file or T4 `.env.local`; does not import the file wholesale into Core |
| `e2e/src/fixture/with-stack.ts:147`, `:172` | Standard `withStack` boots isolated Core/headless Node, pairs operators, exposes `agentSay` and deterministic `l1`, and tears down fixture state |
| `e2e/src/fixture/procs.ts:73` | `childEnv` deletes inherited `TAKI_*` entries before applying trusted scenario settings |
| `e2e/src/fixture/initiative-process.ts:62` | Production-entry Core process on loopback with explicit `TAKI_DATA_DIR`, Hindsight disabled, absent test credential directory and bounded teardown |
| `e2e/src/fixture/pattern-process-entry.ts:5` | Imports unmodified production `main.ts`; IPC only provides ready/stop, not dispatch/source injection |
| `e2e/src/initiative-pattern-real.e2e.test.ts:85`, `:168`, `:257`, `:263` | Existing single synthetic clarification case; canonical seed; allow-listed tuning; safe result/usage evidence on success and failure |
| `e2e/src/fixture/real-provider-observer.ts:35`, `:64`, `:121` | Real byte-preserving loopback forwarding, 180 s per-request deadline, bounded schema/error diagnostics and context-marker booleans |
| `e2e/src/fixture/seed-canonical-memory.ts:11`, `:25` | Pre-boot canonical Local authority and `e2e-global` / `e2e-character` banks; optional real structured Blocks |
| `e2e/src/fixture/initiative-interview-seed.ts:17` | Pre-boot actual recallable Source/Unit/Policy with unique memory-only marker; no fake recall result |
| `e2e/src/canonical-memory-production.e2e.test.ts:20` | Actual canonical Local composition and governed retain Effect through existing L1 path; test-owned state only |
| `packages/core/src/testing/prepared-publication-fixture.ts:32` | Real SQLite Run/Effect/Timeline/delivery owners with controllable source/currentness/transport; captured governance/transport remain fixtures |
| `packages/core/src/co-watching/real-prepared-playback.test.ts:31`, `:89` | Existing real ChatAgent + file tools + pinned native video + actual playback composition; maxSteps 6, two prepared publications and revision/Stop checks |
| `packages/core/src/agents/chat-agent.ts:318`, `:331` | Actual shared ToolLoopAgent and finite step cap; current production capture disables raw SDK input/output telemetry |
| `packages/core/src/config/agent-config.ts:8` | Default 10 steps, validated finite range 1–50; observed baseline explicitly used 20 |

Standard existing commands, **not run in this research**:

```powershell
# Required only if the headless binary is missing; it was present during this research.
cargo build --bin taki-node --manifest-path apps/desktop/src-tauri/Cargo.toml

# Existing deterministic owners useful for the later integrated gate.
pnpm --filter @taki/e2e exec vitest run src/canonical-memory-production.e2e.test.ts
pnpm --filter @taki/core exec vitest run src/delivery/prepared-publication.test.ts src/co-watching/publication-source.test.ts src/co-watching/runtime-permissions.test.ts src/harness/prepared-publication-authorization.test.ts
pnpm --filter @taki/core exec vitest run src/agents/tool-disclosure.test.ts src/agents/turn-registry.test.ts src/agents/chat-agent-compaction-seam.test.ts src/agents/compaction-pass.test.ts src/agents/compaction-slice4.test.ts
```

Do not use the entire key-gated legacy L2 suite as a connectivity command: it includes screenshot, clipboard and exec scenarios, and credential presence alone enables older L2 cases. `workspace-l2` writes confined files but does not assert its recorded read count; it is not sufficient evidence for both operations. `name-recall-l2` seeds the older Markdown memory surface, whereas this acceptance needs canonical Local Source/Unit/Policy records.

### Isolation for full-feature acceptance

Reuse the canonical setup, not a copy of a user's DB. Create a fresh directory for every scenario/variant; call `seedCanonicalLocal` before any Core writer starts. The identical bank labels are safe because each instance has a different isolated DB/authority epoch. Keep Hindsight off. No live user's bank, conversation DB, browser profile, secret catalog, or OS clipboard participates in the headless model campaign.

For actual recall, use `seedInitiativeInterviewMemory` or a narrowly adapted test-owned canonical Source/Unit/Policy seed. Keep the recall marker exclusively in that Memory record; use separate markers for selected parent history, excluded unrelated history, external material, and addressed correction. A Memory Block marker proves assembled context presence, not successful search. The baseline included synthetic Character Memory and primary history in both requests, which is expected for a primary turn and proves no child-specific context isolation.

The credential file supplies exactly three provider fields plus the existing suite's two allow-listed tuning fields (`TAKI_MAX_STEPS`, `TAKI_PROVIDER_CONTEXT_TOKENS`). `startInitiativeProcess` then forces the isolated DB path, disables Hindsight, and uses a test-only absent credential directory. The real baseline used this path. Source fixtures should retain explicit external/user/unknown provenance through ordinary input producers rather than minting trusted metadata from model output.

### Baseline/candidate and bounded scenario matrix

Before execution, the acceptance implementer must freeze the integrated source/lockfile hashes and confirm upstream gates. Use identical synthetic source bytes, selected snapshots, memory seeds, provider settings and finite event ordering for each baseline/candidate pair. The baseline is the pre-source-integration path with the current SDK, not a downgrade of the shared workspace. Use an already captured/reviewed preimage or isolated owner-prepared build. If unavailable, report candidate-only evidence; do not manufacture a before/after improvement claim. A baseline lacking delegation is an explicit applicability gap, not a passing runtime comparison.

| Case | Deterministic oracle first | Bounded live observation / evidence |
| --- | --- | --- |
| A1 external experience | Exact external source identity survives selected child input, retained outcome, publication replay and compaction; no user-origin rewrite | Synthetic video speaker says "My project failed". Follow-up asks whose project failed. Compare pre/post compaction answers and exact outgoing source framing |
| A2 genuine self-report | Explicit user's report remains user-origin while unrelated video material stays external | User explicitly reports their own failed project while video is active. Answer must preserve this report, without overcorrecting all experience into external quotation |
| A3 mixed/unknown origins | Preserve known speaker/material metadata; missing identity remains unknown | Quoted speaker failure plus user's comparison and one unattributed quote. Later follow-up after compaction must distinguish all available origins without invented speaker facts |
| R1 selected create/reuse + record-only | Fresh child and reused WorkContext; new Run after terminal; selected snapshot only; actual addressed-input receipt; completion recorded exactly once; **zero parent model requests** after record-only completion | Parent selects a small source segment, sends one addressed correction, and reuses child context. Add an unrelated parent marker after creation and verify it never enters child requests. Child response acknowledges the correction; private transcript does not appear as relationship history |
| R2 request-parent + independent controls + delayed reply | Real parent cancellation signal leaves two child executions alive; preserve each completion policy; user-stop targets one child and blocks parent-driven resumption; explicit user continuation admits new work; parent interruption is separately resumable | Run actual production controls during provider in-flight state. Retain both child outcomes, one eligible distinct parent continuation, and separately observe approved delayed publication. A result or successful inference alone is not delivery. No duplicate continuation or speech after repeated completion |
| R3 executable tools + Memory | Check allow, exclude and explicit empty sets at executable membership and actual dispatch; attempt forbidden tool execution deterministically even if model never calls it. Child can read, cannot retain/edit/invalidate/restore/auto-ingest across reuse/retry/recovery; main retains existing permitted writes | Main performs one authorized write to the test bank; child reads the recall-only marker and returns a proposed change. Child cannot apply it. Record tool dispatch/Effect identity and before/after test-bank revisions; excluded tools cannot become callable through loaders or raw closures |
| P1 publication/source gates | Trusted acceptance, source/revision/currentness, pending/deny, foreground busy, paused/expired/missed/rewound source, retirement, uncertain transport and restart gates | Include delayed publication in R2 and a synthetic accepted Co-Watching path in A1. For actual player observation, use the later separately scoped desktop fixture; never relabel synthetic playback samples as real player evidence |

Proposed finite first integrated campaign: A1–A3 baseline/candidate pairs (six sessions, each at most four model generations including one compactor generation); R1 at most four generations; R2 at most five; R3 at most three. Maximum nine sessions / 36 model generations, each agent generation maxSteps 6, one compaction per source session, no test retries or open-ended natural-language repairs. Publication of already prepared candidates must add zero model generations. This is a ceiling, not a target. Run stages sequentially; two concurrent children are intentional only in R2. Stop the affected stage on failure and preserve its evidence before routing the defect.

The new suite needs a scenario-owned step setting of 6 rather than silently inheriting the current file's 20. Existing transport retries and the one classified clean overflow retry are distinct from the Vitest retry count: SDK `stream-text.ts` documents a default of two retries, and Core `chat-agent.ts:240` handles the bounded overflow path. Record observed physical proxy requests separately from generation/Attempt counts; a logical step cap is not an exact bill. Do not retry a complete scenario merely to obtain a clean answer. Dollar cost remains unknown without provider billing/pricing evidence.

### Required evidence and exact remaining ownership

The acceptance implementer owns the new explicitly opted-in integrated test suite and fixture/evidence extensions. Proposed new owned paths are `e2e/src/agent-context-real.e2e.test.ts` and `e2e/src/fixture/agent-context-scenario.ts`; these do not yet exist as delivered fixtures. Any necessary test-only changes to `real-provider-observer.ts`, canonical seed helpers or the old `real-prepared-playback.test.ts` remain part of that acceptance handoff. Reuse `startInitiativeProcess`, real observer, operator RPC, canonical seeding and prepared-publication fixture; do not add production debug bypasses. The current files contain no completed end-to-end delegation scenario suitable for this matrix.

Required fixture extensions after protocol handoff:

1. Correlate actual observed requests with Run/Attempt/Effect, work/input/completion identity and request role, so zero-parent-call and distinct-continuation assertions are factual. The existing observer only stores schema shape/status plus two marker booleans and cannot by itself correlate child versus parent.
2. Retain synthetic-only outgoing model requests, including exact role/tool framing, selected child context, publication replay and compactor requests. Current `recordInputs:false` and observer booleans do not provide full serialized request evidence. Keep this in test evidence, not ordinary Core logs. Preserve partial requests/errors/outcomes and unknown usage.
3. Add scenario settings for max steps, a hard session/request stop bound, controllable synthetic material/accepted source, public child controls, and observable in-flight barriers. Deterministic providers establish cancellation races and attempted denied dispatch; stochastic model behavior is supplementary. Do not fake a stopped parent by toggling a fixture flag alone.
4. Capture actual Memory Source/Unit/Policy/receipt revisions and callable tool membership, both before and after child activity and permitted main writes. No long-term ingestion may arise from the child private transcript, including after retry/recovery.
5. Persist on every phase/failure: requested and reported model identity, sanitized settings, source/lock hashes, fixture hashes, start/end/status, requests, usage/unknowns, Run/Attempt/Effect, input receipts, outcome retention, completion admission, and delivery disposition. Keep parent inference count separate from publication count. Save failed and repaired runs separately.

Dependency owners and gates:

- Runtime S1 implementer/reviewer: SQLite/lifecycle participation must pass before a dispatcher is enabled. Runtime `implement.md:3`, `:29`, `:36` currently identify this active gate.
- Runtime S2/S3 implementer: shared child execution, retained private history, actual addressed input, immutable tool/Memory projection, targeted cancellation and deduplicated parent admission. This researcher changed none of those files.
- Source S4–S6 owner: source-preserving input/result/publication/replay/compaction integration after shared-boundary handoff. The live A1–A3 campaign is not runnable as final acceptance before that delivery.
- Runtime/UI owner: navigable child conversation, loading/empty/error/reconnect states and view/input/stop/continue wiring. Owner trials must remain pending until the owner confirms.
- Acceptance implementer: adapt the existing prepared-playback test if reused. `real-prepared-playback.test.ts:39` hardcodes `deepseek-flash`, which differs from current requested `deepseek-v4-flash`. Preserve both requested/reported identities instead of casually changing the configured model to make an assertion pass.

The old prepared-playback test also pins SHA-256 `06c65b0e23d4edebda8d6bb50830c5cef66378696213546e9a848dffe704f380`, video `BV1UEaq6qEZt`, `cid=42265479965`, page 1, a stored native-result path, live Core/Edge CDP, and its separate opt-in. It uses real ChatAgent/file tools and real player observations but controlled acceptance/captured governance/final transport. Its original fixture cannot establish production child controls or native UI delivery. Neither its native asset nor a dedicated live browser stack was started or validated here.

Existing invocation once its preconditions and owner-scoped browser setup are satisfied:

```powershell
# Populate TAKI_PROVIDER_* through the supported provider environment, never literal secrets in a command.
# Also provide TAKI_E2E_NATIVE_RESULT_PATH, TAKI_E2E_PREPARED_EVIDENCE_DIR,
# and the dedicated loopback Core/CDP endpoints. This is a command reference, not an executed test.
$env:TAKI_E2E_REAL_PREPARED_PLAYBACK = '1'
pnpm --filter @taki/core exec vitest run src/co-watching/real-prepared-playback.test.ts
```

### Related specs and external references

- `.trellis/workflow.md`: explicit session/task routing, persisted research and dependency gates.
- Parent `10-21-agent-delegation-source-context/prd.md`: R01–R14 and AC01–AC11, including current real-model authorization and child Memory restriction.
- Acceptance `prd.md`, `design.md`, `implement.md`: separate deterministic, actual-input, semantic-live and owner evidence.
- Runtime `prd.md`, `design.md`, `implement.md`: G1–G4, immutable effective tools, distinct publication and sequenced implementation ownership.
- `.trellis/spec/backend/e2e-harness.md`: L1/L2, existing opt-ins, isolated teardown, bounded observer diagnostics and prepared-playback limits.
- `.trellis/spec/backend/co-watching.md`: source/currentness, permission, revision, foreground and truthful playback/delivery gates.
- `.trellis/spec/backend/compaction-harness.md`: primary relationship authority, durable fenced summary replacement and source/usage fidelity.
- `.trellis/spec/backend/tool-disclosure.md`: disclosure is not executable permission; captured tools and governance remain authoritative.
- External package references: [Vitest CLI](https://vitest.dev/guide/cli.html), [Vite config loading](https://vite.dev/config/), [AI SDK](https://ai-sdk.dev/docs). No new web/package/prompt comparison was performed; CLI flags and SDK retry behavior above were checked against the locally installed versions. Upstream comparisons remain owned by the existing SDK research.

## Caveats / Not Found

- Only the one existing synthetic route/baseline scenario ran. None of the new matrix cases, deterministic commands listed above, real browser playback, child UI, or owner acceptance ran in this research.
- A successful SDK/fixture request and a useful clarification answer do not establish completed delegation or source attribution after compaction.
- Current requested versus provider-reported model IDs differ. The report preserves the discrepancy; no alias explanation was verified.
- The observed 31,047-token subtotal is reported usage for two observed requests, not an invoice or proof of universal transport accounting. Cache-read/reasoning subsets must not be added again.
- Full request attribution, child-versus-parent correlation and denial/recovery fixtures still require acceptance implementation after runtime/source gates. Schema-only S1 state is insufficient.
- Hindsight/provider-owned memory extraction and maintenance were not exercised. Canonical Local authority evidence cannot be generalized to unavailable provider-owned prompts.
- The read-only preparation changed no production code/config, credentials, real conversation/memory data, Git state or task pointers. Connectivity is ready and should not be repeated before full-feature acceptance merely to reconfirm this result.
