/**
 * INPUT:  the existing authenticated deadline transport and bounded lifecycle-v1 requests
 * OUTPUT: exact lifecycle calls with closed refusals and isolated invalid label-proof rows
 * POS:    Core Hindsight adapter — no implicit retry, evidence initialization or separate network client
 */
import { z } from "zod";
import {
  HINDSIGHT_TEMPLATE_MAX_BYTES, HindsightTemplateSnapshotRequestSchema, HindsightTemplateSnapshotSchema,
  HindsightTemplateApplyRequestSchema, HindsightTemplateReceiptSchema, HindsightTemplateResultRequestSchema,
  HindsightTemplateResultSchema, HindsightTemplateRefreshResultRequestSchema, HindsightTemplateRefreshResultSchema,
  HindsightTemplateLabelEvidenceRequestSchema, HindsightTemplateLabelEvidenceResultSchema, HindsightTemplateFailureSchema,
  parseHindsightApplicationJson,
} from "@taki/shared";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";

type Call<S extends z.ZodType> = { request: z.infer<S>; context: HindsightCallContext };
type Failure = z.infer<typeof HindsightTemplateFailureSchema>;
export interface HindsightTemplateClient {
  templateSnapshot(input: Call<typeof HindsightTemplateSnapshotRequestSchema>): Promise<z.infer<typeof HindsightTemplateSnapshotSchema>>;
  templateApply(input: Call<typeof HindsightTemplateApplyRequestSchema>): Promise<z.infer<typeof HindsightTemplateReceiptSchema>>;
  templateResult(input: Call<typeof HindsightTemplateResultRequestSchema>): Promise<z.infer<typeof HindsightTemplateResultSchema>>;
  templateRefreshResult(input: Call<typeof HindsightTemplateRefreshResultRequestSchema>): Promise<z.infer<typeof HindsightTemplateRefreshResultSchema>>;
  templateLabelEvidence(input: Call<typeof HindsightTemplateLabelEvidenceRequestSchema>): Promise<z.infer<typeof HindsightTemplateLabelEvidenceResultSchema>>;
}
export class HindsightTemplateRefusal extends Error {
  readonly reason: Failure["reason"];
  constructor(reason: Failure["reason"]) {
    super("MEMORY_TEMPLATE_NATIVE_REFUSED");
    this.name = "HindsightTemplateRefusal";
    this.reason = reason;
  }
}
type Request = <T>(input: HindsightRequestInput<T>) => Promise<T>;

// A malformed unit proof must not discard valid siblings. Envelope errors,
// including the shared evidence-count bound, still reject the whole response.
export const HindsightTemplateLabelEvidenceResponseSchema = z.preprocess((value) => {
  const parsed = HindsightTemplateLabelEvidenceResultSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!parsed.error.issues.every((issue) => issue.path[0] === "evidence" && typeof issue.path[1] === "number")
    || !value || typeof value !== "object" || !("evidence" in value) || !Array.isArray(value.evidence)) return value;
  const invalidIds = new Set<string>();
  const evidence = value.evidence.flatMap((entry: unknown) => {
    const proof = HindsightTemplateLabelEvidenceResultSchema.shape.evidence.element.safeParse(entry);
    if (proof.success) return [proof.data];
    if (entry && typeof entry === "object" && "unit_id" in entry && typeof entry.unit_id === "string") invalidIds.add(entry.unit_id);
    return [];
  });
  return { ...value, evidence: evidence.filter((entry) => !invalidIds.has(entry.unit_id)) };
}, HindsightTemplateLabelEvidenceResultSchema);

export function createHindsightTemplateMethods(request: Request): HindsightTemplateClient {
  return {
    templateSnapshot: (input) => call(request, { path: "snapshot", payload: HindsightTemplateSnapshotRequestSchema.parse(input.request),
      schema: HindsightTemplateSnapshotSchema, context: input.context }),
    templateApply: (input) => call(request, { path: "apply", payload: HindsightTemplateApplyRequestSchema.parse(input.request),
      schema: HindsightTemplateReceiptSchema, context: input.context }),
    templateResult: (input) => call(request, { path: "result", payload: HindsightTemplateResultRequestSchema.parse(input.request),
      schema: HindsightTemplateResultSchema, context: input.context }),
    templateRefreshResult: (input) => call(request, { path: "refresh-result", payload: HindsightTemplateRefreshResultRequestSchema.parse(input.request),
      schema: HindsightTemplateRefreshResultSchema, context: input.context }),
    templateLabelEvidence: (input) => call(request, { path: "label-evidence", payload: HindsightTemplateLabelEvidenceRequestSchema.parse(input.request),
      schema: HindsightTemplateLabelEvidenceResponseSchema, context: input.context }),
  };
}

async function call<T>(request: Request, input: {
  path: string; payload: unknown; schema: z.ZodType<T>; context: HindsightCallContext;
}): Promise<T> {
  const body = JSON.stringify(input.payload);
  if (new TextEncoder().encode(body).byteLength > HINDSIGHT_TEMPLATE_MAX_BYTES) throw new HindsightTemplateRefusal("request_too_large");
  const result = await request<T | Failure>({
    path: `/ext/taki-memory/template/${input.path}`, init: { method: "POST", body }, context: input.context,
    schema: input.schema, maxResponseBytes: HINDSIGHT_TEMPLATE_MAX_BYTES, decodeJson: parseHindsightApplicationJson,
    responses: { 403: HindsightTemplateFailureSchema, 409: HindsightTemplateFailureSchema,
      413: HindsightTemplateFailureSchema, 422: HindsightTemplateFailureSchema, 503: HindsightTemplateFailureSchema },
  });
  const refusal = HindsightTemplateFailureSchema.safeParse(result);
  if (refusal.success) throw new HindsightTemplateRefusal(refusal.data.reason);
  return input.schema.parse(result);
}
