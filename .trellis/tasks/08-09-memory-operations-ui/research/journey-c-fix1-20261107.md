Updated only `native-smoke.mjs`. Verified the diagnosis: authority commit precedes awaited Bank preparation and operation completion. [source packages/core/src/memory/hindsight-activation/hindsight-activation-service.ts:172] [source packages/core/src/memory/hindsight-activation/hindsight-activation-service.ts:181]

Diff hunks, relative to the assigned `first-use-runtime/` directory:

- [source native-smoke.mjs:229] Preserve the operation observed when Home becomes ready, then await terminal state through `awaitOperation(..., ACTIVATE_MS)` using **600 seconds** before asserting `completed`.
- [source native-smoke.mjs:241] Record receipt commit time, operation terminal time and `commitToCompletionMs`; missing receipt timing remains `null`.
- [source native-smoke.mjs:245] Require the subsequent activation-status readback to report `completed`, rather than accepting any terminal state.

The real-model activation path already waits for terminal success before reading authority; no change needed. [source real-model-memory.mjs:178] [source real-model-memory.mjs:433]

**Check:** `node --check` passed. No journey or service was started.

No additional activation-order defect found in the scanned journey. Further failures are **UNKNOWN**: the leader’s run stopped before exercising steps 5 onward. [run results/2026-11-06T18-56-29.570Z/result.json]