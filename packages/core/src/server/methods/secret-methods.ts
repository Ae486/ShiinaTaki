/**
 * INPUT:  MethodRegistry plus the Core-local secret catalog service and logger
 * OUTPUT: registerSecretMethods(...) — operator-only secret.set/clear/presence/list
 * POS:    core/server/methods — the sensitive write-only seam: every result is presence/provenance/health
 *         (structurally value-free), storage failures become bounded SECRET_REFUSED app exceptions BEFORE the
 *         registry's verbatim error paths, and the log lines carry the opaque ref only
 */
import {
  ErrorCodeSchema,
  SECRET_METHODS,
  SecretClearParamsSchema,
  SecretListParamsSchema,
  SecretPresenceParamsSchema,
  SecretSetParamsSchema,
  type SecretClearParams,
  type SecretListParams,
  type SecretPresenceParams,
  type SecretSetParams,
} from "@taki/shared";
import type { Logger } from "../../logging/logger.ts";
import { SecretCatalogError } from "../../secrets/secret-catalog-envelope.ts";
import { SecretRefusalError, type SecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition, MethodRegistry } from "../method-registry.ts";

export interface SecretMethodDeps {
  service: SecretCatalogService;
  logger: Logger;
}

export function registerSecretMethods(registry: MethodRegistry, deps: SecretMethodDeps): void {
  registry.register(secretSet(deps));
  registry.register(secretClear(deps));
  registry.register(secretPresence(deps));
  registry.register(secretList(deps));
}

function secretSet(deps: SecretMethodDeps): MethodDefinition<SecretSetParams> {
  return {
    method: SECRET_METHODS.set,
    roles: ["operator"],
    paramsSchema: SecretSetParamsSchema,
    handler: ({ secretRef, value }) =>
      guarded(deps, () => {
        const result = deps.service.set(secretRef, value);
        return { secretRef, present: true, provenance: result.provenance, health: deps.service.health() };
      }),
  };
}

function secretClear(deps: SecretMethodDeps): MethodDefinition<SecretClearParams> {
  return {
    method: SECRET_METHODS.clear,
    roles: ["operator"],
    paramsSchema: SecretClearParamsSchema,
    handler: ({ secretRef }) => guarded(deps, () => ({ ...deps.service.clear(secretRef), secretRef })),
  };
}

function secretPresence(deps: SecretMethodDeps): MethodDefinition<SecretPresenceParams> {
  return {
    method: SECRET_METHODS.presence,
    roles: ["operator"],
    paramsSchema: SecretPresenceParamsSchema,
    handler: ({ secretRef }) => guarded(deps, () => deps.service.presence(secretRef)),
  };
}

function secretList(deps: SecretMethodDeps): MethodDefinition<SecretListParams> {
  return {
    method: SECRET_METHODS.list,
    roles: ["operator"],
    paramsSchema: SecretListParamsSchema,
    handler: () => guarded(deps, () => deps.service.list()),
  };
}

/**
 * Sanitization boundary BEFORE method-registry.ts:100-103/113-121: catalog refusals/corruption become bounded
 * app exceptions, and anything unexpected becomes a fixed-message INTERNAL_ERROR — no error text constructed
 * below the seam can carry a value (the real cause goes to the log, which is itself value-free by contract).
 */
function guarded<T>(deps: SecretMethodDeps, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SecretRefusalError) {
      throw appException(ErrorCodeSchema.enum.SECRET_REFUSED, error.message, { reason: error.reason });
    }
    if (error instanceof SecretCatalogError) {
      const reason = error.reason === "unsupported-version" ? "store-unsupported" : "store-unreadable";
      throw appException(ErrorCodeSchema.enum.SECRET_REFUSED, error.message, { reason });
    }
    if (error instanceof Error && error.name === "ZodError") throw error; // param-shape failures echo only path/message
    deps.logger.child({ mod: "secrets" }).error({ err: error instanceof Error ? error.name : "unknown" }, "secret method failed");
    throw appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "secret storage failed");
  }
}
