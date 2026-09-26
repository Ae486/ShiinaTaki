# windows/home/pages/operations/
The operations page: Local onboarding, Hindsight activation, the memory authority / Hindsight operations card, manual memory maintenance,
the memory/context status card, and storage usage with the D46 attachment purge. Every number comes from a WS read — the page computes nothing the Core owns.
- operations-page.tsx — page root: memory authority card, Local onboarding card, Hindsight activation card, tidy trigger + defect counts, status card, storage card; loading rides Skeleton and the failed status/usage read carries a retry
- storage-card.tsx — media.usage display + the two-step attachment purge; confirmation and Cancel lock once clearing starts (outcomes ride FeedbackLine)
- use-operations.ts — the page's ws touchpoint: memory.tidy plus the cached memory.status / media.usage reads (a failed re-read keeps the last counters on screen; refresh() backs the retry)
- use-media-clear.ts — destructive purge owner: immediate exact-once guard, media.clear call, terminal release, and refresh
- operations-state.ts — pure view models + media.clear state machine; Cancel is valid only before destructive execution
- memory-authority-card.tsx — memory.authority.status card: authority/runtime/setup lines, the Hindsight lifecycle and backup blocks, per-Bank replica + Pending rows with Sync now / Full reconcile / Retry, active operations with Cancel (admitted replica.sync only)
- memory-authority-state.ts — pure view models for that card (unknown stays 未知) + the shared Bank scope / operation kind/state/runtime-reason labels + the MEMORY_OPERATION_REFUSED app-error reader
- memory-hindsight-lifecycle-block.tsx — the card's Hindsight connection + Bank readiness block: 重新校验连接 / 创建 Bank buttons through the generic submit, collapsed diagnostics
- memory-hindsight-lifecycle-state.ts — pure projection of the status `hindsight` section: connection rows, per-scope readiness rows, diagnostics (native ids, error codes) and action descriptors from Core `actions` only
- memory-hindsight-backup-block.tsx — the card's Hindsight backup block: rollback warning, state / age / per-Bank missing interval, in-flight or failure line, route-b 导入备份 form, 创建备份 / 校验备份 through the generic submit, collapsed 备份诊断
- memory-hindsight-backup-state.ts — pure projection of `hindsight.backup` plus the backup.* operation rows: closed-code messages, staged route-b capture, action descriptors and the inbox-validated admit request; the only client rule is disabling while a backup operation is open
- memory-hindsight-backup-fixtures.ts — test support (not in the production path): one MemoryAuthorityStatus per backup block state plus backup.* operation rows
- memory-operations-controller.ts — framework-free guard shared by the Stage 1 and Hindsight cards: one injected status read per instance behind the changed-push subscription, generic serialized submit(request, key)/cancel, coalesced refetch on push and after every mutation outcome, no replay
- use-memory-operations.ts — the React seam for memory.authority.status + memory.operations.*: state + the controller lifecycle bound to the authenticated client, generic submit / submitSync / cancel
- memory-authority-fixtures.ts — test support (not in the production path): MemoryAuthorityStatus / Bank / MemoryOperation fixtures plus the Hindsight lifecycle section (every readiness state) shared by the card, view-model and controller tests
- local-onboarding-card.tsx — memory.onboarding.status card: authority vs runtime facts, progress, Core-derived action buttons, exceptions list and technical diagnostics
- local-onboarding-exceptions.tsx — bounded source diagnostics with the per-source exclusion reason form and cursor paging
- local-onboarding-actions.ts — action labels, Core-derived allow checks and the exact memory.operations.submit request per action
- local-onboarding-state.ts — LocalOnboardingState + pure headline/progress/refusal presentation (unknown stays unknown)
- local-onboarding-controller.ts — framework-free guard: subscribe-before-read, generation/version-guarded reads, coalesced invalidations, serialized actions, no replay
- use-local-onboarding.ts — the React seam for memory.onboarding.*: controller lifecycle bound to the authenticated client and page visibility
- local-onboarding-fixtures.ts — test support (not in the production path): MemoryOnboardingStatus fixtures shared by the card and controller tests
- hindsight-activation-card.tsx — memory.activation.status card: setup phase, Bank prerequisites with missing/extra scopes, run/producer progress (admitted vs completed distinct), 校验连接 / 应用配置 / 启用 Hindsight / 继续 / 恢复运行时 / 取消, technical diagnostics
- hindsight-activation-state.ts — HindsightActivationState + pure headline/guidance/facts/Bank rows/blocking lines/diagnostics (unknown stays 未知, ids and hashes only in diagnostics)
- hindsight-activation-actions.ts — action labels, allow checks (Core-derived actions plus the setup kinds while unconfigured), the exact submit request per action and the dispatch through the generic controller
- use-hindsight-activation.ts — the React seam for memory.activation.status: the generic controller bound to the authenticated client and page visibility (hidden retires the generation)
- hindsight-activation-fixtures.ts — test support (not in the production path): one MemoryActivationStatus fixture per card state shared by the card, view-model and dispatch tests
