# W5 reentry helper implementation checkpoint

Scope: task-owned helper repair only, authorized by parent on 2026-10-04. No new task,
production Core/native source, dependencies, credential change, timing change, lifecycle
operation or live pair access. Current task pointer is empty; parent explicitly supplied
`.trellis/tasks/09-29-hindsight-transitions-emergency` and its PRD/manifests are loaded.

Preimages: `w5-reentry-helper-preimages-20261004/`, including immutable SHA256 manifest.
No original results, earlier manifests or acceptance evidence may be overwritten.

Accepted parent-supplied anchor: completed RETURN operation
`ce841c61-d207-4f51-b1fd-51cd42ed9d9e`, transition
`df47f32c-48a8-47bc-9792-2e24e8642084`, receipt
`e173dffd3612e5932f50a1df5ae7c1c1b4f7ee3d269dce9a11828debd77a8469`,
Local epoch `afb2053e-8bcd-4322-8573-0a447d560bb8`, cumulative model count 301.
These facts are not independently re-audited here. Parent owns the stopped pair.

Implementation seams:

1. `w5-reused-driver.mjs` consumes a versioned atomically replaced journey checkpoint.
   Exact RETURN receipt/candidate/Bank identities and the full intended Local mutation
   requests are persisted before effects. Canonical policy receipts and exact original
   versus intended Block states reconcile lost replies. Malformed state fails closed.
2. Persist preview/request before submit, reconcile exact durable operation request and
   producer; preserve earlier attempts and use normal explicit recovery for unknowns.
   Refresh current attempt during waits without changing lease or poll duration.
3. A task-only `TransitionMaintenanceService._execute_attempt` wrapper reads the actual
   prepared run, writes a sanitized exact-plan review, then denies unless an explicit
   per-Bank approval matches transition/candidate/required-set and finite cumulative cap.
   Native `_prepare_transition`, incomplete handling, proof, Core unknown and sequence
   remain unchanged. First staged launch denies all reentry maintenance.
4. Exact Bank + verification ID inspection and separately labeled per-Bank forecasts;
   no ordinal fallback or historical 240/83 budget. Preserve counter and billing latch.
5. Strengthen final Source, zero-payload delta, Bank baseline, policy, Block and original
   invalidated identity/lifecycle assertions while allowing derived maintenance changes.

Validation plan: fresh task-owned synthetic SQLite fixtures and zero-model tests only;
mocked native owner/storage at the actual service seam if sufficient, separate owned PG
only after a design message to parent. Sequential checks, maxWorkers=2. No full Core gate,
real corpus or model calls.

Final delivery: implementation is complete; independent review is next. See
`w5-reentry-helper-implementation.md` and `w5-reentry-helper-source-manifest.json`.
Final focused checks: Node 10/10, Python 5/5, 13 quality/source-preservation checks.
Guard-before-engine-initialize and default model-network denial have a focused supervisor
test. Admission-before-first-claim remains a reproduced, parent-accepted fail-closed
production limitation; no fabricated attempt or scope expansion. Real pair untouched.
