"""Preserve T4 recording and push lifecycles while connecting frozen B6 consumers."""
from guarded_edit import edit, replace_once


def recording(source):
    source = replace_once(source, 'import type { ChatActivityAttempt', 'import type { TimelineEntry } from "@taki/shared";\nimport type { ChatActivityAttempt')
    source = replace_once(source, '  }): void;', '  }): TimelineEntry[];')
    source = replace_once(source, '      if (committed) return;', '      if (committed) return [];')
    source = replace_once(source, '      input.store.commitTurn({', '      const entries = input.store.commitTurn({')
    return replace_once(source, '      committed = true;', '      committed = true;\n      return entries;')


def agent(source):
    source = replace_once(source, 'finishRecordedTurn(deps.store, { ...base, state }, turn)', 'finishRecordedTurn(deps, { ...base, state }, turn)')
    source = replace_once(source, 'function finishRecordedTurn(store: ConversationStore, attempt: TurnAttempt, turn?: TurnContext): boolean {', 'function finishRecordedTurn(deps: ChatAgentDeps, attempt: TurnAttempt, turn?: TurnContext): boolean {\n  const { store } = deps;')
    source = replace_once(source, '  recording.commit({ store,', '  const entries = recording.commit({ store,')
    return replace_once(source, '    activity: turn?.activity, attempt: activity });\n  return retract;',
        '    activity: turn?.activity, attempt: activity });\n'
        '  // The atomic writer returns the exact committed rows, including presentation metadata. Witness only\n'
        '  // this primary source, after commit and on exceptional/iterator-close endings as well as normal completion.\n'
        '  // A clean overflow retry never reaches this guard; a retracted user row must never become ingestion input.\n'
        '  if (!retract && attempt.userEntry) deps.onPrimaryCommitted?.({ characterId: attempt.characterId,\n'
        '    entries: [attempt.userEntry, ...entries], runId: turn?.runId });\n'
        '  return retract;')


def ws(source):
    return replace_once(source, 'function pushRegistrations(state: ReturnType<typeof createRoutes>) {\n  return {',
        'function pushRegistrations(state: ReturnType<typeof createRoutes>) {\n  return {\n'
        '    onChatActivity: (handler: (event: ChatActivity) => void) => addChatActivityHandler(state, handler),\n'
        '    onTimelineCommitted: (handler: (batch: TimelineCommitted) => void) => addTimelineCommittedHandler(state, handler),\n'
        '    onPerceptionChanged: (handler: (changed: PerceptionChanged) => void) => addPerceptionChangedHandler(state, handler),\n'
        '    onExtensionChanged: (handler: (changed: ExtensionChanged) => void) => addExtensionChangedHandler(state, handler),')


edit('packages/core/src/agents/turn-recording.ts', recording)
edit('packages/core/src/agents/chat-agent.ts', agent)
edit('apps/desktop/src/lib/ws-client.ts', ws)
