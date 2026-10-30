/**
 * INPUT: authenticated operator requests and the existing deterministic backoff owner
 * OUTPUT: semantic same-Monitor read/reset results; no Run creation or policy replay
 * POS: core/server/methods — authorization and schema adapter only
 */
import { INITIATIVE_BACKOFF_METHODS, InitiativeBackoffReadParamsSchema, InitiativeBackoffResetParamsSchema } from "@taki/shared";
import type { InitiativeBackoff } from "../../initiative/backoff/initiative-backoff.ts";
import type { ConnectionRegistry } from "../connection-registry.ts";
import type { MethodRegistry } from "../method-registry.ts";
import { requireInitiativeOperator } from "./interaction-pattern-methods.ts";
import { appException } from "../app-error.ts";

export function registerInitiativeBackoffMethods(registry: MethodRegistry, input: {
  backoff: Pick<InitiativeBackoff, "read" | "reset">; connections: ConnectionRegistry; monitorEnabled(): boolean;
}): void {
  registry.register({ method: INITIATIVE_BACKOFF_METHODS.read, roles: ["operator"], paramsSchema: InitiativeBackoffReadParamsSchema,
    handler(params, ctx) {
      requireInitiativeOperator(ctx, input.connections);
      if (!input.monitorEnabled()) throw appException("FORBIDDEN", "The Monitor is disabled");
      return input.backoff.read(params.characterId);
    } });
  registry.register({ method: INITIATIVE_BACKOFF_METHODS.reset, roles: ["operator"], paramsSchema: InitiativeBackoffResetParamsSchema,
    handler(params, ctx) { requireInitiativeOperator(ctx, input.connections); return input.backoff.reset(params.characterId); } });
}
