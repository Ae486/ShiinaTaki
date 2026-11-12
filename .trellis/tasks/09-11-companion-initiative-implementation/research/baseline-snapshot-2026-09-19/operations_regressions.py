"""Cover hidden-page races and presentation privacy introduced by integration."""
from guarded_edit import edit, replace_once


def controller(source):
    source = replace_once(source, '  candidate.subscribeMemoryOperations().catch((cause: unknown) => {',
        '  candidate.subscribeMemoryOperations().then(() => {\n'
        '    if (isCurrent(state, candidate, token)) void refreshController(state, sink);\n'
        '  }).catch((cause: unknown) => {')
    source = replace_once(source, 'if (isCurrent(state, candidate, token)) publishMutation(state, () => sink.mutationSettled(refusalFeedback(cause)));',
        'if (isCurrent(state, candidate, token)) {\n'
        '      publishMutation(state, () => sink.mutationSettled(refusalFeedback(cause)));\n'
        '      void refreshController(state, sink);\n'
        '    }')
    return replace_once(source, '      installSubscription(state, sink, next);\n      void refreshController(state, sink);', '      installSubscription(state, sink, next);')


TESTS = '''
describe("T4 retained-page Memory integration", () => {
  it("gates hidden changed pushes and discards a pre-hide read without retiring a mutation", async () => {
    const s = sink();
    const controller = createMemoryOperationsController(s);
    let releaseRead!: () => void;
    let releaseMutation!: () => void;
    let reads = 0;
    const stub = client({
      memoryAuthorityStatus: async () => { reads += 1; if (reads === 1) await new Promise<void>((resolve) => { releaseRead = resolve; }); return hindsightStatus(); },
      memoryOperationSubmit: async () => { stub.calls.push("submit"); await new Promise<void>((resolve) => { releaseMutation = resolve; }); return operation(); },
    });
    controller.replace(stub);
    await settle();
    const mutation = controller.submitSync("global", "incremental");
    controller.setVisible(false);
    stub.push(operation()); stub.push(operation({ state: "running" }));
    releaseRead(); releaseMutation();
    await mutation; await settle();
    expect(reads).toBe(1);
    expect(s.loaded).not.toHaveBeenCalled();
    expect(s.mutationSettled).not.toHaveBeenCalled();
    controller.setVisible(true);
    await settle();
    expect(reads).toBe(2);
    expect(stub.calls.filter((call) => call === "submit")).toHaveLength(1);
    expect(s.mutationSettled).toHaveBeenCalledOnce();
    expect(s.mutationSettled).toHaveBeenCalledWith({ tone: "ok", message: "已受理增量同步。" });
    expect(s.loaded).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("waits for accepted subscription before its first read", async () => {
    const s = sink(); let accept!: () => void;
    const stub = client({ subscribeMemoryOperations: () => new Promise<void>((resolve) => { accept = resolve; }) });
    const controller = createMemoryOperationsController(s);
    controller.replace(stub);
    await settle();
    expect(stub.calls).toEqual([]);
    accept(); await settle();
    expect(stub.calls).toEqual(["status"]);
    controller.dispose();
  });
});
'''
edit('apps/desktop/src/windows/home/pages/operations/memory-operations-controller.ts', controller)
edit('apps/desktop/src/windows/home/pages/operations/memory-operations-controller.test.ts', lambda s: s + TESTS)
edit('apps/desktop/src/windows/home/pages/operations/memory-authority-card.test.tsx', lambda s: s + '''
it("keeps internal epoch, Bank and operation identities out of every rendered attribute and label", () => {
  const privateBank = "private-bank-identity";
  const active = operation({ request: { kind: "replica.sync", bankId: privateBank, syncKind: "incremental" } });
  const markup = card({ status: hindsightStatus({ replica: [bankStatus(privateBank)], operations: { active: [active], recent: [] } }) });
  expect(markup).not.toContain(privateBank);
  expect(markup).not.toContain(active.operationId);
  expect(markup).not.toContain("epoch-2");
});
''')


def index(source):
    lines = source.splitlines()
    roles = {
        'operations-page.tsx': 'retained Memory authority, tidy, context and storage cards with independent failure/retry states',
        'storage-card.tsx': 'media usage and two-step attachment purge with stable pending labels and locked confirmation',
        'use-operations.ts': 'independent Memory/storage demand states and retries; visibility-gated invalidation after writes',
        'use-media-clear.ts': 'guarded media clearing, once-only floating outcomes, retained failure and storage invalidation',
        'memory-operations-controller.ts': 'current-client operation actions and outcomes; visibility-gated, subscription-ordered status reads without mutation replay',
        'use-memory-operations.ts': 'Memory operations React lifecycle tied to authenticated client and actual retained-page visibility',
        'memory-authority-state.ts': 'provider status and semantic Bank/operation labels; unknown stays unknown and internal identities remain non-display state',
    }
    entries = []
    for line in lines:
        if not line.startswith('- '):
            continue
        name = line[2:].split(' — ')[0]
        entries.append(f'- {name} — {roles[name]}' if name in roles else line)
    return '# windows/home/pages/operations/\nThe Operations page joins durable Memory operations, manual maintenance, context and storage.\nEvery displayed fact comes from Core; retained-page reads never replay mutations.\n\n' + '\n'.join(entries) + '\n'


edit('apps/desktop/src/windows/home/pages/operations/index.md', index)
edit('packages/core/src/agents/index.md', lambda s: replace_once(s,
    '- turn-recording.ts —', '- turn-recording.ts — returns exact committed rows for primary Memory witnessing;'))
edit('.trellis/spec/backend/foreground-chat-activity.md', lambda s: replace_once(s,
    '- Migration 035 adds nullable `timeline_messages.presentation` after unchanged migrations 001-034.',
    '- Historical T4 migration 035 adds nullable `timeline_messages.presentation` after unchanged migrations 001-034.\n'
    '  The combined forward registry uses main Pending Memory 035 and existing 036 convergence through 048;\n'
    '  applied receipts and both original 035 modules remain unchanged.') +
    '\n## Combined canonical Memory source witness\n\n'
    'The turn recording guard returns the exact rows from the atomic writer. Primary ingestion receives that\n'
    'batch plus the exact committed user row after commit, including useful exceptional and iterator-close partials.\n'
    'It receives no retracted row, unrelated interleaved row, automatic Recall fragment or non-primary turn.\n'
    'The captured Memory assembly/tools/Recall bundle and tool-display-name map coexist; automatic Recall\n'
    'remains primary-only and is reused across the one clean overflow retry.\n')
edit('.trellis/spec/backend/memory-operations.md', lambda s: s +
    '\n## T4 retained-page integration\n\n'
    'The Home card installs its handler, awaits subscription acknowledgement, then reads Core status.\n'
    'Actual page visibility gates disposable status reads; hidden pushes retain one dirty obligation,\n'
    'and pre-hide reads cannot publish after visibility retirement. Returning reconciles Core truth.\n'
    'Hiding keeps the operation controller, mutation lock and one terminal outcome; it never replays a mutation.\n'
    'The card retains readable prior data during refresh or connection loss. Authority epochs, opaque Bank IDs\n'
    'and operation IDs remain internal request/correlation fields and never become labels, feedback or tooltips.\n'
    'These UI rules do not change producer attribution, authority or the D84 precision limitations above.\n')
