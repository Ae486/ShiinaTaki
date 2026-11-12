"""Finish independent Operations empty/error fixtures and shutdown formatting."""
from guarded_edit import edit, replace_once


def resource_test(s):
    s = replace_once(s, 'import { OperationsPage }', 'import { localStatus } from "./pages/operations/memory-authority-fixtures.ts";\nimport { OperationsPage }')
    s = replace_once(s, 'operations: vi.fn(), costume:', 'operations: vi.fn(), memoryOperations: vi.fn(), costume:')
    s = replace_once(s, 'vi.mock("./pages/operations/use-operations.ts",',
        'vi.mock("./pages/operations/use-memory-operations.ts", () => ({ useMemoryOperations: hooks.memoryOperations }));\nvi.mock("./pages/operations/use-operations.ts",')
    return replace_once(s, '  hooks.operations.mockReturnValue(ops);',
        '  hooks.operations.mockReturnValue(ops);\n'
        '  hooks.memoryOperations.mockReturnValue({ status: localStatus(), loading: false, error: null, busyKey: null, feedback: null,\n'
        '    connectionReady: true, refresh: read, submitSync: read, cancel: read });')


def card(s):
    return replace_once(s, '{view ? <CardBody view={view} ops={ops} /> : <Skeleton lines={4} />}',
        '{view ? <CardBody view={view} ops={ops} /> : ops.connectionReady && ops.loading && !ops.error ? <Skeleton lines={4} />\n'
        '        : !ops.error && <p className="text-xs text-text-secondary">{ops.connectionReady ? "等待状态读取。" : "等待连接以读取状态。"}</p>}')


edit('apps/desktop/src/windows/home/resource-state-pages.test.tsx', resource_test)
edit('apps/desktop/src/windows/home/pages/operations/memory-authority-card.tsx', card)
edit('apps/desktop/src/windows/home/pages/operations/memory-authority-card.test.tsx', lambda s: replace_once(s,
    'expect(card()).toContain("animate-pulse");', 'expect(card({ loading: true })).toContain("animate-pulse");\n    expect(card({ connectionReady: false, loading: true })).not.toContain("animate-pulse");') +
    '\nit("ends first-load skeleton on a failed Memory read", () => {\n  expect(card({ loading: false, error: "failed" })).not.toContain("animate-pulse");\n});\n')
edit('apps/desktop/src/windows/home/pages/operations/operations-page.tsx', lambda s: replace_once(s,
    'busy={ops.refreshing || memoryOps.loading}', 'busy={ops.refreshing || (memoryOps.connectionReady && memoryOps.loading)}'))
edit('packages/core/src/main.ts', lambda s: s.replace('      chatActivity.dispose();\n      extensionSubscriptions.dispose();',
    '    chatActivity.dispose();\n    extensionSubscriptions.dispose();').replace('    }).catch(() => {\n      logger.error({ code: "CORE_SHUTDOWN_FAILED" }, "Core shutdown could not settle all owned work");\n      process.exitCode = 1;',
    '  }).catch(() => {\n    logger.error({ code: "CORE_SHUTDOWN_FAILED" }, "Core shutdown could not settle all owned work");\n    process.exitCode = 1;'))
