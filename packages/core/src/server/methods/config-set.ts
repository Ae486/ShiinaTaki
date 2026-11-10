/**
 * INPUT:  ConfigSetParams from a dispatched config.set request + the config writer + a Logger
 * OUTPUT: configSetMethod({writer, logger}) -> MethodDefinition (operator-only); persists or refuses distinctly
 * POS:    core/server/methods — one file per WS method; a thin controller over config-writer (the refusal vocabulary
 *         and the store write both live there). Logs the KEY and the outcome, never the value
 */
import { CONFIG_METHODS, ConfigSetParamsSchema, ErrorCodeSchema, type ConfigSetParams, type ConfigSetResult } from "@taki/shared";
import type { ConfigWriter } from "../../config/config-writer.ts";
import type { Logger } from "../../logging/logger.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition } from "../method-registry.ts";

export interface ConfigSetDeps {
  writer: ConfigWriter;
  logger: Logger;
}

export function configSetMethod(deps: ConfigSetDeps): MethodDefinition<ConfigSetParams> {
  const log = deps.logger.child({ mod: "config" });
  return {
    method: CONFIG_METHODS.set,
    roles: ["operator"],
    paramsSchema: ConfigSetParamsSchema,
    handler: (params): ConfigSetResult => {
      const outcome = deps.writer.set(params);
      if (!outcome.ok) {
        log.warn({ key: params.key, reason: outcome.reason }, "config.set refused");
        // The reason rides error.data beside the code, so the panel explains itself without matching on a message.
        throw appException(ErrorCodeSchema.enum.CONFIG_REFUSED, outcome.message, { reason: outcome.reason });
      }
      log.info({ key: outcome.key, reset: outcome.value === null, apply: outcome.apply }, "config stored");
      return { status: "ok", key: outcome.key, value: outcome.value, apply: outcome.apply,
        effectiveValue: outcome.effectiveValue, origin: outcome.origin, application: outcome.application };
    },
  };
}
