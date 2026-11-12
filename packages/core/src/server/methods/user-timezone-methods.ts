/**
 * INPUT: authenticated operator connections, strict timezone requests and UserTimezoneService
 * OUTPUT: read/update/report methods with one explicitly claimed connection-bound reporting source
 * POS: core/server/methods — reporting leases never select devices, retire other windows or establish Presence
 */
import { randomUUID } from "node:crypto";
import {
  USER_TIMEZONE_METHODS, UserTimezoneReadParamsSchema, UserTimezoneUpdateParamsSchema,
  UserTimezoneReportParamsSchema, type UserTimezoneReadResult, type UserTimezoneState,
} from "@taki/shared";
import type { UserTimezoneService } from "../../time/user-timezone-service.ts";
import type { Connection, ConnectionRegistry } from "../connection-registry.ts";
import type { MethodContext, MethodRegistry } from "../method-registry.ts";
import { appException } from "../app-error.ts";

interface ReportSource { connection: Connection; sourceId: string; lastReportRevision?: number }

/** A new source retires only its predecessor's reporting rights, never the predecessor's socket. */
function createReportSources() {
  let current: ReportSource | undefined;
  const retired = new WeakSet<Connection>();
  const watched = new WeakSet<Connection>();
  return {
    current: () => current,
    reset() { current = undefined; },
    claim(ctx: MethodContext): ReportSource | undefined {
      if (retired.has(ctx.connection)) return undefined;
      if (current?.connection === ctx.connection) return current;
      if (current) retired.add(current.connection);
      current = { connection: ctx.connection, sourceId: randomUUID() };
      if (!watched.has(ctx.connection)) {
        watched.add(ctx.connection);
        ctx.onClose(() => {
          retired.add(ctx.connection);
          if (current?.connection === ctx.connection) current = undefined;
        });
      }
      return current;
    },
  };
}

function operator(ctx: MethodContext, connections: ConnectionRegistry): string {
  const state = ctx.connection.state;
  if (state.status !== "authenticated") throw appException("NOT_AUTHENTICATED", "Authentication is required");
  if (state.role !== "operator" || !connections.list().includes(ctx.connection)) {
    throw appException("FORBIDDEN", "A live operator connection is required");
  }
  return state.deviceId;
}

function reportStatus(state: UserTimezoneState, source?: ReportSource): UserTimezoneReadResult["reportStatus"] {
  if (state.mode === "fixed") return "fixed";
  if (!source) return "unavailable";
  return source.lastReportRevision === state.revision ? "current" : "awaiting-report";
}

export function registerUserTimezoneMethods(registry: MethodRegistry, input: {
  service: UserTimezoneService; connections: ConnectionRegistry;
}): void {
  const sources = createReportSources();
  registry.register({ method: USER_TIMEZONE_METHODS.read, roles: ["operator"], paramsSchema: UserTimezoneReadParamsSchema,
    handler(params, ctx): UserTimezoneReadResult {
      const deviceId = operator(ctx, input.connections);
      const state = input.service.read();
      let refusal: UserTimezoneReadResult["refusal"];
      let source: ReportSource | undefined;
      if (params.claimReportSource && state.mode === "follow-primary-device") {
        if (state.authorityDeviceId !== deviceId) refusal = "foreign-authority";
        else { source = sources.claim(ctx); if (!source) refusal = "stale-source"; }
      }
      return { state, reportStatus: reportStatus(state, sources.current()),
        ...(source ? { reportSourceId: source.sourceId } : {}), ...(refusal ? { refusal } : {}) };
    },
  });
  registry.register({ method: USER_TIMEZONE_METHODS.update, roles: ["operator"], paramsSchema: UserTimezoneUpdateParamsSchema,
    handler(params, ctx) {
      const result = input.service.update(params, operator(ctx, input.connections));
      // A policy update invalidates the old token but permits a fresh explicit claim on a still-current socket.
      if (result.status === "accepted") sources.reset();
      return result;
    },
  });
  registry.register({ method: USER_TIMEZONE_METHODS.report, roles: ["operator"], paramsSchema: UserTimezoneReportParamsSchema,
    handler(params, ctx) {
      const deviceId = operator(ctx, input.connections);
      const state = input.service.read();
      if (state.mode === "fixed") return { status: "ignored-fixed", state };
      if (state.authorityDeviceId !== deviceId) return { status: "refused", reason: "foreign-authority", state };
      const source = sources.current();
      if (!source || source.connection !== ctx.connection || source.sourceId !== params.reportSourceId) {
        return { status: "refused", reason: "stale-source", state };
      }
      const result = input.service.report(params, deviceId);
      if (result.status === "accepted") source.lastReportRevision = result.state.revision;
      return result;
    },
  });
}
