/**
 * INPUT: strict presence/ordinary Timeline reports from live authenticated operator connections
 * OUTPUT: registered source reports, presentation reports and bounded current presence reads
 * POS: core/server/methods — identity comes from the socket; source evidence grants no capability authority
 */
import { PRESENCE_METHODS, PresenceReadParamsSchema, PresenceReportParamsSchema,
  TimelinePresentationReportParamsSchema } from "@taki/shared";
import type { createPresenceService } from "../../presence/presence-service.ts";
import type { ConnectionRegistry } from "../connection-registry.ts";
import type { MethodContext, MethodRegistry } from "../method-registry.ts";
import { appException } from "../app-error.ts";

export function registerPresenceMethods(registry: MethodRegistry, input: {
  service: ReturnType<typeof createPresenceService>; connections: ConnectionRegistry;
}): void {
  const authorize = (ctx: MethodContext) => {
    const state = ctx.connection.state;
    if (state.status !== "authenticated") throw appException("NOT_AUTHENTICATED", "Authentication is required");
    if (state.role !== "operator" || !input.connections.list().includes(ctx.connection)) {
      throw appException("FORBIDDEN", "A live operator connection is required");
    }
  };
  registry.register({ method: PRESENCE_METHODS.read, roles: ["operator"], paramsSchema: PresenceReadParamsSchema,
    handler(_params, ctx) { authorize(ctx); return input.service.snapshot(); },
  });
  registry.register({ method: PRESENCE_METHODS.report, roles: ["operator"], paramsSchema: PresenceReportParamsSchema,
    handler(params, ctx) { authorize(ctx); return input.service.reportPresence(ctx.connection, params); },
    onInvalidParams(_params, ctx) { input.service.retireConnection(ctx.connection); },
  });
  registry.register({ method: PRESENCE_METHODS.presentationReport, roles: ["operator"], paramsSchema: TimelinePresentationReportParamsSchema,
    handler(params, ctx) { authorize(ctx); return input.service.reportPresentation(ctx.connection, params); },
    onInvalidParams(_params, ctx) { input.service.retireConnection(ctx.connection); },
  });
}
