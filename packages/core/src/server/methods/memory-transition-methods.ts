/**
 * INPUT:  authenticated operator preview/status calls and the Core healthy transition service
 * OUTPUT: strict current preview and historical progress; execution uses memory.operations.submit
 * POS:    core/server/methods — thin read plane; the existing operations push channel invalidates both reads
 */
import { ErrorCodeSchema, MEMORY_TRANSITION_METHODS, MemoryTransitionPreviewParamsSchema, MemoryTransitionPreviewSchema,
  MemoryTransitionReadParamsSchema, MemoryTransitionReadSchema, MemoryTransitionOverviewParamsSchema, MemoryTransitionOverviewSchema } from "@taki/shared";
import type { MemoryTransitionPreview, MemoryTransitionRead, MemoryTransitionOverview } from "@taki/shared";
import type { MethodRegistry } from "../method-registry.ts";
import { appException } from "../app-error.ts";
import { transitionOperatorReason } from "../../memory/transitions/transition-operator-actions.ts";

export function registerMemoryTransitionMethods(registry: MethodRegistry, service: {
  preview(params: { kind: MemoryTransitionPreview["kind"]; recoveryTransitionId?: string }): Promise<MemoryTransitionPreview>;
  status(transitionId: string): MemoryTransitionRead;
  overview(): MemoryTransitionOverview;
}): void {
  registry.register({ method: MEMORY_TRANSITION_METHODS.preview, roles: ["operator"], paramsSchema: MemoryTransitionPreviewParamsSchema,
    handler: async (params) => {
      try { return MemoryTransitionPreviewSchema.parse(await service.preview(params)); }
      catch (cause) { throw appException(ErrorCodeSchema.enum.MEMORY_OPERATION_REFUSED, "transition preview is unavailable", { reason: transitionOperatorReason(cause) }); }
    } });
  registry.register({ method: MEMORY_TRANSITION_METHODS.status, roles: ["operator"], paramsSchema: MemoryTransitionReadParamsSchema,
    handler: (params) => {
      try { return MemoryTransitionReadSchema.parse(service.status(params.transitionId)); }
      catch (cause) { throw appException(ErrorCodeSchema.enum.MEMORY_OPERATION_REFUSED, "transition evidence is unavailable", { reason: transitionOperatorReason(cause) }); }
    } });
  registry.register({ method: MEMORY_TRANSITION_METHODS.overview, roles: ["operator"], paramsSchema: MemoryTransitionOverviewParamsSchema,
    handler: () => {
      try { return MemoryTransitionOverviewSchema.parse(service.overview()); }
      catch (cause) { throw appException(ErrorCodeSchema.enum.MEMORY_OPERATION_REFUSED, "transition overview is unavailable", { reason: transitionOperatorReason(cause) }); }
    } });
}
