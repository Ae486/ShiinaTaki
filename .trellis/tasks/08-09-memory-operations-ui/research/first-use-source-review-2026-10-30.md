# First-use consolidated source review: 2026-10-30

## Recovery checkpoint

- Reviewer session resumed the interrupted consolidated review in `H:/TakiAgent` on the existing
  `08-09-memory-operations-ui` task. The repository has extensive inherited tracked and untracked
  work; this review owns only proven fixes in the key, fresh-validation and per-Bank replica settings
  paths plus this record.
- At this initial checkpoint, the first-use requirements, current design/execution plan and continuation
  record had been loaded; applicable specs and the prior interrupted review were still being read.
- At this checkpoint no source finding had been accepted and no product code had been changed by this
  review. Later sections record the completed review and fixes.
- Heavy lint, type-check and test runners had not been started. Root coordination was required first.
- Overall first-use acceptance remains open. No Home/Native connected journey, packaged Tauri run,
  owner UI acceptance, real credential/data use or paid-model observation is claimed here.

## Review progress

- Fixed one source-proven desktop deadline classification defect: the newly exposed `secret.presence`
  read previously inherited the conservative mutation default, so a read timeout was marked as an
  unknown write outcome. The method table now classifies presence as an interactive read and pins
  `secret.set`, `secret.clear` and `memory.replica.configure` as interactive mutations. A focused
  policy regression covers all four methods.
- Fixed a stale-write edge in the new per-Bank form: `memory.authority.status` intentionally preserves
  its last-good frame during a refresh or read error, but the new complete-config save remained enabled.
  That could overwrite a newer cross-client configuration with stale intervals. The settings form now
  stays visible but disables its controls/save while the authoritative refresh is pending or failed;
  existing sync, lifecycle and backup action policy is unchanged.
- Removed duplicated Hindsight connection secret references from the new Settings controller and the
  effective Core configuration projection. Both now use Shared's
  `HINDSIGHT_SECRET_REFS.connectionApiKey`, the same fixed slot consumed by Core/Host custody, so UI
  writes, runtime configuration and secret resolution cannot silently drift to different entries.
- Source review of the key controller/form, fresh `unconfigured` validation eligibility, strict replica
  RPC schema, current-runtime admission, scheduler persistence/rearming and shared invalidation channel
  is complete. No runtime-capture/admission files or first-use fixture files were changed.

## Findings fixed

### Desktop request deadline classification

- Files: `apps/desktop/src/lib/rpc-deadline.ts`, `rpc-deadline.test.ts`, `index.md`.
- Issue: `secret.presence` is a read, but the newly exposed method was absent from the deadline table
  and inherited the conservative unknown-outcome mutation policy. This contradicted the operator
  connection contract's read/write timeout distinction.
- Fix: classify presence as an interactive read and explicitly pin `secret.set`, `secret.clear` and
  `memory.replica.configure` as interactive mutations. Add focused policy assertions.

### Stale complete-config save

- Files: `apps/desktop/src/windows/home/pages/operations/memory-authority-card.tsx` and its test.
- Issue: the card correctly preserves a last-good authority frame during a background refresh/read
  failure, but the new form remained writable. Because the RPC sends the complete schedule, a stale
  frame could replace a newer cross-client mode or interval after its invalidation refresh failed.
- Fix: keep last-good settings visible while locking only the new settings form during `loading` or
  `error`. Existing synchronization, lifecycle and backup action policy is unchanged. Add render
  regressions for refresh and read-failure states.

### Duplicated Hindsight connection secret reference

- Files: `apps/desktop/src/windows/home/pages/settings/hindsight-key-controller.ts`,
  `packages/core/src/config/hindsight-config.ts`, and `packages/core/src/config/index.md`.
- Issue: the new Settings form and Core's effective projection repeated the catalog key literal even
  though Shared already owns the seven fixed Hindsight refs. A future ref change could make Settings
  write one slot while runtime configuration/resolution used another.
- Fix: both consumers use `HINDSIGHT_SECRET_REFS.connectionApiKey` from
  `@taki/shared/hindsight-custody`.

## Consolidated source disposition

- Key path: the password value remains only in component state, is cleared on submit/client retirement,
  never enters read models or feedback, and set/clear/presence use strict value-free Shared results.
  Locked/unreadable/unsupported storage remains unknown and refuses mutation. Retired reads and writes
  are ignored without replay. Stored presence is not presented as connection validation.
- Fresh validation: Home now offers `setup.validate` for `unconfigured` only under Canonical Local with
  no open activation operation. The request carries the current setup revision. Core still owns
  authority, revision, idle and effective endpoint/key/config checks; no new readiness state or migration
  change was introduced.
- Per-Bank settings: the request is strict and complete, retains the existing one-minute, 31-day and
  90-day bounds, resolves the live runtime on every call, requires its scheduler to be started, checks
  the Bank and refuses an active memory transition. `ensureBank({ bank, config })` persists the existing
  schedule row. Scheduler rearming preserves active runs and exact queued manual requests; disabling
  automatic work clears only background due/retry state. New Banks retain the existing automatic,
  six-hour incremental and seven-day full defaults.
- Cross-client observation: successful configuration publishes only `memory.replica.changed { bankId }`
  through the existing connection-scoped `memory.operations.subscribe` membership. Home validates the
  notification, refetches `memory.authority.status`, removes handlers on retirement and never creates a
  memory operation event for the immediate edit.
- Folder indexes and production module headers cover the new files. No new local persistence, polling,
  secret logging, type-safety bypass, scheduler, operation ledger or authority writer was introduced.

## Findings not fixed

- The retained controlled journey still fails after activation at the first `chat.send` with
  `HINDSIGHT_APPLICATION_BANK_UNAVAILABLE`. Diagnosis/fix belongs to the separately owned runtime
  capture/admission work and was explicitly outside this review's file ownership.
- Actual Home/WS/Native first-use completion, bounded outage recovery, packaged Tauri/WebView2 behavior,
  real credential/data/model observations and owner UI acceptance remain unperformed or separately
  owned. Source review cannot close them.

## Verification

- `git diff --check` on the owned tracked files: pass (no output).
- UTF-8 BOM scan on the owned production/test files: pass (no BOM found).
- Forbidden-pattern source sweep for debug logging, browser persistence, polling and type-safety bypasses
  in the new key/replica modules: pass; the only textual `setInterval` matches were the form method name
  `setInterval`, not timer calls.
- Lint: not run. The shared heavy-runner rule requires Root coordination; a request with the exact scoped
  checks was sent, but Root and the runtime worker were interrupted by provider rate limiting before a
  slot was confirmed.
- TypeCheck: not run for the same coordination reason.
- Tests: not run in this continuation for the same coordination reason. Prior worker-reported results
  remain historical and are not relabelled as current verification.

