/**
 * INPUT: read-only maintenance snapshots, monitor mode and committed producer change hints
 * OUTPUT: one replaceable background Monitor subscription per operator connection
 * POS: core/observability — optional live projection with no counters or execution authority
 */
import { MaintenanceMonitorParamsSchema, MaintenanceMonitorSnapshotSchema,
  type MaintenanceMonitorParams, type MaintenanceMonitorSnapshot, type MaintenanceMonitorUpdate, type MonitorMode } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";

interface Dependencies { read(params: MaintenanceMonitorParams): MaintenanceMonitorSnapshot; mode(): MonitorMode; }
interface Member { params: MaintenanceMonitorParams; sink: (update: MaintenanceMonitorUpdate) => void; }

export function createMaintenanceMonitorService(deps: Dependencies) {
  const members = new Map<Connection, Member>();
  let revision = 0;
  let queued = false;
  let disposed = false;
  const snapshot = (params: MaintenanceMonitorParams): MaintenanceMonitorUpdate => {
    let value: MaintenanceMonitorSnapshot;
    try {
      value = deps.mode() === "DISABLED" ? empty(params, "disabled") : MaintenanceMonitorSnapshotSchema.parse(deps.read(params));
      if (value.characterId !== params.characterId) throw new Error("MAINTENANCE_SCOPE_MISMATCH");
    } catch { value = empty(params, "unavailable"); }
    return { revision: ++revision, snapshot: value };
  };
  return {
    subscribe(connection: Connection, params: MaintenanceMonitorParams, sink: Member["sink"]) {
      if (disposed || !operator(connection)) throw new Error("OBSERVABILITY_FORBIDDEN");
      if (deps.mode() === "DISABLED") throw new Error("OBSERVABILITY_DISABLED");
      const parsed = MaintenanceMonitorParamsSchema.parse(params);
      const added = !members.has(connection);
      members.set(connection, { params: parsed, sink });
      return { added, update: snapshot(parsed) };
    },
    unsubscribe(connection: Connection) { members.delete(connection); },
    changed() {
      if (disposed || queued || members.size === 0) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (disposed) return;
        for (const [connection, member] of [...members]) {
          if (!operator(connection) || members.get(connection) !== member) continue;
          try { member.sink(snapshot(member.params)); }
          catch { /* An optional disconnected observer cannot affect maintenance or another observer. */ }
        }
      });
    },
    dispose() { disposed = true; members.clear(); },
  };
}
export type MaintenanceMonitorService = ReturnType<typeof createMaintenanceMonitorService>;

function operator(connection: Connection): boolean {
  return connection.state.status === "authenticated" && connection.state.role === "operator";
}
function empty(query: MaintenanceMonitorParams, status: "unavailable" | "disabled"): MaintenanceMonitorSnapshot {
  return { query, status, characterId: query.characterId, rows: [], nextCursor: null, detail: null };
}
