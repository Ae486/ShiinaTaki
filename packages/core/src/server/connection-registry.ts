/**
 * INPUT:  socket lifecycle calls from the WS server (create / authenticate / remove) + a per-socket notify sink + peer remote address
 * OUTPUT: createConnectionRegistry() -> { create, authenticate, remove, list, findNodeForCapability, onRemove }
 * POS:    core/server — per-connection auth state + the tracked set the M3 capability router consumes (prd §3, ruling 12)
 */
import type { Role } from "@taki/shared";

export type ConnectionState =
  | { readonly status: "awaiting" }
  | {
      readonly status: "authenticated";
      readonly deviceId: string;
      readonly role: Role;
      readonly capabilities: readonly string[];
    };

/** Server-initiated push to THIS socket (a JSON-RPC notification); the broker uses it to reach a node. */
export type ConnectionNotify = (method: string, params: unknown) => void;

export interface Connection {
  state: ConnectionState;
  /** Set by ws-server at socket creation; undefined only in unit tests that never push server-initiated frames. */
  notify?: ConnectionNotify;
  /** Peer address captured at socket creation (ws `request.socket.remoteAddress`); undefined for unknown peers / unit tests. Drives loopback auto-trust in connect (P3). */
  readonly remoteAddress?: string;
}

export interface AuthenticatedIdentity {
  deviceId: string;
  role: Role;
  capabilities: readonly string[];
}

export interface ConnectionRegistry {
  /** A freshly opened socket: starts awaiting-connect and is tracked until removed; notify reaches only this socket. */
  create(notify?: ConnectionNotify, remoteAddress?: string): Connection;
  authenticate(connection: Connection, identity: AuthenticatedIdentity): void;
  remove(connection: Connection): void;
  list(): readonly Connection[];
  /** First authenticated node whose declared capabilities include `capability`, or undefined (ruling 12). */
  findNodeForCapability(capability: string): Connection | undefined;
  /** Registers a callback fired with each connection as it is removed (the broker denies its pending asks). */
  onRemove(cb: (connection: Connection) => void): void;
}

export function createConnectionRegistry(): ConnectionRegistry {
  const connections = new Set<Connection>();
  const removeListeners: Array<(connection: Connection) => void> = [];

  return {
    create(notify, remoteAddress) {
      const connection: Connection = { state: { status: "awaiting" }, notify, remoteAddress };
      connections.add(connection);
      return connection;
    },
    authenticate(connection, identity) {
      connection.state = {
        status: "authenticated",
        deviceId: identity.deviceId,
        role: identity.role,
        // Copy so a later mutation of the caller's array can't rewrite a live connection's grants.
        capabilities: [...identity.capabilities],
      };
    },
    remove(connection) {
      connections.delete(connection);
      for (const listener of removeListeners) listener(connection);
    },
    list() {
      return [...connections];
    },
    findNodeForCapability(capability) {
      for (const connection of connections) {
        const { state } = connection;
        if (state.status === "authenticated" && state.role === "node" && state.capabilities.includes(capability)) {
          return connection;
        }
      }
      return undefined;
    },
    onRemove(cb) {
      removeListeners.push(cb);
    },
  };
}
