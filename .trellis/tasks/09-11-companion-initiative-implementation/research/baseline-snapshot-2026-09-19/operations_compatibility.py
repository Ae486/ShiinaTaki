"""Adapt incoming Memory card to T4 visibility and semantic presentation rules."""
from guarded_edit import edit, replace_once


def controller(s):
    s = replace_once(s, '  refresh(): Promise<void>;', '  setVisible(visible: boolean): void;\n  refresh(): Promise<void>;')
    s = replace_once(s, '  epoch: number;', '  epoch: number;\n  readEpoch: number;\n  visible: boolean;\n  pendingMutation: (() => void) | null;')
    s = replace_once(s, '  if (!candidate) return;\n  if (state.refreshing)', '  if (!candidate) return;\n  if (!state.visible) { state.dirty = true; return; }\n  const readEpoch = state.readEpoch;\n  if (state.refreshing)')
    s = replace_once(s, 'if (isCurrent(state, candidate, token)) sink.loaded(status);', 'if (isCurrent(state, candidate, token) && state.visible && state.readEpoch === readEpoch) sink.loaded(status);')
    s = replace_once(s, 'if (isCurrent(state, candidate, token)) sink.loadFailed(cause);', 'if (isCurrent(state, candidate, token) && state.visible && state.readEpoch === readEpoch) sink.loadFailed(cause);')
    s = replace_once(s, 'if (state.dirty && isCurrent(state, candidate, token))', 'if (state.dirty && state.visible && isCurrent(state, candidate, token))')
    s = replace_once(s, '  sink.mutationStarted(spec.key);', '  publishMutation(state, () => sink.mutationStarted(spec.key));')
    s = replace_once(s, '    sink.mutationSettled(feedback);', '    publishMutation(state, () => sink.mutationSettled(feedback));')
    s = replace_once(s, '    sink.mutationSettled(refusalFeedback(cause));', '    publishMutation(state, () => sink.mutationSettled(refusalFeedback(cause)));')
    s = replace_once(s, 'const { code, reason, activeOperationId } = memoryOperationAppError(cause);', 'const { code, reason } = memoryOperationAppError(cause);')
    s = replace_once(s, '    const suffix = activeOperationId ? `（进行中：${activeOperationId}）` : "";\n    return { tone: "warn", message: `Core 拒绝了该操作：${reason ?? code}${suffix}` };',
        '    return { tone: "warn", message: `Core 拒绝了该操作：${reason ?? code}` };')
    s = replace_once(s, '  state.epoch += 1;', '  state.epoch += 1;\n  state.readEpoch += 1;\n  state.pendingMutation = null;')
    s = replace_once(s, 'if (isCurrent(state, candidate, token)) sink.mutationSettled(refusalFeedback(cause));',
        'if (isCurrent(state, candidate, token)) publishMutation(state, () => sink.mutationSettled(refusalFeedback(cause)));')
    s = replace_once(s, 'client: null, epoch: 0, mutating:', 'client: null, epoch: 0, readEpoch: 0, visible: true, pendingMutation: null, mutating:')
    s = replace_once(s, 'if (!next) { sink.loading(); return; }', 'if (!next) { if (state.visible) sink.loading(); return; }')
    s = replace_once(s, '    refresh: () => refreshController(state, sink),',
        '    setVisible(visible) {\n'
        '      if (state.visible === visible) return;\n'
        '      state.visible = visible;\n'
        '      state.readEpoch += 1;\n'
        '      state.dirty = true;\n'
        '      if (!visible) return;\n'
        '      const pending = state.pendingMutation; state.pendingMutation = null; pending?.();\n'
        '      if (!state.refreshing) state.dirty = false;\n'
        '      void refreshController(state, sink);\n'
        '    },\n'
        '    refresh: () => refreshController(state, sink),')
    s = replace_once(s, 'const operation = await candidate.memoryOperationSubmit(', 'await candidate.memoryOperationSubmit(')
    s = replace_once(s, 'return { tone: "ok", message: `已受理 ${syncKind} 同步：${operation.operationId}` };', 'return { tone: "ok", message: syncKind === "full" ? "已受理完整对账。" : "已受理增量同步。" };')
    s = replace_once(s, 'const operation = await candidate.memoryOperationCancel(operationId);', 'await candidate.memoryOperationCancel(operationId);')
    s = replace_once(s, 'return { tone: "ok", message: `已取消 ${operation.operationId}` };', 'return { tone: "ok", message: "已取消同步操作。" };')
    return s + '\n// Visibility retires read authority only: the mutation lock and terminal outcome survive a hidden page.\nfunction publishMutation(state: ControllerState, publish: () => void): void {\n  if (state.visible) publish(); else state.pendingMutation = publish;\n}\n'


def hook(s):
    s = replace_once(s, 'import { useCallback, useEffect, useMemo, useState }', 'import { useCallback, useEffect, useLayoutEffect, useMemo, useState }')
    s = replace_once(s, 'import { useHomeClient }', 'import { usePageActive } from "../../page-visibility-store.ts";\nimport { useHomeClient }')
    s = replace_once(s, '  const { client, status: connection } = useHomeClient();', '  const { client, status: connection } = useHomeClient();\n  const visible = usePageActive("operations");')
    s = replace_once(s, '    loading: () => setState((current) => ({ ...current, loading: true })),', '    loading: () => setState((current) => ({ ...current, loading: current.status === null })),')
    return replace_once(s, '  useEffect(() => {\n    setState',
        '  // Retire reads before a retained page hides; keep the same mutation owner and current-client lock.\n'
        '  useLayoutEffect(() => controller.setVisible(visible), [controller, visible]);\n\n'
        '  useEffect(() => {\n    setState')


def view(s):
    s = replace_once(s, 'headline: `${MODE_LABEL[status.authority.mode]}${status.authority.epochId ? ` · epoch ${status.authority.epochId}` : ""}`,', 'headline: MODE_LABEL[status.authority.mode],')
    s = replace_once(s, 'active: status.operations.active.map(activeRow),', 'active: status.operations.active.map((operation) => activeRow(operation, status.replica ?? [])),')
    s = replace_once(s, 'function activeRow(operation: MemoryOperation): ActiveOperationRow {\n  const target = operation.request.kind === "replica.sync" ? ` · ${operation.request.bankId} (${operation.request.syncKind})` : "";',
        'function activeRow(operation: MemoryOperation, banks: NonNullable<MemoryAuthorityStatus["replica"]>): ActiveOperationRow {\n'
        '  const request = operation.request;\n'
        '  const bank = request.kind === "replica.sync" ? banks.find((entry) => entry.bankId === request.bankId) : undefined;\n'
        '  const name = bank ? (bank.scope === "global" ? "共享记忆" : `角色记忆 · ${bank.characterId}`) : "记忆库";\n'
        '  const target = request.kind === "replica.sync" ? ` · ${name}（${request.syncKind === "full" ? "完整对账" : "增量同步"}）` : "";')
    return s


edit('apps/desktop/src/windows/home/pages/operations/memory-operations-controller.ts', controller)
edit('apps/desktop/src/windows/home/pages/operations/use-memory-operations.ts', hook)
edit('apps/desktop/src/windows/home/pages/operations/memory-authority-state.ts', view)
edit('apps/desktop/src/windows/home/pages/operations/memory-authority-card.tsx', lambda s: replace_once(s, ' title={row.operationId}', ''))
edit('apps/desktop/src/windows/home/pages/operations/memory-authority-card.test.tsx', lambda s: s.replace('Local（canonical） · epoch epoch-1', 'Local（canonical）').replace('expect(busy.match(/aria-busy="true"/g)).toHaveLength(2);', 'expect(busy.match(/<button[^>]*aria-busy="true"/g)).toHaveLength(2);'))
edit('apps/desktop/src/windows/home/pages/operations/memory-authority-state.test.ts', lambda s: s.replace('Local（canonical） · epoch epoch-1', 'Local（canonical）').replace('同步副本 · global (incremental) · 已受理（未认领）', '同步副本 · 共享记忆（增量同步） · 已受理（未认领）'))
edit('apps/desktop/src/windows/home/pages/operations/memory-operations-controller.test.ts', lambda s: s.replace('`已受理 incremental 同步：${operation().operationId}`', '"已受理增量同步。"'))
edit('apps/desktop/src/lib/ws-client.test.ts', lambda s: s.replace('{ characterId: "taki", kind: "expression", name: "smile01" }', '{ characterId: "taki", commandId: "avatar-push-test", kind: "expression", name: "smile01" }'))
