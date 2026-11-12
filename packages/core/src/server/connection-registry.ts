/**
 * INPUT:  socket lifecycle and authenticated connect identities; Core-assigned Host negotiation facts
 * OUTPUT: per-socket authentication/display support, per-Host generations, replacement retirement and remove listeners
 * POS:    core/server — connection authentication truth; D59 browser generations remain separate and absent here
 */
import type { ConnectParams, HostNegotiation, Role } from "@taki/shared";

export type ConnectionState =
  | { readonly status: "awaiting" }
  | {
      readonly status: "authenticated";
      readonly deviceId: string;
      readonly role: Role;
      readonly capabilities: readonly string[];
      readonly host?: HostNegotiation;
      readonly approvalCommandDisclosureRevision?: ConnectParams["approvalCommandDisclosureRevision"];
    };

export type ConnectionNotify = (method: string, params: unknown) => void;

export interface Connection {
  /** Real socket write completion; absence is unknown, never evidence of delivery. */
  notifyObserved?: (method: string, params: unknown) => Promise<"accepted" | "refused" | "unknown">;
  state: ConnectionState;
  notify?: ConnectionNotify;
  readonly remoteAddress?: string;
  close?: () => void;
}

export interface AuthenticatedIdentity {
  deviceId: string;
  role: Role;
  capabilities: readonly string[];
  host?: Omit<HostNegotiation, "hostId" | "connectionGeneration">;
  approvalCommandDisclosureRevision?: ConnectParams["approvalCommandDisclosureRevision"];
}

export interface ConnectionRegistry {
  create(notify?: ConnectionNotify, remoteAddress?: string, close?: () => void): Connection;
  authenticate(connection: Connection, identity: AuthenticatedIdentity): HostNegotiation | undefined;
  remove(connection: Connection): void;
  list(): readonly Connection[];
  findHost(hostId: string): Connection | undefined;
  isCurrentHost(connection: Connection): boolean;
  onRemove(cb: (connection: Connection) => void): void;
}

interface RegistryState {
  connections: Set<Connection>;
  liveHosts: Map<string, Connection>;
  generations: Map<string, number>;
  removeListeners: Array<(connection: Connection) => void>;
  retired: Set<Connection>;
}

export function createConnectionRegistry(): ConnectionRegistry {
  const state: RegistryState = {
    connections: new Set(),
    liveHosts: new Map(),
    generations: new Map(),
    removeListeners: [],
    retired: new Set(),
  };

  return {
    create(notify, remoteAddress, close) {
      const connection: Connection = { state: { status: "awaiting" }, notify, remoteAddress, close };
      state.connections.add(connection);
      return connection;
    },
    authenticate(connection, identity) {
      const host = identity.host ? assignHost(state, identity.deviceId, identity.host) : undefined;
      connection.state = {
        status: "authenticated",
        deviceId: identity.deviceId,
        role: identity.role,
        capabilities: [...identity.capabilities],
        host,
        approvalCommandDisclosureRevision: identity.role === "operator" ? identity.approvalCommandDisclosureRevision : undefined,
      };
      if (host) {
        const previous = state.liveHosts.get(host.hostId);
        if (previous && previous !== connection) retire(state, previous);
        state.liveHosts.set(host.hostId, connection);
        if (previous && previous !== connection) previous.close?.();
      }
      return host;
    },
    remove(connection) {
      if (!state.connections.delete(connection)) return;
      retire(state, connection);
    },
    list: () => [...state.connections],
    findHost: (hostId) => state.liveHosts.get(hostId),
    isCurrentHost(connection) {
      const connectionState = connection.state;
      return connectionState.status === "authenticated"
        && connectionState.host !== undefined
        && state.liveHosts.get(connectionState.host.hostId) === connection;
    },
    onRemove: (cb) => state.removeListeners.push(cb),
  };
}

function assignHost(
  state: RegistryState,
  hostId: string,
  selection: Omit<HostNegotiation, "hostId" | "connectionGeneration">,
): HostNegotiation {
  const connectionGeneration = (state.generations.get(hostId) ?? 0) + 1;
  state.generations.set(hostId, connectionGeneration);
  return { hostId, connectionGeneration, ...selection };
}

function retire(state: RegistryState, connection: Connection): void {
  if (state.retired.has(connection)) return;
  state.retired.add(connection);
  const connectionState = connection.state;
  if (
    connectionState.status === "authenticated"
    && connectionState.host
    && state.liveHosts.get(connectionState.host.hostId) === connection
  ) {
    state.liveHosts.delete(connectionState.host.hostId);
  }
  for (const listener of state.removeListeners) listener(connection);
}
