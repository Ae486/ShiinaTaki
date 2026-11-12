# Hindsight selective-withdrawal handoff

Recorded 2026-11-10 by the Core runtime worker. This document responds to the owner's explicit scope correction: preserve existing Hindsight key logic because another task owns dedicated Hindsight work; document every necessary exception. All further Hindsight implementation is stopped. The newly implemented Hindsight hot-application feature has been selectively withdrawn. Core model-profile work remains authorized. This is the single dedicated handoff for the retained Hindsight-facing changes.

## Definitive current state

Verified after selective inverse patches on 2026-11-10. No blanket Git reset/restore or whole baseline restoration was used.

- **Withdrawn:** new transport generations, AsyncLocalStorage routing, captured Hindsight endpoint/key scopes, live connection verification/publication, changed provider/sync/recovery/curator transport behavior, scheduler availability hooks, new tests for that withdrawn behavior, and secret-set/clear hot-rebind callback.
- **Root withdrawal:** live tokenizer replacement in `hindsight-runtime-state.ts`, `reconfigureSearch` imports/property in `hindsight-memory-runtime.ts`, and new `hindsight-search-projection.ts` were withdrawn by root. Generic index rebuilding is now limited to Local/Legacy; Hindsight must be refused.
- **Retained:** the five Hindsight files listed below contain prior-session Utility and prompt/config capture adapters. They are deliberately preserved rather than overwritten. Shared general Core startup/model changes are listed separately below.
- **Not claimed:** all Hindsight files are unchanged. Only this session's new internal hot-rebind/search work was withdrawn. The previous Hindsight connection/fingerprint/credential logic is restored.

| Path relative to `packages/core/src/memory/hindsight/` | Current status | Remaining behavior |
| --- | --- | --- |
| `hindsight-client.ts` | Restored to baseline content | Original authenticated client only |
| `hindsight-runtime-connection.ts` | Restored to baseline content | Original ready-config requirement, fixed fingerprint and just-in-time secret resolver |
| `hindsight-runtime-consumers.ts` | Restored to baseline content | Original lifetime tracking only |
| `hindsight-memory-provider-context.ts` | Restored to baseline content | Fixed captured fingerprint |
| `hindsight-memory-provider.ts` | Restored to baseline content | Original tracked provider calls |
| `hindsight-memory-write-context.ts` | Restored to baseline content | No new operation scope |
| `hindsight-memory-writes.ts` | Restored to baseline content | Original write/recovery behavior |
| `hindsight-runtime-bank-service.ts` | Restored to baseline content | Original queue and sync/recovery |
| `hindsight-replica-scheduler.ts` | Restored to baseline content | Original scheduler behavior |
| `hindsight-policy-curator-context.ts` | Restored to baseline content | No new transport scope |
| `hindsight-memory-reflect.ts` | Restored to baseline content | Original fingerprint evidence |
| `hindsight-memory-reflect-deadline.test.ts` | Restored to baseline content | Original timeout-drift refusal assertion restored |
| `hindsight-runtime-state.ts` | Restored to baseline content | Original constructors and tokenizer; root search changes removed |
| `hindsight-transport-scope.ts` | New file removed | Archived only in withdrawal evidence |
| `hindsight-transport-scope.test.ts` | New file removed | Archived only in withdrawal evidence |
| `hindsight-connection-verification.ts` | New file removed | Archived only in withdrawal evidence |
| `hindsight-live-connection.test.ts` | New file removed | Archived only in withdrawal evidence |
| `hindsight-search-projection.ts` | Root new file removed | No Hindsight index reconfiguration |
| `hindsight-ingestion-lifetime.ts` | Baseline plus inherited delta | Lazy Utility model read; forwarded available/capture through original lifetime guard |
| `hindsight-ingestion.ts` | Baseline plus inherited delta | Capture Utility model before logical ingestion/queue; unavailable automatic work skips without source coverage advancement |
| `hindsight-policy-curator.ts` | Baseline plus inherited delta | Capture Utility model/policy once before queue; unavailable automatic Utility work skips |
| `hindsight-memory-runtime.ts` | Baseline plus inherited delta | Optional live prompt/config ports; Persona and pinned policy captured before asynchronous Run capture |
| `hindsight-memory-subsystem.ts` | Baseline plus inherited delta | Forward optional prompt/config ports into foreground/curator; original connection/scheduler startup restored |

`packages/core/src/server/methods/secret-methods.ts` is also restored to baseline content. Main's added Hindsight connection-key callback is removed. Its remaining unrelated model/listener/perception integration is preserved. Search for `captureOperation`, `createRoutedHindsightClient`, `hindsight-transport-scope` and `hindsight-connection-verification` under `packages/core/src` returned no matches after withdrawal.

Exact current content hashes/statuses are in `artifacts/configuration-runtime-20261109/hindsight-withdrawal-20261110/withdrawal-verification.json`. Pre-withdrawal source copies and SHA-256 manifest are under the same directory (`files/`, `manifest.json`): 24 files, 241394 bytes. Baseline-content equality was checked after normalizing LF/CRLF only. The final Git diff in the Hindsight directory is five inherited files, 39 added / 20 removed lines.

## Retained shared changes requiring next-owner awareness

- `packages/core/src/memory/canonical-memory-run.ts` and
  `canonical-tools/canonical-memory-tools.ts`: additive optional numeric `intentionsDefaultDays` capture for Local
  admission. Omission keeps `DEFAULT_INTENTIONS_DAYS` exactly as before; current Hindsight callers pass no override.
  The shared tool factory reuses `canonicalLayerRetention` for equivalent default projection. A deterministic
  Hindsight-capability fixture checks the unchanged omitted-override default. No Hindsight folder or provider
  connection/sync/recovery/write implementation is edited for this Local/Legacy retention change.
- `memory-engine.ts` `TidyReviewOptions` has an additive optional `intentionsDefaultDays`; `tidy-pass.ts` forwards
  the already captured operation configuration before queued review execution. Only Canonical Local review tools
  consume it. Hindsight's existing review adapter ignores the new option, with unchanged default retention behavior.

- `packages/core/src/config/config-source.ts`: the owner-confirmed application-saved > environment > built-in default precedence remains. Hindsight's existing `resolveHindsightConfig` reads this shared source, so saved Hindsight values now outrank environment fallback. No special Hindsight-only precedence or silent Authority switch is added. Individual reset deliberately removes the saved override.
- `packages/core/src/memory/persona-provider.ts`: optional directory getter and `capturePersona` preserve admitted prompt content while later Runs may use the newly selected prompt directory. Hindsight foreground adapters use that shared helper; source files/Persona fallback behavior remain unchanged.
- `packages/core/src/secrets/secret-catalog-service.ts`: general Core empty/incomplete startup exception remains. A missing/failing first-use key helper leaves the catalog locked; create-only provision rereads the durable winner key. Explicit set/clear while locked attempts to reload the key source. This changes the shared catalog lifecycle, including availability seen by Hindsight, but does not change Hindsight key reference, fingerprint, endpoint, resolver or wire behavior. No unreadable ciphertext is replaced. The startup failure regression test remains in `secret-catalog-service.test.ts`; the last two explicit-reload lines were not independently tested before this handoff.
- `packages/core/src/memory/utility-slot.ts`: model availability and per-operation capture serve all Memory backends. Existing prior-session model getter/capture is preserved; this worker made missing Utility admission reject with `MODEL_UNAVAILABLE` instead of resolve `undefined`. No fake empty success or usage is recorded. Its queue/capture tests passed.
- `packages/core/src/memory/runtime-composition.ts`: parent owns generic configuration/readiness/index changes; only Local/Legacy may use new staged search rebuilding. Hindsight's original selected Authority and runtime must remain explicit; unavailable selected Hindsight must not become Local. This worker did not alter parent generic Memory code during withdrawal.
- `packages/core/src/main.ts`: grouped Main/Utility profile API, runtime capture, configuration observation, listener/perception integration remain. No Hindsight secret callback or new Hindsight transport API remains. Parent must keep the separate Hindsight task boundary in subsequent composition work.
- `packages/core/src/config/model-profile-secrets.ts` and migrations 070/071: ordinary Main/Utility credential ownership only. Explicit ownership records protect unrelated Secret Catalog entries, including `memory.hindsight.*`; no deletion by broad prefix/catalog enumeration.
- `packages/core/src/secrets/master-key.ts`: the native worker confirms only `windowsHide: true` was added to the existing synchronous helper get/create calls. Exported signatures, account defaults, catalog key derivation, create-only semantics, precedence and Hindsight secret references remain unchanged. The new `secrets/local-bootstrap-key.ts` is a separate asynchronous adapter used only by `devices/local-connection-auth.ts`; it uses `local-bootstrap-{Core host UUID}`, never the catalog master-key account. The start-Core wrapper discovers/injects the existing helper only when the operator did not set `TAKI_SECRET_KEY_HELPER`; this can make the general catalog usable where the helper was previously absent. Native `shell_store(data_dir)` preserves the existing literal-path namespace hash/service. No credential ACL or storage-format change was made. Existing master-key/device/connect checks (66 tests) and an isolated real helper concurrent-create/read/cleanup probe passed; no real user account was changed.

The next Hindsight task should start from these retained adapters and the restored fixed-connection behavior. It should not assume this withdrawn live-rebinding design is accepted or implemented.

## Provenance and recovery sources

- Worktree: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.
- The current-session worker initially inherited partial model/Utility/prompt capture changes. It later received an explicit parent assignment for Hindsight connection hot application; the owner has now narrowed that scope.
- The 2026-11-09 preimplementation backup is `artifacts/configuration-runtime-20261109/baseline/files/`, with per-file SHA-256 and byte lengths in `baseline/manifest.json`. It contains the preimplementation Hindsight files, but **predates the prior-session Utility/prompt capture changes**. Whole-file restoration from that backup would remove those earlier changes.
- `git diff` is also not a current-session delta: the worktree already contained unrelated and prior-session changes. Do not use blanket `git restore`, checkout, reset, or a baseline copy.
- Current-session edits are available as exact `apply_patch` actions in this worker conversation. The new hot-application files listed below did not exist before this worker's changes. No dedicated pre-Hindsight source copy was created before implementation. A complete bounded pre-withdrawal copy was created later and is listed above.
- Root's concurrent tokenizer/search hunks in `hindsight-runtime-state.ts` and `hindsight-memory-runtime.ts`, plus the new `hindsight-search-projection.ts`, have been removed. Root independently compared the resulting directory against the preserved preimplementation files: only the five retained adapters above differ, and no newly added Hindsight files remain.
- General progress checkpoint: `research/core-runtime-progress.md`. Its pending Hindsight assignment is superseded by this freeze.

## Historical inventory of the now-withdrawn hot-application changes

Paths below are relative to `packages/core/src/memory/hindsight/`. These changes altered internal behavior and have now been selectively withdrawn together. The table explains what was removed; the definitive current-state table above owns present status.

| File | Before | Current-session change and purpose | Withdrawal boundary |
| --- | --- | --- | --- |
| `hindsight-transport-scope.ts` (new) | No transport-generation owner | AsyncLocalStorage scope retains endpoint, credential value, timeout and fingerprint across a logical operation; current binding may be disabled or replaced | Remove after every consumer hook is removed |
| `hindsight-transport-scope.test.ts` (new) | No such tests | Real local HTTP endpoint/key capture plus multipart upload generation test | Remove or retain only as withdrawn experiment documentation |
| `hindsight-connection-verification.ts` (new) | No live candidate verification | Read-only compatibility lineage and existing Bank namespace checks, with a final currentness check before publication | Remove after subsystem import/call is removed |
| `hindsight-live-connection.test.ts` (new) | No such tests | Disabled construction/repair, timeout/disable capture, external-field isolation, wrong namespace and stale candidate tests | Remove with hot-application feature |
| `hindsight-runtime-connection.ts` | Construction required ready config; fixed connection/client/fingerprint; all config-fingerprint drift refused ongoing operations | Optional initial binding; captured secret string; routed client and connection facade; separate transport identity; operation/capture hooks; asynchronous `reconfigure`, verifier registration, availability; disabled/new-key-missing state leaves no current binding | All current-session changes here are the new hot-application feature; baseline comparison can guide exact inverse patch |
| `hindsight-client.ts` | One client factory with fixed endpoint and supplied secret resolver | Added exported `createRoutedHindsightClient`; per-dispatch selected endpoint/key supplied by operation scope | Remove only added factory; original transport/client code unchanged |
| `hindsight-runtime-state.ts` | Long-lived constructors received fixed timeout/client/fingerprint values | Timeout/secret marker getters; operation scope for bank service/writes/provider; explicit provider dependency object to avoid eager getter reads; fingerprint accessor | Remove these hunks only; preserve root tokenizer/search hunks pending root decision |
| `hindsight-runtime-consumers.ts` | Lifetime tracking of tool/recall calls | Captures transport operation at Run-memory admission; wraps retained tool and automatic-recall invocations/currentness in that scope | All current-session transport changes are removable independently of original lifetime owner |
| `hindsight-memory-runtime.ts` | Existing foreground consumers had no transport scope | One changed constructor call: `createHindsightRuntimeConsumers(state.runtime.captureOperation)` | Revert that argument only; preserve inherited prompt capture and root search edits |
| `hindsight-memory-provider-context.ts` | String fingerprint captured once | Fingerprint may be an accessor; runtime capability evidence resolves it inside operation; optional `operation` dependency | Remove added transport type/hook and restore fixed fingerprint semantics |
| `hindsight-memory-provider.ts` | Tracked provider action invoked directly | Provider action enters optional operation scope before awaits | Remove only operation dispatch wrapper |
| `hindsight-memory-write-context.ts` | No operation scope dependency | Adds optional typed `operation` port | Remove import and field |
| `hindsight-memory-writes.ts` | Tracked write action invoked directly | Write lifecycle enters optional operation scope | Remove only operation wrapper |
| `hindsight-runtime-bank-service.ts` | Existing per-Bank queue owns sync/recovery lifetime | Adds optional scope around action before queue/await so sync and pending recovery keep transport | Remove import/field/wrapper; preserve existing queue implementation |
| `hindsight-ingestion.ts` | Prior-session Utility model capture already existed | Adds optional transport capture port and captures it before per-Character enqueue for run/maybeRun | Remove transport import/field and wrappers only; retain prior-session Utility capture |
| `hindsight-policy-curator-context.ts` | Curator model/config already operation-scoped | Adds optional transport capture port | Remove import/field |
| `hindsight-policy-curator.ts` | Prior-session Utility/config capture already existed | Captures transport scope before queued curator execution | Remove transport local and wrapper only |
| `hindsight-replica-scheduler.ts` | Existing one scheduler claims work while started | Adds availability gate, `availabilityChanged` wake, operation scope around entire run/reset execution | Remove these added fields/method/gates/wrapper; preserve original scheduler ownership |
| `hindsight-memory-subsystem.ts` | Fixed runtime construction and start required `assertConnection` | Installs verifier; passes scope to ingestion/curator/scheduler; exposes `available`/`reconfigure`; starts scheduler without connection assertion | Remove these hot-application hunks; preserve inherited `captureConfig`/`currentPromptDir` forwarding |
| `hindsight-memory-reflect.ts` | Saved fixed fingerprint in admission evidence | Handles fingerprint accessor to agree with captured generation | Restore original string use when provider context change is withdrawn |
| `hindsight-memory-reflect-deadline.test.ts` | Timeout edit during Reflect expected authority-mismatch refusal | Changed case to retained successful operation/new timeout; added actual authority-lineage retirement refusal | Restore old contract test if hot application is withdrawn; authority retirement addition can remain if it verifies original behavior |

The existing `hindsightConnectionFingerprint` function, wire schemas, B3/G1 receipt algorithms, Authority tables, Bank creation, migration/activation, and external Hindsight service code were not modified by this worker.

## Cross-cutting secret and composition changes

| Exact path | Before | Current-session change | Classification |
| --- | --- | --- | --- |
| `packages/core/src/server/methods/secret-methods.ts` | Persisted secret mutations returned directly | Optional `onChanged(secretRef)` after successful set/clear; catches observer failure and logs a closed code; never forwards values | Added specifically for Hindsight live key reconfiguration; withdraw hook if that feature is removed |
| `packages/core/src/main.ts` | `registerSecretMethods` had service/logger only | Added callback for exactly `memory.hindsight.connection.api-key`, invoking existing config-change callback with `TAKI_HINDSIGHT_ENDPOINT` | Withdraw this callback only; do not revert main or model-profile/listener/perception integration |
| `packages/core/src/secrets/secret-catalog-service.ts` | First-use helper read/create exceptions could prevent Core boot; no reload on set/clear while locked | Catch helper failures into locked state; after create attempt reread durable key rather than assume generated value won; latest small change retries locked source on explicit set/clear | General empty/incomplete Core startup and model-profile credential recovery, not Hindsight-specific. Still a shared key lifecycle change and must be separately reviewed/documented; latest locked mutation retry not yet tested |
| `packages/core/src/secrets/secret-catalog-service.test.ts` | Existing durable envelope tests | Added first-use key provisioning failure test: locked, no catalog file, no secret value in logs | General startup regression; can remain if corresponding exception is accepted |
| `packages/core/src/memory/runtime-composition.ts` | Prior-session model/prompt/Memory config adaptation | This worker added only optional `application?: ConfigApplicationTracker` import/type and passed it from main; parent now owns additional policy/search/Hindsight integration | Do not restore the file. Parent must remove any calls to withdrawn Hindsight `reconfigure`/`available` hooks |

The model-profile Secret Catalog staging service, `model_profiles` migration 070, `model_profile_secrets` migration 071, grouped Main/Utility APIs, and Main model capture remain ordinary Core/profile scope. They do not manipulate `memory.hindsight.*` references. Model orphan cleanup uses explicit ownership rows and must not enumerate/delete other catalog owners.

## Inherited changes, not new hot-rebind work

These were present when the worker first read the files in this session. They are missing from the older 2026-11-09 baseline and must not be accidentally removed by restoration:

- `hindsight-ingestion-lifetime.ts`: Utility `model` becomes lazy; forwards availability; `capture()` guards a captured Utility slot. This worker did not modify the file.
- `hindsight-ingestion.ts`: `captureUtilitySlot` and one captured gate model before logical ingestion admission; unavailable automatic ingestion does not consume sources.
- `hindsight-policy-curator.ts`: captures Utility model and policy once for the queued operation; automatic work skips unavailable Utility.
- `hindsight-memory-runtime.ts`: optional `currentPromptDir`/`captureConfig`, captured Persona/config before asynchronous capture, retained assembly.
- `hindsight-memory-subsystem.ts`: optional capture/prompt getters forwarded into foreground and curator config.
- Shared `memory/utility-slot.ts`, ordinary Memory constructors and private-summary capture were also inherited. This session changed missing-Utility `run` from resolved `undefined` to explicit `MODEL_UNAVAILABLE`, and added retention/queue tests. That is a cross-provider model-readiness change, not transport hot-rebind.

## Historical experiment evidence and limits

- Before the hot-rebind work, Core typecheck passed; grouped profile real-process evidence is recorded in `core-runtime-progress.md` and remains separate.
- Hindsight existing focused suite after initial hot-rebind: 64/65 tests passed. The sole failure was the old timeout-change-as-authority-mismatch expectation. It was changed to the new hot-application requirement, not an unrelated assertion deletion.
- Subsequent `hindsight-live-connection.test.ts` plus `hindsight-memory-reflect-deadline.test.ts`: 18 tests passed, including actual lineage retirement refusal.
- Subsequent `hindsight-transport-scope.test.ts` plus `hindsight-live-connection.test.ts`: 7 tests passed. Transport test uses real loopback HTTP; multipart test uses existing deterministic byte-client fixtures. No real Hindsight server or model was contacted.
- Last scoped ESLint command covered 16 changed production Hindsight files plus `main.ts`; it passed. It ran after the optional initial missing-key binding change.
- The last Core typecheck before freeze reported in-progress hot-rebind type errors. That experiment evidence is historical; the post-withdrawal typecheck result below supersedes it for the actual delivered tree.
- No Hindsight wire capture, paid endpoint, real profile, real keyring mutation, or user acceptance was performed. No commit/push/archive occurred.

## Executed withdrawal procedure

1. Preserve this inventory and parent tokenizer inventory; inspect current hunks to distinguish both authors.
2. Remove main's Hindsight secret callback and optional secret-method observer hook; remove parent outer calls to hot-rebind methods.
3. Invert the exact current-session transport integration hunks in existing files. Preserve inherited Utility/prompt captures and parent-owned edits until their owner decides.
4. Remove the four new hot-rebind modules/tests only after all imports are gone.
5. Restore the old Reflect timeout contract test and run focused pre-existing Hindsight tests and Core typecheck.
6. Decide explicitly whether the general Secret Catalog startup exception remains necessary. Record the decision here, including the durable reread and locked mutation retry behavior; do not treat it as a Hindsight-specific change by omission.

Current status: selective withdrawal completed; new Hindsight internal hot-rebind/search changes removed; inherited Utility/prompt adapters and shared general Core changes retained as explicitly listed. Final post-withdrawal validation results are recorded below.

## Post-withdrawal validation

- `pnpm --filter @taki/core typecheck`: passed, exit 0.
- `pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-application-cold-recovery.test.ts src/memory/hindsight/hindsight-memory-reflect-deadline.test.ts src/memory/hindsight/hindsight-derived-input-admission.test.ts src/memory/hindsight/hindsight-foreground-recall-lifetime.test.ts src/memory/hindsight/hindsight-runtime-bank-service.test.ts src/memory/hindsight/hindsight-replica-scheduler.test.ts`: 6 files, 65 tests passed; 25.98 seconds. These are pre-existing behavior suites after withdrawal, including the restored fixed-connection timeout refusal.
- Live diff check: exactly the five inherited Hindsight files shown above remain changed; no added Hindsight source/test files remain. Original client/connection/provider/sync/recovery/scheduler/Reflect implementation content matches the preimplementation backup after LF/CRLF normalization.
- No new hot-rebind identifiers/imports remain under `packages/core/src`. `secret-methods.ts` has no remaining delta; the Hindsight key-change callback is absent from main.
- This is focused deterministic regression and type validation. It is not real Hindsight server, native model, full-repo or owner acceptance. The historical tests for withdrawn experiments above are not delivery claims.

## Final shared observation and lifecycle adjustments

- The generic registry now labels 83 ordinary settings live and keeps the data root bootstrap-only. The separate
  application observation overrides that generic label for backend-specific behavior. In `main.ts`, changing a
  selected Hindsight endpoint/request timeout is explicitly shown as restart-required; inactive setup still reads
  its current saved values. No connection rebind, credential mutation, validation request or native deployment occurs.
- `runtime-composition.ts` reports Hindsight BM25 as inapplicable and reserves stoplist/default-intention policy
  replacement for the dedicated task. Local/Legacy projection metadata and migration 072 never access Hindsight FTS.
- Shared runtime shutdown retains the original same-Promise identity and immediate admission sealing for Hindsight.
  New Local/Legacy index cancellation joins that lifetime without changing the Hindsight producer.
- Full-root lint currently reports the retained `createHindsightMemoryRuntime` function at 53 executable lines
  against the 50-line guard. It was deliberately not refactored just to satisfy that cosmetic limit during the
  dedicated task's ownership. This is an open quality-gate item, not a withdrawn-feature runtime claim.
