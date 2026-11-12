# SDK upgrade execution plan

Status: upgrade and owner-approved cancellation policy applied on 2026-10-22; final gates and independent review passed. SDK implementation acceptance is complete. The session-scoped child remains active until coordinator transition; no archive/commit is implied. [Current evidence](research/implementation-report.md) is authoritative over earlier interrupted logs.

1. Review parent decisions and the completed upgrade report; recheck cwd/branch/task identity and touched-file changes. Load backend development/spec context.
2. Capture preimages/hashes, Node/pnpm versions and actual package resolution; record pre-existing lock changes. Run the focused existing compatibility baseline identified in the report, plus an isolated real Node Core boot with disposable task-owned data, nonstandard port and no model credentials/inference. Stop only owned processes.
3. Generate a narrow proposed lock change with `pnpm --filter @taki/core add --save-exact ai@7.0.148 @ai-sdk/mcp@2.0.81 @ai-sdk/openai-compatible@3.0.75 --lockfile-only`. Inspect all drift against the saved working lock, including provider/provider-utils, gateway and new `undici` resolution. Then install the reviewed lock with `pnpm install --frozen-lockfile`. Both commands completed; retained logs and inventory identify the actual graph.
4. Apply only evidenced compatibility fixes; run the same focused checks and real Node boot smoke, resolving introduced failures. Add only meaningful reachable-change cases; unused SDK timeout/capped-concurrency options do not require exhaustive probes.
5. Run the required type/lint/test and platform checks appropriate to the changed scope, following the verified command list in the report. Record pre-existing failures honestly.
6. Read back installed/locked versions and final diffs, review rollback procedure and hand evidence to the parent. Continue only within the owner's stated execution scope; a successful check alone is not authorization for a new stage.

## Completion checklist

- [x] Owner instructed formal start and this child was activated.
- [x] Pre-upgrade snapshot and baseline recorded.
- [x] Exact package delta and necessary adapters reviewed.
- [x] Focused and required automated verification recorded.
- [x] Parent received current evidence and remaining constraints.

## Recovery checkpoint

- All 2,091 source hashes and six manifest/config hashes matched the interrupted `target-final` snapshot before recovery. Recovery changed only the documented per-file line allowance, plus this child's documents/evidence.
- The incomplete `target-final` run is retained: typecheck passed, lint reported 363 > 360, and the Core test result was absent. Completed replacement results live under `research/recovery/`.
- `pnpm -r typecheck`, root `pnpm lint`, `pnpm -r test --maxWorkers=4`, Clippy and Rust tests passed. The baseline and target compare the same four-worker configuration; default-concurrency baseline failures are retained, not relabelled as target regressions.
- `research/recovery/sdk-scope.diff` and `source-complete.json` identify the complete nine-file patch against the captured working baseline. Reverse application to task-owned copies restored seven original files byte-for-byte and removed the two task-created files. Actual worktree/installed dependency rollback was not performed.
- The independent real-fetch defect was reproduced, and the owner approved `research/recovery/cancel-policy-proposal.md`. Its Core cancellation guard is applied; the ineffective observer and line exception are removed. Exact primary witnessing remains in the original finally path.
- The final net patch now covers 15 source/config/spec paths under `research/final/`. Maintained real HTTP/WS regressions verify nine scenarios, including image maintenance, prefill/partial persistence, notifications, cancelled Run/Receipt/activity and completed-tool no-replay. Final focused checks passed 69 tests; current gate replacements are under `research/final-verified/`.
- Final result: `research/final-verified/results-typecheck-lint-tests-bounded.json` records typecheck/lint/bounded tests all exit 0, with 5,968 TS tests passed and two existing skips. `research/final/independent-review.md` passed against all 15 final hashes. Earlier failed fixtures/expectations remain in evidence; the approved policy, rather than the old transport-dependent maintenance/throw expectation, is the acceptance contract.
- No implementation work remains in this SDK child. Live/external-provider, packaged desktop and owner UI/conversation acceptance are not claimed; delegation/source behavior belongs to subsequent parent-owned work.

No live paid model call, new runtime adoption, commit, push or archive is authorized by this plan.
