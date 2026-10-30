/**
 * INPUT: authenticated operator membership and post-commit child invalidation hints
 * OUTPUT: bounded coalesced character/child revisions with connection-owned cleanup
 * POS: core/harness — disposable read-model notifications; no execution state or mutation replay
 */
import type { SubagentChanged } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";

export function createSubagentSubscriptions() {
  const sinks = new Map<Connection, (change: SubagentChanged) => void>();
  const pending = new Map<string, string>(); let revision = 0; let scheduled = false; let closed = false;
  const flush = () => {
    scheduled = false;
    const changes = [...pending].map(([subagentId, characterId]) => ({ characterId, subagentId, revision: ++revision }));
    pending.clear();
    if (closed) return;
    for (const [connection, sink] of sinks) {
      if (connection.state.status !== "authenticated" || connection.state.role !== "operator") continue;
      for (const change of changes) {
        try { sink({ ...change }); } catch { /* A read observer cannot change committed work or another subscriber. */ }
      }
    }
  };
  return {
    subscribe(connection: Connection, sink: (change: SubagentChanged) => void): boolean {
      if (closed || connection.state.status !== "authenticated" || connection.state.role !== "operator") return false;
      const added = !sinks.has(connection); sinks.set(connection, sink); return added;
    },
    unsubscribe: (connection: Connection) => { sinks.delete(connection); },
    publish(characterId: string, subagentId: string) {
      if (closed) return;
      pending.set(subagentId, characterId);
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    },
    close() { closed = true; sinks.clear(); pending.clear(); },
  };
}
export type SubagentSubscriptions = ReturnType<typeof createSubagentSubscriptions>;
