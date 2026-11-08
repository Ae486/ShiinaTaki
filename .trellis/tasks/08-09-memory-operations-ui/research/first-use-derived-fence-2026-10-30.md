# First-use journey: pending recovery fails with HINDSIGHT_DERIVED_FENCE_UNAVAILABLE (2026-10-30)

Run: `research/first-use-runtime/results/2026-10-30T05-07-50.499Z`, step `pending`.

## Classification

**Product defect** (Core). Not transient, not a fixture defect: retrying can never succeed, because the row is in a
phase that only an injected derived-completion port can settle, and production wires none.

## Evidence chain

1. Recovery `cc16dc69…` failed `producer_failed / HINDSIGHT_DERIVED_FENCE_UNAVAILABLE / explicit_retry_required` [log: result.json steps[pending].error].
2. Owned DB `G:/taki-first-use-Q6mqCZ/core-data/taki.db` (read-only query) `pending_memory`:
   - seq 1, global Bank, retain, `awaiting_derived`, diag `HINDSIGHT_DERIVED_FENCE_UNAVAILABLE`, `dispatch.protocol=legacy_native_v1`, native receipt present, dispatched 05:11:59 (step 6, not the faulted write).
   - seq 2, mika character Bank, retain, `submitted`, `legacy_native_v1`, `HINDSIGHT_PENDING_REMAINS`.
   - seq 3, global Bank, retain, `outcome_unknown`, `legacy_native_v1`, dispatched 05:14:02 — the write the fault 503'd.
   All three rows used the legacy protocol [log: DB query].
3. Legacy dispatch is selected when `dispatch` is undefined [source packages/core/src/db/pending-memory-transition.ts:93], which happens when `nativeResultSupported` is false [source packages/core/src/memory/hindsight/hindsight-pending-replay.ts:40,46].
4. `nativeResultSupported` allowlists builds G1…template-lifecycle but not `HINDSIGHT_TEMPLATE_BACKUP_BUILD` [source packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts:130-147 pre-fix]. Every other capability gate already accepts it [source hindsight-template-capability.ts:14, hindsight-transition-capability.ts:16, hindsight-configuration-service.ts:180, hindsight-application-capability.ts:33].
5. The Native under test reports `taki-memory-hindsight-0.9.0-template-backup-v1` [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/taki_compatibility.py:39] and still advertises `native_results` supported/`all_contracts_available` [source taki_compatibility.py:294,314].
6. Legacy retain → `resolvePendingRetain` → `native_completed` → `awaiting_derived` [source hindsight-pending-replay.ts:72-73; pending-memory-transition.ts:47-50] → `checkOneDerived` calls the default port [source hindsight-pending-recovery-runner.ts:62; hindsight-pending-recovery-stages.ts:64], which always throws `HINDSIGHT_DERIVED_FENCE_UNAVAILABLE` [source hindsight-derived-completion.ts:15-17]. The runner then throws the row's diagnostic [source hindsight-pending-recovery-runner.ts:76-79].
7. Contract: legacy rows retaining `awaiting_derived` + `HINDSIGHT_DERIVED_FENCE_UNAVAILABLE` is the documented *base case only for providers that cannot supply the fence* [spec .trellis/spec/backend/memory-replica-sync.md:311-314,336]; the tracked G1 path (`native_factual` → `awaiting_pull`) needs no derived fence [source hindsight-pending-native-result.ts:52-55]. So for a G1-capable Native, the legacy path is wrong, and no wait/retry contract exists that would settle it.
8. Fault side note: the fixture only 503s `POST /banks/*/memories` [source native-fault.mjs:13], i.e. the legacy endpoint. With the fix, writes go to `/ext/taki-memory/banks/*/retains`, so `ctx.fault.rejected()` may stay 0 and the step's `fault never reached a Native write` check may fail [inference]. That is a separate fixture adjustment the leader must decide (fault the tracked `/retains` endpoint); not changed here per scope.

## Fix

```diff
@@ hindsight-pending-recovery-runner.ts imports
   HINDSIGHT_TEMPLATE_BUILD,
+  HINDSIGHT_TEMPLATE_BACKUP_BUILD,
@@ nativeResultSupported
-      || manifest.source_identity.compatibility_build === HINDSIGHT_TEMPLATE_BUILD)
+      || manifest.source_identity.compatibility_build === HINDSIGHT_TEMPLATE_BUILD
+      || manifest.source_identity.compatibility_build === HINDSIGHT_TEMPLATE_BACKUP_BUILD)
```

Regression: `hindsight-pending-recovery.test.ts` "dispatches through tracked native results on the template-backup build
instead of the fenceless legacy path" — template-backup manifest with `native_results`; asserts the row's dispatch is
`tracked_native_v1` and no legacy `POST /memories` occurs. Verified red without the fix
(`expected 'legacy_native_v1' to be 'tracked_native_v1'`), green with it.

## Files touched

- `packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts` (+3/-1)
- `packages/core/src/memory/hindsight/hindsight-pending-recovery.test.ts` (1 test, 1 import line)

## Checks

- `pnpm exec vitest run src/memory/hindsight/hindsight-pending-recovery.test.ts --maxWorkers=2` → 38 passed (38).
- `pnpm -C packages/core exec tsc --noEmit` → no output, exit 0.
- No runtimes started; DB was only read.

## Trade-offs

- Kept the existing per-build allowlist shape instead of replacing it with a shared "G1-capable builds" constant; the
  duplication across capability gates is what allowed the drift, but consolidating is a refactor outside scope.
- Rows already persisted as `legacy_native_v1 / awaiting_derived` in the retained DB stay stuck by design (no
  redispatch of known-successful writes, spec :312-313). A fresh rerun is required; old DBs are not migrated.
- Fixture fault endpoint (finding 8) left untouched; the rerun may need it to target `/retains`.
