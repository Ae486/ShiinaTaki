/**
 * INPUT:  the authenticated operator client's bounded JSON-RPC request function
 * OUTPUT: Shared-validated template preview, Bank detail, status and single-child observation reads
 * POS:    ui/lib — writes stay on memory.operations; no Native requests or model work originate here
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import {
  MEMORY_TEMPLATE_METHODS, MemoryTemplatePreviewParamsSchema, MemoryTemplatePreviewSchema,
  MemoryTemplateDetailParamsSchema, MemoryTemplateDetailSchema, MemoryTemplateStatusParamsSchema, MemoryTemplateStatusSchema,
  MemoryTemplateDerivedParamsSchema, MemoryTemplateDerivedObservationSchema,
  type MemoryTemplatePreviewParams, type MemoryTemplatePreview, type MemoryTemplateDetail,
  type MemoryTemplateStatus, type MemoryTemplateDerivedParams, type MemoryTemplateDerivedObservation,
} from "@taki/shared";

export interface HindsightTemplateMethods {
  hindsightTemplatePreview(params: MemoryTemplatePreviewParams): Promise<MemoryTemplatePreview>;
  hindsightTemplateDetail(params: { previewId: string; previewHash: string; bankId: string }): Promise<MemoryTemplateDetail>;
  hindsightTemplateStatus(params: { planId?: string; bankId?: string }): Promise<MemoryTemplateStatus>;
  hindsightTemplateDerived(params: MemoryTemplateDerivedParams): Promise<MemoryTemplateDerivedObservation>;
}

export function hindsightTemplateMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>): HindsightTemplateMethods {
  return {
    hindsightTemplatePreview: async (params) => MemoryTemplatePreviewSchema.parse(await request(
      MEMORY_TEMPLATE_METHODS.preview, MemoryTemplatePreviewParamsSchema.parse(params))),
    hindsightTemplateDetail: async (params) => MemoryTemplateDetailSchema.parse(await request(
      MEMORY_TEMPLATE_METHODS.detail, MemoryTemplateDetailParamsSchema.parse(params))),
    hindsightTemplateStatus: async (params) => MemoryTemplateStatusSchema.parse(await request(
      MEMORY_TEMPLATE_METHODS.status, MemoryTemplateStatusParamsSchema.parse(params))),
    hindsightTemplateDerived: async (params) => MemoryTemplateDerivedObservationSchema.parse(await request(
      MEMORY_TEMPLATE_METHODS.derived, MemoryTemplateDerivedParamsSchema.parse(params))),
  };
}
