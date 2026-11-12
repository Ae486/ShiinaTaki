"""Explicit hunk resolutions for the approved B6/T4 source integration.

Operates only on local candidates; snapshot.py separately guards application.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATTERN = re.compile(r'<<<<<<< T4-current\n(.*?)\|\|\|\|\|\|\| common-base\n(.*?)=======\n(.*?)>>>>>>> pinned-main\n', re.S)


def resolve(path, index, ours, base, theirs):
    if path == 'packages/core/src/agents/chat-agent.ts':
        return {
            0: 'import { captureToolDisplayNames, type ChatSendParams, type ImageAttachment, type RunMemoryReference, type TimelineEntry } from "@taki/shared";\n',
            1: ours + theirs,
            2: ours + theirs,
            3: '  const base = { characterId, message, attachments, images, vision, userSeq: userEntry?.seq, userEntry, primary, runContext, recall: {},\n    toolDisplayNames: captureToolDisplayNames(runContext?.toolDisplayNames) };\n',
            4: '\n'.join(theirs.splitlines()[:2]) + '\n' + '\n'.join(ours.splitlines()[1:]) + '\n',
            5: ours,
            6: ours,
            7: '',
        }[index]
    if path == 'packages/core/src/agents/conversation-store.ts':
        if index == 0:
            return ours.replace('post-commit sinks', 'exact commit receipts, post-commit sinks')
        if index == 1:
            return ('  appendTurn(characterId: string, messages: TurnMessage[], options?: Readonly<Record<string, string>> | ((entry: TimelineEntry) => void)): void;\n'
                    '  commitTurn(input: TurnCommitInput): TimelineEntry[];\n')
        return ('      appendAssistant: (characterId, text, onCommitted) => {\n'
                '        const entry = commit(characterId, { role: "assistant", content: text });\n'
                '        onCommitted?.(entry);\n'
                '      },\n'
                '      appendTurn: (characterId, messages, options) => {\n'
                '        const entries = commitConversationTurn(deps, { characterId, messages,\n'
                '          ...(typeof options === "function" ? {} : { toolDisplayNames: options }) });\n'
                '        if (typeof options === "function") for (const entry of entries) options(entry);\n'
                '      },\n'
                '      commitTurn: (input) => commitConversationTurn(deps, input),\n')
    if path == 'packages/core/src/harness/run-snapshot-capture.ts':
        return {
            0: ' * OUTPUT: cancellable immutable RunSnapshot plus exact Memory/tool bindings and captured presentation names\n',
            1: 'import { captureToolDisplayNames, type TriggerRequest } from "@taki/shared";\n',
            2: theirs + '      toolDisplayNames: captureToolDisplayNames(context.toolDisplayNames),\n',
        }[index]
    if path == 'packages/core/src/harness/run-snapshot-capture.test.ts':
        return (theirs + 'import type { TriggerRequest } from "@taki/shared";\n') if index == 0 else theirs + '\n'.join(ours.splitlines()[1:]) + '\n'
    if path == 'packages/core/src/main.ts':
        if index == 0:
            return theirs + '      chatActivity.dispose();\n      extensionSubscriptions.dispose();\n'
        return (ours + '    }).catch(() => {\n'
                '      logger.error({ code: "CORE_SHUTDOWN_FAILED" }, "Core shutdown could not settle all owned work");\n'
                '      process.exitCode = 1;\n')
    if path == 'apps/desktop/src/lib/ws-client-methods.ts':
        return ours + theirs
    if path == 'apps/desktop/src/lib/ws-client-routes.ts':
        if index == 0:
            return ours
        if index == 3:
            return ours.replace('monitor: new Set(), activity:', 'monitor: new Set(), memoryOperation: new Set(), activity:')
        if index == 5:
            return ours + '  rpc.addMethod(MEMORY_OPERATION_METHODS.changed, (params: unknown) => {\n    publishHandlers(state.push.memoryOperation, MemoryOperationChangedSchema.parse(params).operation);\n  });\n'
        return ours + theirs
    if path == 'apps/desktop/src/lib/ws-client.ts':
        return ours if index == 0 else theirs
    if path == 'apps/desktop/src/lib/ws-client.test.ts':
        return ours + theirs
    if path == 'apps/desktop/src/windows/home/pages/operations/operations-page.tsx':
        return ours.replace('retained memory/storage cards', 'retained memory/storage cards and durable Memory operations')
    if path == 'packages/core/src/config/knob-registry.test.ts':
        return '    expect(CONFIG_KNOBS).toHaveLength(63);\n'
    if path in ('packages/core/src/db/migrations/index-list.ts', 'packages/core/src/db/migrations/index-list.test.ts', 'packages/core/src/db/scheduled-task-repo.test.ts'):
        return theirs
    if path == 'packages/core/src/db/migrations/lineage-reopen-matrix.test.ts':
        if index == 0:
            return ours + theirs
        if index == 1:
            return theirs + '\n'.join(ours.splitlines()[1:]) + '\n'
        return theirs
    if path == '.trellis/workspace/pleia/index.md':
        if index == 0:
            return '- **Total Sessions**: 33 (branch-qualified histories)\n- **Last Active**: 2026-09-19\n'
        if index == 1:
            return '| `journal-1.md` | ~1525 | Active |\n'
        return ours.replace('| 31 |', '| T4-31 |') + theirs.replace('| 31 |', '| main-31 |')
    if path == '.trellis/workspace/pleia/journal-1.md':
        return ours.replace('## Session 31:', '## Session T4-31:') + theirs.replace('## Session 31:', '## Session main-31:')
    if path == 'packages/shared/src/index.ts':
        return ours
    if path.endswith('/index.md'):
        # Keep branch-specific responsibilities, merging duplicate inventory keys
        # rather than leaving two contradictory entries for the same module.
        lines = ours.splitlines()
        for line in theirs.splitlines():
            if line in lines:
                continue
            key = re.match(r'([-*] `?[^` ]+`?)\s+[—–-]\s+', line)
            old = next((i for i, item in enumerate(lines) if key and item.startswith(key[1] + ' ')), None)
            if old is not None:
                incoming_role = re.split(r'\s+[—–-]\s+', line, maxsplit=1)[1]
                lines[old] += '; ' + incoming_role
            else:
                lines.append(line)
        return '\n'.join(lines) + '\n'
    raise ValueError((path, index))


manifest = json.loads((HERE / 'manifest.json').read_text(encoding='utf-8'))
for entry in manifest['entries']:
    if entry['state'] != 'conflict':
        continue
    path = HERE / 'payload/candidates' / entry['path']
    content = path.read_text(encoding='utf-8')
    counter = iter(range(1000))
    content = PATTERN.sub(lambda match: resolve(entry['path'], next(counter), *match.groups()), content)
    assert '<<<<<<< T4-current' not in content, entry['path']
    path.write_text(content, encoding='utf-8')
    entry['state'] = 'resolved'
(HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
