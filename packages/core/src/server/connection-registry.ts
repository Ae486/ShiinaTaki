/**
 * INPUT:  socket lifecycle calls from the WS server (create / authenticate / remove)
 * OUTPUT: createConnectionRegistry() -> { create, authenticate, remove, list }; per-socket auth state
 * POS:    core/server — per-connection auth state + the tracked set M3's capability router will consume (prd §3)
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

export interface Connection {
  state: ConnectionState;
}

export interface AuthenticatedIdentity {
  deviceId: string;
  role: Role;
  capabilities: readonly string[];
}

export interface ConnectionRegistry {
  /** A freshly opened socket: starts awaiting-connect and is tracked until removed. */
  create(): Connection;
  authenticate(connection: Connection, identity: AuthenticatedIdentity): void;
  remove(connection: Connection): void;
  list(): readonly Connection[];
}

export function createConnectionRegistry(): ConnectionRegistry {
  const connections = new Set<Connection>();

  return {
    create() {
      const connection: Connection = { state: { status: "awaiting" } };
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
    },
    list() {
      return [...connections];
    },
  };
}
