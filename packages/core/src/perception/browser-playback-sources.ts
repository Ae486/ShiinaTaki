/**
 * INPUT: strict browser observations, actual Node connection/catalog ownership and operator privacy state
 * OUTPUT: bounded current source references, read snapshots and synchronous retirement notifications
 * POS: core/perception — memory-only observation owner; no acceptance, inference, task ledger or OS access
 */
import { randomUUID } from "node:crypto";
import {
  BROWSER_PLAYBACK_FRESH_MS, BROWSER_PLAYBACK_MAX_SOURCES, BrowserPlaybackReportSchema,
  type BrowserPlaybackAck, type BrowserPlaybackReadResult, type BrowserPlaybackReport, type BrowserPlaybackView,
} from "@taki/shared";
import type { HostCatalogStore } from "../hosts/host-catalog.ts";
import type { Connection, ConnectionRegistry } from "../server/connection-registry.ts";
import { notifyPerceptionChange } from "./notify-perception-change.ts";

export interface BrowserPlaybackSources {
  report(connection: Connection, candidate: unknown): BrowserPlaybackAck;
  read(): BrowserPlaybackReadResult;
  resolve(sourceRef: string): BrowserPlaybackView | undefined;
  retireConnection(connection: Connection): void;
  refresh(): void;
  close(): void;
}
interface Dependencies {
  connections: ConnectionRegistry; catalogs: HostCatalogStore; enabled(): boolean;
  now?: () => number; onChanged?: () => void;
}
interface Entry {
  attachmentId: string; generation: number; sequence: number; catalogGeneration: number;
  view?: BrowserPlaybackView; timer?: ReturnType<typeof setTimeout>;
}
interface State {
  deps: Dependencies; now(): number; entries: Map<Connection, Entry>; closed: boolean;
}
type Refusal = Extract<BrowserPlaybackAck, { accepted: false }>["reason"];
const refuse = (reason: Refusal): BrowserPlaybackAck => ({ accepted: false, reason });

export function createBrowserPlaybackSources(deps: Dependencies): BrowserPlaybackSources {
  const state: State = { deps, now: deps.now ?? Date.now, entries: new Map(), closed: false };
  const retireConnection = (connection: Connection) => {
    const entry = state.entries.get(connection);
    if (entry) retire(state, entry);
    state.entries.delete(connection);
  };
  deps.connections.onRemove(retireConnection);
  const refresh = () => {
    for (const [connection, entry] of state.entries) {
      if (!current(state, connection, entry)) retire(state, entry);
    }
  };
  return {
    report: (connection, candidate) => report(state, connection, candidate),
    read() {
      refresh();
      return { enabled: enabled(state), sources: [...state.entries.values()]
        .flatMap((entry) => entry.view ? [structuredClone(entry.view)] : []) };
    },
    resolve(sourceRef) {
      refresh();
      const view = [...state.entries.values()].find((entry) => entry.view?.sourceRef === sourceRef)?.view;
      return view && structuredClone(view);
    },
    retireConnection, refresh,
    close() {
      state.closed = true;
      for (const entry of state.entries.values()) retire(state, entry);
      state.entries.clear();
    },
  };
}

function enabled(state: State): boolean {
  try { return !state.closed && state.deps.enabled() === true; }
  catch { return false; }
}

function host(state: State, connection: Connection) {
  const auth = connection.state;
  if (auth.status !== "authenticated" || auth.role !== "node" || !auth.host
    || !state.deps.connections.isCurrentHost(connection)) return undefined;
  const catalog = state.deps.catalogs.get(auth.host.hostId);
  return catalog?.connectionGeneration === auth.host.connectionGeneration && catalog.readiness === "ready"
    ? { identity: auth.host, catalog } : undefined;
}

function current(state: State, connection: Connection, entry: Entry): boolean {
  const owner = host(state, connection);
  return enabled(state) && entry.view !== undefined && owner !== undefined
    && owner.catalog.catalogGeneration === entry.catalogGeneration
    && state.now() < Date.parse(entry.view.freshUntil);
}

function retire(state: State, entry: Entry): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = undefined;
  const changed = entry.view !== undefined;
  // Keep the last generation/sequence tombstone until the socket retires; a late sample cannot reopen it.
  entry.view = undefined;
  if (changed) notifyPerceptionChange(state.deps.onChanged);
}

function report(state: State, connection: Connection, candidate: unknown): BrowserPlaybackAck {
  const before = state.entries.get(connection);
  if (!enabled(state)) {
    for (const entry of state.entries.values()) retire(state, entry);
    return refuse("disabled");
  }
  const owner = host(state, connection);
  if (!owner) { if (before) retire(state, before); return refuse("wrong_host"); }
  const parsed = BrowserPlaybackReportSchema.safeParse(candidate);
  if (!parsed.success) { if (before) retire(state, before); return refuse("invalid_report"); }
  const value = parsed.data;
  if (value.catalogGeneration !== owner.catalog.catalogGeneration) return refuse("stale_generation");
  if (before && !current(state, connection, before)) retire(state, before);
  const refusal = admission(before, value);
  if (refusal) return refuse(refusal);
  if (!before && state.entries.size >= BROWSER_PLAYBACK_MAX_SOURCES) return refuse("capacity");
  const entry = before && before.generation === value.attachmentGeneration ? before : replace(state, connection, value);
  entry.sequence = value.sequence;
  if (value.kind === "retired") { retire(state, entry); return { accepted: true }; }
  if (value.observedAgeMs >= BROWSER_PLAYBACK_FRESH_MS) { retire(state, entry); return refuse("stale_source"); }
  if (entry.view && JSON.stringify(entry.view.source) !== JSON.stringify(value.source)) {
    retire(state, entry); return refuse("stale_source");
  }
  const at = state.now();
  entry.view = {
    sourceRef: entry.view?.sourceRef ?? randomUUID(), hostId: owner.identity.hostId,
    connectionGeneration: owner.identity.connectionGeneration, catalogGeneration: value.catalogGeneration,
    attachmentId: value.attachmentId, attachmentGeneration: value.attachmentGeneration, sequence: value.sequence,
    source: value.source, sample: value.sample, receivedAt: new Date(at).toISOString(),
    freshUntil: new Date(at + BROWSER_PLAYBACK_FRESH_MS - value.observedAgeMs).toISOString(),
  };
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => retire(state, entry), BROWSER_PLAYBACK_FRESH_MS - value.observedAgeMs);
  entry.timer.unref?.();
  notifyPerceptionChange(state.deps.onChanged);
  return { accepted: true };
}

function admission(before: Entry | undefined, value: BrowserPlaybackReport): Refusal | undefined {
  if (!before) return value.sequence === 1 ? undefined : "stale_source";
  if (value.attachmentGeneration < before.generation) return "stale_generation";
  if (value.attachmentGeneration > before.generation) {
    return value.sequence === 1 && value.attachmentId !== before.attachmentId ? undefined : "stale_source";
  }
  if (value.attachmentId !== before.attachmentId || value.catalogGeneration !== before.catalogGeneration) return "stale_source";
  if (value.sequence <= before.sequence) return "duplicate";
  return before.view || value.kind === "retired" ? undefined : "stale_source";
}

function replace(state: State, connection: Connection, value: BrowserPlaybackReport): Entry {
  const before = state.entries.get(connection);
  if (before) retire(state, before);
  const entry: Entry = { attachmentId: value.attachmentId, generation: value.attachmentGeneration,
    sequence: value.sequence, catalogGeneration: value.catalogGeneration };
  state.entries.set(connection, entry);
  return entry;
}
