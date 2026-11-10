# Core runtime implementation checkpoint

Updated 2026-11-10. Task authority is the explicit session task `11-09-installation-user-experience`; the legacy global pointer is stale. Work remains in the T4 worktree on `task/t4-skills-mcp-productization`. No commit, push, archive or real profile/keyring edits.

## Verified vertical path

- Isolated real Core startup probe: empty, keyless and configured profiles all listen with zero provider requests. Keyless/configured chat completes against a local scripted HTTP provider. Evidence: `artifacts/configuration-runtime-20261109/after-core/baseline.json`.
- Isolated profile journey: incomplete draft/reconnect; keyless activation/reply; held and queued A retain model/key/prompt; same-conversation B uses new model/key/prompt; persisted Attempt identity agrees; failed candidate and conflicting edit preserve active B across a real process restart; disable, independent Utility, inheritance and reset are distinct. Evidence: `artifacts/configuration-runtime-20261109/live-profiles-305e5d16-23fa-427e-b164-bb88d93e1922/evidence.json`.
- Latest focused check: 6 files / 53 tests passed for model profiles, runtime policy capture/calibration, Utility binding, snapshot-before-await, secret startup and scheduler existing behavior. Earlier focused capabilities/secret suite: 6 files / 63 tests passed. Core typecheck passed before the latest small test/staged-secret changes; repeat pending. Scoped lint found one function line threshold, since refactored; repeat pending.

## Implementation changes

- Existing profile service/protocol/migration 070 is wired into real Core. Scalar legacy edits bridge to grouped candidates without cross-endpoint credential reuse; individual reset keeps explicit grouped mode and selects the actual scalar fallback.
- Migration 071 adds explicit staged-secret ownership. Crash reconciliation reads durable profile rows and removes only journaled orphan references; unrelated catalog entries remain untouched. Credential strings already captured in provider handles survive catalog cleanup for admitted Runs.
- Main capture is immutable at Run admission before Memory awaits. Policy/calibration identity includes profile revision; old late usage/overflow cannot mutate the new binding. Utility keeps its existing one serial queue and captures before queue wait. Unavailable Utility is an explicit refusal, not synthetic successful empty output.
- Model capability reads use active profile identity. Inherited Utility auth status reflects Main credentials. Profile status projects truthful scalar application observations.
- Main now integrates the parent-owned application tracker/listener controller, live logger/trust/attachment/ambient policy, and readiness on scheduled/initiative/media admission. Root owns invalid feature/Memory policy isolation and tokenizer/reindex application.
- Missing/unusable first-use secret-key provisioning leaves catalog locked and basic configuration services usable; exact existing ciphertext is preserved.

## Pending work and limits

Final integration update: Core full suite passed 582 files / 4775 tests (6 skipped); all workspace typechecks pass.
Root completed Local/Legacy projection/policy integration and actual final-Core control-plane probes. Current evidence
and the remaining Hindsight/manual/lint limits are consolidated in `delivery-20261110.md`; older pending bullets
below describe the intermediate worker handoff rather than the final integration state.

- Finish current focused lint/typecheck and new staged-secret regression verification; update indexes/specs; rerun real profile probe after final integration.
- Validate scheduler no-model claim/timer behavior, required cleanup and remaining startup feature isolation with the root integration.
- Owner scope correction: the new Hindsight hot-application work was selectively withdrawn. The dedicated handoff `research/hindsight-change-inventory-20261110.md` owns exact restored paths, five inherited Utility/prompt adapters, retained shared Core effects and validation. Post-withdrawal Core typecheck and 65 pre-existing Hindsight tests pass. Do not resume Hindsight internal implementation under this task.
- Root completed canonical/legacy tokenizer/index maintenance and memory policy recovery; Hindsight index/runtime
  application remains reserved for the dedicated task and must not be resumed through this handoff.
- Human/native UI and paid-model acceptance remain separate. No paid model was called. H: filled during another worker's Rust build; only small source/check writes continue; large builds moved to G:.
