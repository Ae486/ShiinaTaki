/**
 * INPUT:  authenticated dispatcher plus the shared Core configuration observation owner
 * OUTPUT: operator-only observe/status methods with strictly projected results
 * POS:    core/server/methods — no Node, Agent tool or client-provided evidence can cross this boundary
 */
import { HINDSIGHT_CONFIGURATION_METHODS, HindsightConfigurationParamsSchema, HindsightConfigurationStatusSchema,
  type HindsightConfigurationParams } from "@taki/shared";
import type { HindsightConfigurationService } from "../../memory/hindsight/hindsight-configuration-service.ts";
import type { MethodRegistry, MethodContext } from "../method-registry.ts";
import { appException } from "../app-error.ts";

export function registerHindsightConfigurationMethods(registry: MethodRegistry, service: HindsightConfigurationService): void {
  registry.register({ method: HINDSIGHT_CONFIGURATION_METHODS.status, roles: ["operator"],
    paramsSchema: HindsightConfigurationParamsSchema,
    handler: (params: HindsightConfigurationParams, ctx) => {
      requireOperator(ctx); return HindsightConfigurationStatusSchema.parse(service.status(params));
    } });
  registry.register({ method: HINDSIGHT_CONFIGURATION_METHODS.observe, roles: ["operator"],
    paramsSchema: HindsightConfigurationParamsSchema,
    handler: async (params: HindsightConfigurationParams, ctx) => {
      requireOperator(ctx); return HindsightConfigurationStatusSchema.parse(await service.observe(params));
    } });
}

function requireOperator(ctx: MethodContext): void {
  if (ctx.connection.state.status !== "authenticated" || ctx.connection.state.role !== "operator") {
    throw appException("FORBIDDEN", "Configuration observation requires an authenticated operator");
  }
}
