/**
 * INPUT: durable cache-window reads, live monitor mode and committed usage/summary hints.
 * OUTPUT: computed operator snapshots through disposable, failure-isolated subscriptions.
 * POS: core/observability — no counters of its own; ledgers and summary baselines own the facts.
 */
import { CacheUsageWindowSnapshotSchema, type CacheUsageUpdate, type CacheUsageWindowSnapshot, type MonitorMode } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";

interface Dependencies {
  read(characterId: string): CacheUsageWindowSnapshot;
  mode(): MonitorMode;
  logger: { warn(data: Record<string, unknown>, message: string): void };
}
type Sink = (update: CacheUsageUpdate) => void;
interface Member { characterId: string; sink: Sink }

export function createCacheUsageService(deps: Dependencies) {
  return new CacheUsageService(deps);
}

export class CacheUsageService {
  private readonly deps: Dependencies;
  private readonly members = new Map<Connection, Member>();
  private revision = 0;
  private queued = false;
  private disposed = false;

  constructor(deps: Dependencies) { this.deps = deps; }

  subscribe(connection: Connection, characterId: string, sink: Sink): { added: boolean; update: CacheUsageUpdate } {
    if (this.disposed || !operator(connection)) throw new Error("OBSERVABILITY_FORBIDDEN");
    if (this.deps.mode() === "DISABLED") throw new Error("OBSERVABILITY_DISABLED");
    const added = !this.members.has(connection);
    this.members.set(connection, { characterId, sink });
    return { added, update: this.snapshot(characterId) };
  }

  unsubscribe(connection: Connection): void { this.members.delete(connection); }

  changed = (): void => {
    if (this.disposed || this.queued || this.members.size === 0) return;
    this.queued = true;
    queueMicrotask(() => this.flush());
  };

  dispose(): void { this.disposed = true; this.members.clear(); }

  private snapshot(characterId: string): CacheUsageUpdate {
    let snapshot: CacheUsageWindowSnapshot;
    try {
      if (this.deps.mode() === "DISABLED") snapshot = unavailable(characterId, "monitor-disabled");
      else {
        snapshot = CacheUsageWindowSnapshotSchema.parse(this.deps.read(characterId));
        if (snapshot.characterId !== characterId) throw new Error("CACHE_USAGE_SCOPE_MISMATCH");
      }
    } catch {
      snapshot = unavailable(characterId, "read-failed");
      try { this.deps.logger.warn({ code: "CACHE_USAGE_READ_FAILED" }, "cache usage projection unavailable"); }
      catch { /* Optional diagnostics cannot affect usage settlement. */ }
    }
    return { revision: ++this.revision, snapshot };
  }

  private flush(): void {
    this.queued = false;
    if (this.disposed || this.members.size === 0) return;
    const snapshots = new Map<string, CacheUsageUpdate>();
    for (const [connection, member] of [...this.members]) {
      if (!operator(connection) || this.members.get(connection) !== member) continue;
      let update = snapshots.get(member.characterId);
      if (!update) { update = this.snapshot(member.characterId); snapshots.set(member.characterId, update); }
      try { member.sink({ revision: update.revision, snapshot: { ...update.snapshot } }); }
      catch { /* A closed socket cannot interrupt other observers or committed model work. */ }
    }
  }
}

function operator(connection: Connection): boolean {
  return connection.state.status === "authenticated" && connection.state.role === "operator";
}

function unavailable(characterId: string, reason: "read-failed" | "monitor-disabled"): CacheUsageWindowSnapshot {
  return { scope: "all-observed-model-requests", characterId, summaryRevision: null, summaryCommittedAt: null,
    boundary: null, status: "unavailable", computedAt: new Date().toISOString(), observedRequests: null,
    pairedRequests: null, inputTokens: null, cacheReadTokens: null, ratio: null, reason };
}
