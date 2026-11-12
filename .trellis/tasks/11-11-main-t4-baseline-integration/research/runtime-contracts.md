# Research: Runtime, Configuration and Verification Contracts

- Query: Identify the authoritative T4 startup/live-configuration behavior and the cross-layer seams that must preserve main Hindsight functionality during baseline integration.
- Scope: Internal source and frozen documentation; planning only. Main source is the independently cloned `9b98794` tree; T4 source is `H:/TakiAgent-worktrees/t4` at parent-verified `63faf81`.
- Date: 2026-11-11
- Ownership: This research file only. No Git operations, source/spec edits, installations, test/service launches, environment-secret reads, Credential Manager or real-profile access were performed by this researcher.

## Findings

### T4 is authoritative for the basic plane and model readiness

| Owner in T4 | Observed contract |
| --- | --- |
| `packages/core/src/boot/core-bootstrap.ts:37`, `:97` | `model` is optional; provider configuration is safely parsed and a missing/incomplete provider produces no model instead of blocking basic boot. The DB/data root opens independently of the model. |
| `packages/core/src/boot/core-bootstrap.test.ts:107`, `:115` | Tests explicitly cover no model fields and invalid optional feature policy while preserving raw values for recovery. Transport/bootstrap invalidity remains a separate startup error. |
| `packages/core/src/boot/feature-configuration.ts:17` | Each optional feature group records `unavailable` on invalid desired input. Construction defaults do not authorize dispatch. Invalid attachment TTL uses infinite retention, avoiding deletion caused by invalid configuration. |
| `packages/core/src/config/config-source.ts:80`, `core-bootstrap.test.ts:100` | Stored application values outrank eligible environment fallbacks. `TAKI_DATA_DIR` remains env-only. Old env-first comments and some restart wording are stale; use implementation and current tests as truth. |
| `packages/core/src/config/model-profile-service.ts:42`, `:97`, `:135` | Durable Main/Utility drafts and active bindings are independent. Saving/applying does local validation, not network health probing. Incomplete drafts and failed apply retain the prior usable active binding. Only the explicit `test()` path invokes `generateText`, with a 15-second timeout and no retries. |
| `packages/core/src/config/model-profile-service.test.ts:32`, `:40`, `:51`, `:79`, `:101` | Covers empty Main/inherited Utility, incomplete draft/reopen, keyless candidate, last-good preservation, reset versus disabled/no-auth, and explicit invalid Utility without silent Main fallback. |
| `packages/core/src/config/agent-runtime-config.ts:22`, `:56` | Refresh prepares current model/context policy; admission captures an immutable binding and calibration closure. New configuration affects new Runs. Old Runs keep their original model, credential revision and limits. Invalid initial policy exposes `MODEL_POLICY_INVALID`; an existing last-good capture may remain available after failed preparation. |
| `packages/core/src/harness/run-snapshot-capture.ts:59`, `:120` | Capture Main before awaiting Memory. No configured Main yields public `CONFIG_REFUSED` with `{ reason: "MODEL_UNAVAILABLE", slot: "main" }` before Memory work. The trusted dev-trigger L1 path is exempt from model capture, not from governance. |
| `packages/core/src/server/methods/chat-send.ts:67`, `packages/core/src/harness/run-service.ts:122` | `chat.send` goes through durable Run admission; snapshot refusal occurs before repository admission and the Character reservation is cancelled. Do not merely catch a late provider exception after acknowledging the chat. |
| `packages/core/src/harness/run-snapshot-capture.test.ts:16` | Regression explicitly proves unavailable Main is refused before any Memory work and configuration changes during awaiting Memory do not replace the admitted binding. |

No-model readiness is a typed configuration refusal, not an empty successful response. Retired VLM settings are ignored for operation but their historical stored values are retained (`core-bootstrap.test.ts:47`); T4 text/image input uses the primary model.

### Live application is consumer-specific

`packages/core/src/config/config-application.ts:16` enumerates actual boundaries: bootstrap, immediate, component, next-run, next-operation, maintenance and external. `apply()` captures desired values and a per-key revision; delayed superseded completions cannot overwrite newer observations. Failed apply retains the previous active value and exposes a sanitized message (`:80`; tests `config-application.test.ts:23`, `:32`). Saving configuration and applying it are separate outcomes.

The real composition wiring is in T4 `packages/core/src/main.ts:202`, `:257`, `:294`:

- Scalar provider/Utility edits bridge to model profiles; grouped profile subscriptions refresh AgentRuntime and rearm schedule/initiative readiness.
- Main/context/Tidy/memory changes route through actual runtime owners. Attachment/ambient/logging/loopback changes apply through their consumers. WebSocket host/port replace the listener component.
- T4 explicitly reserves selected Hindsight connection replacement for the dedicated Hindsight work: endpoint/timeouts may remain `restart-required` (`main.ts:272`), and Hindsight memory-policy observations remain inapplicable/restart-required where unsupported (`memory/runtime-composition.ts:151`). These frozen reservations do not supersede main's implemented dedicated connection/template/transition contracts.
- Shared scalar observations are projections of grouped model profiles (`config/model-profile-application.ts:10`), not a second model authority.

### Memory composition must be merged by responsibility

Main `packages/core/src/memory/runtime-composition.ts:54`, `:72`, `:82`, `:86`, `:90` owns primary custody, proven current authority, unbound-Hindsight Run capture, transitions, templates and binding recovery. Main `main.ts:264-293`, `:356`, `:415`, `:601-617` composes and shuts down setup/configuration/activation/templates/lifecycle/backup/transitions/custody/deployment. T4's memory composition omits many of these new main seams; replacing the file with T4 loses accepted functionality.

T4 adds independent accepted Local/Legacy policy, live search/index application, durable Tidy submission and optional/live Utility models in `memory/runtime-composition.ts:51-108`, `:134-160`. Integrate these into main's authority/lifetime ownership rather than creating a second selected-memory or Utility queue.

T4 `memory/utility-slot.ts:35-60` supports optional `mainModel`, a live `resolveModel`, captured model ownership and the same global serial queue. `available()`/`capture()` and operation admission distinguish no model from failed/finished work. Do not satisfy main's required `model: LanguageModel` merely with a cast or dummy model: make the relevant model-dependent owners explicitly unavailable while allowing the base plane to compose.

Relevant existing T4 tests include:

- `memory/runtime-configuration.test.ts` (actual runtime/index application, invalid Tidy isolation, last-good index and superseded preparation).
- `memory/runtime-configuration-race.test.ts` (ranking update during tokenizer rebuild; truthful cold active-policy observation).
- `memory/tidy-reliability.test.ts`, `tidy-shutdown.test.ts`, `tidy-pass.test.ts`, `operations/memory-tidy-runtime.integration.test.ts`.
- `harness/subagent-*.test.ts`, `delegation-tools.test.ts`, `prepared-publication-authorization.test.ts` (trusted child scope, inbox/retry/check-in, recovery and publication authority).

### Startup and native packaging are complementary

- T4 `packages/core/package.json:8-9` routes ordinary Core through `scripts/start-core.mjs`; it separately prepares the native credential helper, then spawns Core with explicit cwd and hidden window. `scripts/prepare-native-helper.mjs:9-31` honors an explicit helper, uses Cargo metadata/build artifacts, and preserves control startup when the helper build is unavailable. This does not authorize touching Credential Manager in isolated tests.
- T4 root `package.json:16` uses `scripts/start-desktop.mjs`; Desktop starts independently and resolves an explicit relative `TAKI_DATA_DIR` against the same Core cwd. It does not start/restart Core implicitly.
- Main root `package.json:17` routes `desktop:build` through `apps/desktop/scripts/build-installed-host.ts`, which builds the get-only key adapter and Hindsight Host payload and supplies a real Tauri resource map. Preserve this packaging path alongside T4's independent dev startup. T4's plain `tauri build` script would omit main's installed Host resources.
- T4 Tauri's Home window label is `home` (`tauri.conf.json:16`); QQ native code explicitly authorizes Home `home` (`src/qqmm.rs:15`). Main's old `main` label cannot be blindly retained while importing T4 native/Home behavior.
- T4 Avatar fixes include per-context legacy Cubism mask ownership before first render (`renderer/live2d/load-character-model.ts:44`, `legacy-mask-context.ts:1-4`) and tests for loading, legacy-mask context, costume switching, commands and dynamic vocabulary. Build success and fake Pet outcomes do not establish real WebGL/WebView rendering.

### Dependencies and G: setup

| Requirement | Main observed | T4 observed | Integration implication |
| --- | --- | --- | --- |
| AI SDK lock | `ai` 7.0.17, MCP 2.0.10, OpenAI-compatible 3.0.5 (`pnpm-lock.yaml:149-163`) | 7.0.148 / 2.0.81 / 3.0.75 (`:133-144`) | Use a deliberately reconciled lock, normally T4's exact SDK patches plus main dependencies; rerun combined SDK behavior. Never treat main-only green results as validation of new SDK patches. |
| Workspace codec | `@taki/secret-catalog-codec` in Core/Host | Core lacks it | Keep main codec package and workspace links. |
| QQ TS client | Absent | Desktop file tarball dependency (`apps/desktop/package.json:14`) | On G: this resolves to `G:/QQMessageMonitor/packages/management-client/artifacts/qqmm-management-client-0.1.0.tgz`. Actual H: tarball existence was verified. |
| QQ native | Absent | Rust path to `QQMessageMonitor/packages/management-native` (`Cargo.toml:31`) | Resolve a G: companion path without committing machine-specific absolute paths; existing H: source directory exists. A G-only junction is a reasonable local setup option subject to root ownership. |
| Rust additions | Hindsight security/authorization/filesystem/job-object/system-services Windows feature set | QQ management and HMAC; smaller Windows feature set | Preserve the union of actual feature requirements; no whole-manifest selection. |
| Toolchain | Node >=24; pnpm 10.22.0 | Rust floor 1.95 from sysinfo | Parent verified Node 24.18.0/Cargo 1.97.0; this research did not rerun toolchain commands. |

## Minimal Verification Matrix

Run from the integrated G: tree with recorded source/lock identities, sequential package workers and one heavy service stack at a time. Commands below are proposals, not completed checks.

1. Prepare locked dependencies and verify imported SDK/codec/QQ resolution. Run `pnpm -r --workspace-concurrency=1 typecheck`, `pnpm lint`, then sequential package tests with full result artifacts. Keep the two prior main failures visible and re-evaluate them against changed code.
2. Run focused Core suites via `pnpm --filter @taki/core exec vitest run src/boot src/config src/harness src/memory/runtime-configuration.test.ts src/memory/runtime-configuration-race.test.ts src/memory/tidy-reliability.test.ts src/memory/tidy-shutdown.test.ts src/memory/operations`. Include Shared schema tests for modified contracts, migration/governance/Approval tests and main Hindsight test suites. Avoid repeating the full gate absent new changes.
3. Add/exercise one production Core/RPC scenario with an isolated fresh profile and zero model fields: boot/list/config repair access; `chat.send` returns exact `CONFIG_REFUSED`/`MODEL_UNAVAILABLE` and creates no Run/Memory work; apply a keyless controlled loopback Main profile; next Run succeeds without restart; captured old Run stays bound across model changes; invalid unrelated Utility/Tidy configuration leaves the base plane usable; failed apply retains last-good state. Existing unit tests prove pieces, not this integrated startup wiring.
4. Native/build: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked`; `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --locked -- -D warnings`; build `taki-node` and `taki-secret-key` with the reconciled lock; `pnpm --filter @taki/desktop build`; preserve and verify installed Host preparation/resource-map packaging via `node apps/desktop/scripts/build-installed-host.ts --debug --prepare-only` (plus supported no-bundle build if needed).
5. Deterministic real Core/native-protocol E2E: `pnpm --filter @taki/e2e test:e2e src/governance-authority.e2e.test.ts src/governance-stale-projection.e2e.test.ts src/approval-challenge-resume.e2e.test.ts src/canonical-memory-production.e2e.test.ts src/agent-delegation-upgrade.e2e.test.ts src/agent-delegation-checkin.e2e.test.ts src/avatar-command-outcome.e2e.test.ts`. The delegation check-in suite uses a local scripted provider (36/50/56-step cases); Avatar uses subscribed fake Pet outcomes. Explicitly label these evidence levels.
6. Desktop tests: changed model/config, memory operations/Tidy, subagent/WS hydration, QQ Home/session/tool-result and Live2D load/mask/costume/command suites. QQ management UI tests exist in `windows/home/pages/qqmm/*.test.*`; native QQ uses the external management crate. Any connected QQ test must use a local synthetic management service without contacting or changing the user's real QQ account.
7. Replay main's connected controlled-model Core/Native/PostgreSQL/Home memory journeys and frozen-copy replay on G: after migration/governance compatibility passes. Adapt provenance and any H-main hardcoded paths in `research/first-use-runtime` helpers to the actual integrated tree. Preserve custody/backup/restore/waiting/maintenance/transition ownership and record timing/peak working sets, not only exit codes.

### Isolation details already available

- `e2e/src/fixture/procs.ts:73` removes inherited `TAKI_*` values before composing child overrides. It still inherits other OS environment keys, so set `TEMP`/`TMP` to a dedicated G: test root and audit additional service/provider environment variables as appropriate.
- `with-stack.ts:58`, `:163`, `:225` uses explicit test data dirs and can provision a random credentials-directory master key (`secretMasterKey`) without the OS keyring. It always supplies a dummy provider by default; that harness alone cannot prove truly no-model startup.
- `fixture/paths.ts:17` hardcodes the built `taki-node` path under this checkout's `apps/desktop/src-tauri/target/debug`. Using `CARGO_TARGET_DIR` elsewhere needs an owned alias or verified harness adaptation; never silently execute a stale H: binary.
- Ordinary startup reads `.env.local` and may build the credential helper. Do not copy original secret-bearing `.env.local` into the clone or run default-profile commands. Test the entry with explicit isolated credentials/data/helper inputs, or launch the production `src/main.ts` with a sanitized environment when testing runtime behavior.
- Real provider acceptance uses explicit opt-in (`TAKI_E2E_REAL_AGENT_CONTEXT=1` and configured provider); it is a distinct evidence/cost gate. `agent-context-scenario.ts:85` supports scripted provider scenarios without that opt-in. No paid or external provider was used during this research.
- Backup configuration copies contain secrets and must never be staged. Original C: profile and deployments remain outside test writes. Recheck watchers before later original-worktree alignment.

## Owner Choices and Caveats

- No new mutually exclusive product choice was found in these runtime seams. T4 startup/model/config precedence, main Hindsight preservation, and isolated engineering verification were already settled by the owner. Dependency path setup, immutable capture integration and complementary packaging are engineering decisions.
- Selected Hindsight connection/policy changes must retain main's dedicated admission/proof/transition rules. T4's generic live-config mechanism cannot directly replace or retire that authority; its configuration observation should state the actual supported consumer boundary.
- Real WebView rendering, installed distribution behavior, real provider tool selection and connected real QQ observations remain separate from build/unit/scripted checks. Report any unexecuted level explicitly; owner-manual acceptance requires the owner.
- Task state comes from the parent's explicit session-scoped task binding and supplied task path. No legacy `.trellis/.current-task` value was found in this clone; it was not used to infer authority.
- This is source research only. No combined checkout, successful compilation, fixed screenshot, schema upgrade, runtime behavior or performance is claimed as verified here.
- Related specs: `.trellis/spec/backend/e2e-harness.md`, `quality-guidelines.md`, `permission-authorization.md`, `sqlite-migration-lineage.md`, main Hindsight configuration/template/lifecycle/backup/operations contracts; T4 `docs/T4-FREEZE-HANDOFF.md`.
- External references: none fetched; no library API implementation or undocumented external behavior was introduced. SDK validation should use the reconciled installed package interfaces/current applicable docs during implementation.
