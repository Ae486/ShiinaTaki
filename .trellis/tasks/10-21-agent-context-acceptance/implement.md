# Acceptance execution plan

Status: implementation, authorized live campaigns and final automatic checks are complete on 2026-10-23. Stopped before human acceptance as instructed by the owner. The [current acceptance matrix and evidence](research/acceptance-before-human-20261023.md) supersede the historical preparation/pause entries. The unfinished hindsight-taki version remains an external native-acceptance dependency; current native availability was not probed. No task archive, commit, push or main integration occurred.

1. Assemble prior child versions, tests and limitations; confirm the integrated build and scenario fixtures.
2. Run cross-boundary deterministic cases, including stopped parent, user-stopped child, duplicate completion, stale revision and compaction/restart.
3. Inspect model-bound requests produced by the actual pipeline and compare with source-retention expectations.
4. Execute authorized bounded live-model scenarios using recorded provider/model/settings and before/after comparison where possible. Mark unrun cases explicitly.
5. Present the child conversation and Co-Watching paths for owner trials, preserving pending playback issues and recording only actual owner confirmation.
6. Summarize parent AC01-AC11 as pass/fail/unverified with links; route failures to the owning child and rerun only affected gates plus required integration checks.
7. Report the final scope, evidence, limitations and rollback readiness. Do not commit, publish or archive without separate authorization.

## Completion checklist

- [x] T4 dependency and deterministic gates satisfied; native Hindsight and main convergence remain explicitly separate.
- [x] Actual request evidence inspected.
- [x] Authorized live-model results recorded, including failed attempts.
- [ ] Owner trials: intentionally not started; wait for the owner's next instruction.
- [x] Parent acceptance matrix reviewed with scoped evidence and human gates unapproved.
- [x] Remaining unverified boundaries explicitly listed.

## Historical recovery implementation checkpoint (2026-10-23)

The existing acceptance child is now `in_progress` for authorized fixture preparation; the coordinator's session remains bound to Runtime. The production-feature and live gates above remain pending.

- Extended `e2e/src/fixture/real-provider-observer.ts` with explicit synthetic request capture and a finite upstream-attempt budget. Default diagnostics still omit prompt/response content. Capture failure or budget exhaustion is an explicit refusal before upstream HTTP; the exact original body is otherwise forwarded unchanged.
- Three new local HTTP regressions first failed against the original observer; the final observer suite passes all 12 tests. `research/recovery-20261023/observer-red.json` and `observer-final.json` retain that distinction. The combined fixture discovery run passes those 12 tests and skips the one unenabled real-model case; a skipped case is not acceptance.
- `e2e/src/fixture/agent-context-scenario.ts` composes existing canonical Local seeding, production Core entry, authenticated RPC and real-provider relay. It saves exact synthetic requests, concurrent Effect candidates, per-phase runtime/Memory state, requested/reported model facts and source hashes. Concurrent Effect candidates are not claimed to be exact request correlation. Each scenario has a request cap and four-minute process/provider deadline, and retains failed evidence.
- `e2e/src/agent-context-real.e2e.test.ts` prepares R1 selected summary, addressed correction and explicit same-child reuse through actual product tools and RPC. It checks new terminal Runs, actual input receipts, no copied unrelated parent marker, no private correction in the relationship Timeline and no parent continuation for record-only work. It is not yet run against a live model. Current fixture typecheck and scoped ESLint pass.
- The real suite requires both `TAKI_E2E_REAL_AGENT_CONTEXT=1` and supported provider-file credentials, plus an explicit `TAKI_E2E_EVIDENCE_DIR`. Ordinary package execution cannot enable it. Keep the existing prior connectivity baseline; new feature trials follow stable Runtime/Source gates and use a new evidence directory.
- R2 controls/parent continuation, R3 executable Memory boundaries, source A1-A3, Co-Watching composition and integrated final checks still require their completed production interfaces and acceptance cases. No coverage is inferred from fixture compilation or R1 preparation.
