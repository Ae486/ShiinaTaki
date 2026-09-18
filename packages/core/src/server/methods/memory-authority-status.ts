/**
 * INPUT:  MemoryAuthorityStatusParams (empty) from a dispatched memory.authority.status request + the composite reader
 * OUTPUT: memoryAuthorityStatusMethod(read) -> MethodDefinition (operator-only) returning a strict MemoryAuthorityStatus
 * POS:    core/server/methods — one file per WS method; a read, never a subscription (D-S1-5)
 */
import { ErrorCodeSchema, MEMORY_AUTHORITY_METHODS, MemoryAuthorityStatusParamsSchema, MemoryAuthorityStatusSchema, type MemoryAuthorityStatus, type MemoryAuthorityStatusParams } from "@taki/shared";
import type { Logger } from "../../logging/logger.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function memoryAuthorityStatusMethod(deps: { read(): MemoryAuthorityStatus; logger: Logger }): MethodDefinition<MemoryAuthorityStatusParams> {
  return {
    method: MEMORY_AUTHORITY_METHODS.status,
    roles: ["operator"],
    paramsSchema: MemoryAuthorityStatusParamsSchema,
    handler: () => {
      try {
        return MemoryAuthorityStatusSchema.parse(deps.read());
      } catch (error) {
        deps.logger.child({ mod: "memory-operations" }).error({ err: error instanceof Error ? error.name : "unknown" }, "memory authority status read failed");
        throw appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "memory authority status is unavailable");
      }
    },
  };
}
