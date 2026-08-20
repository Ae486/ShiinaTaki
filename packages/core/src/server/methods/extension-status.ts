/**
 * INPUT:  operator extension.status request plus a fresh process-local ExtensionRunSnapshot projection
 * OUTPUT: bounded owner/generation convergence facts validated by the Shared schema
 * POS:    core/server/methods — operator-only read; it exposes no binding, secret, path, or package content
 */
import {
  EXTENSION_METHODS,
  ExtensionConvergenceResultSchema,
  ExtensionStatusParamsSchema,
  type ExtensionRunSnapshot,
} from "@taki/shared";
import type { MethodDefinition } from "../method-registry.ts";

export function extensionStatusMethod(input: {
  coreHostId: string;
  snapshot: () => ExtensionRunSnapshot;
  now?: () => string;
}): MethodDefinition<Record<string, never>> {
  return {
    method: EXTENSION_METHODS.status,
    roles: ["operator"],
    paramsSchema: ExtensionStatusParamsSchema,
    handler: () => {
      const snapshot = input.snapshot();
      return ExtensionConvergenceResultSchema.parse({
        observedAt: input.now?.() ?? new Date().toISOString(),
        coreHostId: input.coreHostId,
        hosts: snapshot.hosts,
        entries: snapshot.entries,
        collisions: snapshot.collisions,
      });
    },
  };
}
