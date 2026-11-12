# SDK upgrade execution plan

Status: authorized to start; global-rule validation and independent readiness review have passed. The coordinator activates this child before dispatch.

1. Review parent decisions and the completed upgrade report; recheck cwd/branch/task identity and touched-file changes. Load backend development/spec context.
2. Capture preimages/hashes, Node/pnpm versions and actual package resolution; record pre-existing lock changes. Run the focused existing compatibility baseline identified in the report, plus an isolated real Node Core boot with disposable task-owned data, nonstandard port and no model credentials/inference. Stop only owned processes.
3. Generate a narrow proposed lock change with `pnpm --filter @taki/core add --save-exact ai@7.0.148 @ai-sdk/mcp@2.0.81 @ai-sdk/openai-compatible@3.0.75 --lockfile-only`. Inspect all drift against the saved working lock, including provider/provider-utils, gateway and new `undici` resolution. Then install the reviewed lock with `pnpm install --frozen-lockfile`. These commands have not run.
4. Apply only evidenced compatibility fixes; run the same focused checks and real Node boot smoke, resolving introduced failures. Add only meaningful reachable-change cases; unused SDK timeout/capped-concurrency options do not require exhaustive probes.
5. Run the required type/lint/test and platform checks appropriate to the changed scope, following the verified command list in the report. Record pre-existing failures honestly.
6. Read back installed/locked versions and final diffs, review rollback procedure and hand evidence to the parent. Continue only within the owner's stated execution scope; a successful check alone is not authorization for a new stage.

## Completion checklist

- [ ] Owner instructed formal start and this child was activated.
- [ ] Pre-upgrade snapshot and baseline recorded.
- [ ] Exact package delta and necessary adapters reviewed.
- [ ] Focused and required verification recorded.
- [ ] Parent received evidence and remaining constraints.

No live paid model call, new runtime adoption, commit, push or archive is authorized by this plan.
