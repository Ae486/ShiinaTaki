# S11/S12 harness implementation checkpoint — 2026-10-30

## Scope and ownership

Implemented only E2E/test harnesses and this checkpoint in `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`, under the coordinator's explicit 10-25 task assignment.
The legacy global pointer remains unchanged. Production Core/Shared/Desktop, native Rust, task requirements,
Git delivery, dependencies and real-user data were not modified by this owner. No paid request or native
campaign was started. Working preimages are retained under `target/acceptance-implementation-20261030/preimages/`.

## Delivered harness behavior

- `agent-context-scenario.ts` now validates finite session/turn/upstream test budgets and explicit N/K/context
  options. Existing directed fixtures retain their six-step main policy; goal campaigns omit that override and
  use the actual production main default. Effective allow-listed non-secret settings are saved through operator
  `config.list`; requested settings, endpoint host, model, body SHA-256, exact synthetic request bodies and complete
  private inbox/progress/summary/usage tables are retained separately from actual HTTP-attempt diagnostics.
- The local compatible provider supports both streaming requests and non-streaming requests with omitted `stream`,
  matching the installed adapter's actual Utility request. Optional exact usage makes complete/partial accounting
  testable without inventing tokens. Inbox parsing retains internal SQLite delivery/Effect/digest joins.
- `agent-delegation-checkin.e2e.test.ts` exercises default N50/K3 with 36-step and N-th-step final completion,
  plus the original 56-step work pausing at 50 and continuing via authenticated explicit user input in a new Run.
  It retains same-Attempt multi-compaction below N, raw step witnesses, private source/publication boundaries and
  complete cumulative task plus Utility usage. Provider acquisition and independent teardown own one lifetime.
- `s7-subagent-runtime-smoke.mjs` preserves two children/main, drafts, running addressed input, user Stop,
  cancelled Run/history, exact Continue, long body/older paging and reconnect. It reads real default N50/K3,
  deliberately stores K0 before work admission for a bounded user-required attention case, pauses the 56-step
  work at default step 50 across compaction, opens it from actual Home attention while the private page is hidden,
  checks rendered actual usage and continues through the real UI to the same work/new Run. Idle menus must omit
  child creation while retaining existing child interaction and inbox actions.
- Supplemental UI-only smoke now uses the current continuous conversation/activity/attention and combined
  composer controls. Its bootstrap, cleanup and required evidence have independent failure handling. Shared
  native before/after manifests include frontend assets, Rust/config/permission/build inputs, drivers and the
  executable. Both smokes intentionally retain their owned profile/assets under explicit evidence directories;
  they do not leave undocumented disposable directories or mutate user profiles.
- A separate paid opt-in adds five goal-only production-Core scenarios: independent delegation/foreground,
  natural running follow-up, genuine missing latency with a natural main-model addressed answer, actual eight
  eligible events delivered together, and a meaningful 24-source private audit through actual compaction/check-in.
  Prompts do not dictate tool names or argument schemas. Request timing relays only hold/release unchanged bytes.
  Missing delegation, early completion without required coverage, absent compaction, refused budgets or missing
  exact handling fail honestly. Long-work direct user Continue is intentionally authenticated RPC and awaits
  a new check-in identity or validated completion before the next iteration.
- One additional bounded paid observation enters the current actual Co-Watching shared-child adapter with the
  shipped Skill, governed files, isolated SQLite and configured real model. It records measured task steps and
  usage and requires normal completion below default50/3. Native video analysis, paused browser source and
  acceptance/delivery ports are synthetic; this is explicitly narrower than full real Co-Watching integration.

## Checks and retained evidence

- E2E typecheck passed; Desktop typecheck passed; owned ESLint and Node syntax checks passed after scoped fixes.
- Default check-in fixture: **3/3 passed**, 30.32 seconds, under
  `target/acceptance-implementation-20261030/focused-checkin-fixed/`. Earlier three failures remain under
  `focused-checkin/`: Utility requests omit `stream`, whereas the first test transport incorrectly assumed
  explicit `stream:false`. Actual request-shape evidence identified and corrected that harness defect; compaction
  assertions were preserved.
- Existing production runtime fixture: two cases passed; the record-only case passed behavior/cleanup but failed
  its source-stability fence while the coordinator changed seven Core tests. The exact changed paths and failed
  source manifest remain under `focused-runtime-final/`. This is not claimed as a passing final source gate.
  The separately gated goal suite discovered **6 skipped** cases with explicit paid opt-in disabled; zero model
  requests were made. The coordinator's final frozen E2E pass remains required.
- No full workspace, paid provider or native campaign was run by this owner. Human acceptance remains pending.

## Exact final commands for the coordinator

Run from the T4 root on frozen source. Ordinary E2E must use an explicit empty real-env file and cleared paid
opt-ins; preserve/restore only the scoped environment variables. The final full E2E includes the deterministic
36/50/56 file, so no redundant focused rerun is required after that pass.

```powershell
pnpm --filter @taki/e2e typecheck
pnpm --filter @taki/e2e test:e2e
cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --example c2-presence-fixture
node apps/desktop/test/s7-subagent-runtime-smoke.mjs
node apps/desktop/test/s7-subagent-native-smoke.mjs
```

The focused deterministic command, when a new relevant change requires it, is:

```powershell
pnpm --filter @taki/e2e test:e2e src/agent-delegation-checkin.e2e.test.ts
```

Paid campaign requires **both** the older agent-context opt-in and its new independent goal-only opt-in. Run each
case separately initially using `-t`, inspect its saved result before the next case, and preserve failures/cost
observations separately. Then run the complete file when findings are resolved. The model route is loaded solely
by the existing provider loader; no real-route model override is available.

```powershell
$env:TAKI_E2E_REAL_ENV_FILE = 'H:/TakiAgent-worktrees/t4/.env.local'
$env:TAKI_E2E_REAL_AGENT_CONTEXT = '1'
$env:TAKI_E2E_REAL_AGENT_DELEGATION_GOALS = '1'
$env:TAKI_E2E_EVIDENCE_DIR = 'H:/TakiAgent-worktrees/t4/target/acceptance-implementation-20261030/goal-only-real'
pnpm --filter @taki/e2e test:e2e src/agent-delegation-goals-real.e2e.test.ts
```

| Case name substring for `-t` | Max upstream requests | Session deadline | Child policy |
| --- | ---: | ---: | --- |
| simple Co-Watching plan | 24 | 420s | default50/3 |
| independent useful reviews | 24 | 420s | default50/3 |
| natural correction | 32 | 480s | default50/3 |
| genuine missing requirement | 40 | 540s | default50/3 |
| full eight-event inbox | 64 | 600s | default50/3 |
| long private audit | 96 | 900s | explicit8/0; default50 covered deterministically/native |

These are finite TEST ceilings, not product lifetimes, observed bills or guaranteed request counts. Total ceilings
across six independent cases are 280; do not blindly exhaust them after a failed case. Every real effect/usage/body
observation remains separately labelled. Full final checks, native rendering, real semantics and owner acceptance
are outstanding coordinator gates, not inferred from the deterministic passes.
