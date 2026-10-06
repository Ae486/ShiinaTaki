/**
 * INPUT: persisted exact Source body requests and the authenticated transition HTTP requester
 * OUTPUT: guarded prepare/part/seal methods with independently probed Source-evidence capability
 * POS: core/memory/hindsight — transport only; ordinary D77 uploads keep their existing writer fence
 */
import { z } from "zod";
import { HindsightTransitionSourceUploadSchema, HindsightTransitionSourcePartSchema,
  TakiApplicationBodyUploadStatusSchema, TakiApplicationBodyPartReceiptSchema, TakiApplicationBodyRefSchema,
  type HindsightTransitionSourceUpload, type HindsightTransitionSourcePart, type TakiApplicationBodyUploadStatus,
  type TakiApplicationBodyPartReceipt, type TakiApplicationBodyRef } from "@taki/shared";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";
import { hindsightTransitionCaller } from "./hindsight-transition-client.ts";
import { probeHindsightTransitionSourceCapability } from "./hindsight-transition-source-capability.ts";

type Post<T> = { bankId: string; request: T; context: HindsightCallContext };
export interface HindsightTransitionSourceClient {
  uploadTransitionSourceBody(input: Post<HindsightTransitionSourceUpload>): Promise<TakiApplicationBodyUploadStatus>;
  putTransitionSourcePart(input: Post<HindsightTransitionSourcePart> & { bodyId: string; partNumber: number }): Promise<TakiApplicationBodyPartReceipt>;
  sealTransitionSourceBody(input: Post<HindsightTransitionSourceUpload> & { bodyId: string }): Promise<TakiApplicationBodyRef>;
}
export function createHindsightTransitionSourceMethods(request: <T>(input: HindsightRequestInput<T>) => Promise<T>): HindsightTransitionSourceClient {
  const call = hindsightTransitionCaller(request);
  const guard = async (context: HindsightCallContext, lineage: string) => {
    if ((await probeHindsightTransitionSourceCapability(request, context)).providerLineage !== lineage) throw new Error("HINDSIGHT_RESPONSE_INVALID");
  };
  return {
    uploadTransitionSourceBody: async (input) => {
      const body = HindsightTransitionSourceUploadSchema.parse(input.request); await guard(input.context, body.namespace.provider_lineage);
      return call({ ...input, suffix: "/executor/source-bodies", body, schema: TakiApplicationBodyUploadStatusSchema });
    },
    putTransitionSourcePart: async (input) => {
      const body = HindsightTransitionSourcePartSchema.parse(input.request); await guard(input.context, body.namespace.provider_lineage);
      return call({ ...input, suffix: `/executor/source-bodies/${z.uuid().parse(input.bodyId)}/parts/${z.int().min(0).parse(input.partNumber)}`,
        body, schema: TakiApplicationBodyPartReceiptSchema });
    },
    sealTransitionSourceBody: async (input) => {
      const body = HindsightTransitionSourceUploadSchema.parse(input.request); await guard(input.context, body.namespace.provider_lineage);
      return call({ ...input, suffix: `/executor/source-bodies/${z.uuid().parse(input.bodyId)}/seal`, body, schema: TakiApplicationBodyRefSchema });
    },
  };
}
