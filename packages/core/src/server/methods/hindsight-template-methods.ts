/**
 * INPUT:  authenticated operator requests and the Core-owned template lifecycle read plane
 * OUTPUT: bounded preview/detail/status/child observations and closed domain refusals
 * POS:    server methods — application and recovery stay on the existing durable operation owner
 */
import { MEMORY_TEMPLATE_METHODS, MemoryTemplatePreviewParamsSchema, MemoryTemplatePreviewSchema,
  MemoryTemplateDetailParamsSchema, MemoryTemplateDetailSchema, MemoryTemplateStatusParamsSchema, MemoryTemplateStatusSchema,
  MemoryTemplateDerivedParamsSchema, MemoryTemplateDerivedObservationSchema } from "@taki/shared";
import type { HindsightTemplateLifecycleService } from "../../memory/hindsight/template-lifecycle/template-lifecycle-service.ts";
import { templateErrorCode } from "../../memory/hindsight/template-lifecycle/template-errors.ts";
import { appException } from "../app-error.ts";
import type { MethodContext, MethodRegistry } from "../method-registry.ts";

export function registerHindsightTemplateMethods(registry: MethodRegistry, service: HindsightTemplateLifecycleService): void {
  registry.register({ method: MEMORY_TEMPLATE_METHODS.preview, roles: ["operator"], paramsSchema: MemoryTemplatePreviewParamsSchema,
    handler: async (params, context) => {
      requireOperator(context);
      return MemoryTemplatePreviewSchema.parse(await service.preview(params));
    } });
  registry.register({ method: MEMORY_TEMPLATE_METHODS.detail, roles: ["operator"], paramsSchema: MemoryTemplateDetailParamsSchema,
    handler: (params, context) => {
      requireOperator(context);
      try { return MemoryTemplateDetailSchema.parse(service.detail(params)); }
      catch (cause) { throw refusal(cause); }
    } });
  registry.register({ method: MEMORY_TEMPLATE_METHODS.status, roles: ["operator"], paramsSchema: MemoryTemplateStatusParamsSchema,
    handler: (params, context) => {
      requireOperator(context);
      try { return MemoryTemplateStatusSchema.parse(service.status(params)); }
      catch (cause) { throw refusal(cause); }
    } });
  registry.register({ method: MEMORY_TEMPLATE_METHODS.derived, roles: ["operator"], paramsSchema: MemoryTemplateDerivedParamsSchema,
    handler: async (params, context) => {
      requireOperator(context);
      try { return MemoryTemplateDerivedObservationSchema.parse(await service.derived(params)); }
      catch (cause) { throw refusal(cause); }
    } });
}
function requireOperator(context: MethodContext): void {
  if (context.connection.state.status !== "authenticated" || context.connection.state.role !== "operator") {
    throw appException("FORBIDDEN", "Template management requires an authenticated operator");
  }
}
function refusal(cause: unknown) {
  return appException("MEMORY_OPERATION_REFUSED", "Template evidence is unavailable", { reason: templateErrorCode(cause) });
}
