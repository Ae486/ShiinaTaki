/**
 * INPUT: retained exact media/request identity and captured governed native tool execution
 * OUTPUT: one submission/status reconciliation step and an exactly verified reusable result
 * POS: core/co-watching — shared native progression; callers own acceptance, waiting and publication
 */
import { z } from "zod";
import type { CoWatchingAnalysis, CoWatchingAnalysisRequest } from "@taki/shared";
import type { CoWatchingCatalog } from "./analysis-catalog.ts";
import type { CoWatchingAnalysisTools } from "./runtime-types.ts";
import { verifyCoWatchingNative } from "./native-result.ts";

const Identity = z.object({ service_instance_id: z.uuid(), request_id: z.uuid(), job_id: z.uuid() });
const Receipt = z.object({ identity: Identity, task_id: z.uuid(), disposition: z.enum(["reserved", "running", "succeeded", "failed", "interrupted"]) });
const Status = z.object({ identity: Identity, state: z.enum(["queued", "running", "succeeded", "failed", "not_found", "unknown"]),
  result: z.object({ availability: z.string(), artifact: z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }).nullable() }) });
const Envelope = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() });
const Failure = z.object({ ok: z.literal(false), code: z.string().optional(), error: z.object({ code: z.string() }).optional() });

export interface NativeAnalysisProgress {
  analysis?: CoWatchingAnalysis;
  analysisRequest?: CoWatchingAnalysisRequest;
  analysisTools?: CoWatchingAnalysisTools;
  submitAnalysis?: boolean;
  submissionAllowed?: boolean;
  analysisFailures?: number;
}
interface NativeAnalysisPorts {
  catalog: CoWatchingCatalog;
  execute(input: { key: string; args: unknown }): Promise<unknown>;
  wait(): false;
  cancelled(): boolean;
  accept(result: ReturnType<typeof verifyCoWatchingNative>): Promise<void>;
  title?: string;
  /** A probe cannot silently follow a replacement service between access verification and submission. */
  serviceInstanceId?: string;
}

export function unwrapNativeAnalysisResult(raw: unknown): unknown {
  const direct = Failure.safeParse(raw);
  if (direct.success) throw new Error(direct.data.code ?? direct.data.error?.code ?? "native_unavailable");
  const envelope = Envelope.parse(raw);
  const text = envelope.content?.find((entry) => entry.type === "text")?.text;
  if (text && Buffer.byteLength(text, "utf8") > 512 * 1024) throw new Error("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  const result: unknown = envelope.structuredContent ?? (text ? JSON.parse(text) : undefined);
  const failed = Failure.safeParse(result);
  if (failed.success) throw new Error(failed.data.error?.code ?? failed.data.code ?? "native_unavailable");
  if (envelope.isError) throw new Error("native_unavailable");
  return result;
}

export async function advanceNativeAnalysis(progress: NativeAnalysisProgress, ports: NativeAnalysisPorts): Promise<boolean> {
  if (progress.analysis) return true;
  try { return await reconcile(progress, ports); }
  catch (error) {
    if (ports.cancelled()) throw error;
    const code = error instanceof Error ? error.message : "";
    if (!["native_unavailable", "submission_outcome_unknown", "OUTCOME_UNKNOWN", "request_not_found"].includes(code)) throw error;
    progress.analysisFailures = (progress.analysisFailures ?? 0) + 1;
    if (progress.analysisFailures >= 5) throw new Error("CO_WATCHING_ANALYSIS_UNKNOWN", { cause: error });
    // Only definitive absence in the original still-current acceptance permits the SAME idempotent key.
    // Reopening a retained request never grants permission to replay it on a different service generation.
    if (code === "request_not_found" && progress.submissionAllowed) progress.submitAnalysis = true;
    return ports.wait();
  }
}

async function reconcile(progress: NativeAnalysisProgress, ports: NativeAnalysisPorts): Promise<boolean> {
  const request = progress.analysisRequest; const tools = progress.analysisTools;
  if (!request || !tools) throw new Error("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  if (!request.identity) return submitOrLookup(progress, ports);
  if (ports.serviceInstanceId && request.identity.serviceInstanceId !== ports.serviceInstanceId) throw new Error("CO_WATCHING_ANALYSIS_MISMATCH");
  const args = { client_request_id: request.requestId, job_id: request.identity.jobId };
  const status = Status.parse(unwrapNativeAnalysisResult(await ports.execute({ key: tools.status, args })));
  if (status.identity.service_instance_id !== request.identity.serviceInstanceId || status.identity.request_id !== request.requestId
    || status.identity.job_id !== request.identity.jobId) throw new Error("CO_WATCHING_ANALYSIS_MISMATCH");
  if (status.state === "failed") throw new Error("CO_WATCHING_ANALYSIS_FAILED");
  if (["not_found", "unknown"].includes(status.state)) throw new Error("native_unavailable");
  progress.analysisFailures = 0;
  if (status.state !== "succeeded") return ports.wait();
  if (status.result.availability !== "available" || !status.result.artifact) throw new Error("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  const analysis: CoWatchingAnalysis = { analysisId: request.analysisId, revision: 1, serverId: request.serverId,
    title: ports.title ?? `${request.media.bvid} · P${request.media.page}`, media: request.media,
    native: { ...request.identity, requestId: request.requestId, sha256: status.result.artifact.sha256 } };
  const raw = await ports.execute({ key: tools.result, args: { ...args, include_complete: true } });
  const verified = verifyCoWatchingNative(raw, analysis);
  const previous = ports.catalog.get(analysis.analysisId);
  if (previous && (previous.native.requestId !== analysis.native.requestId || previous.native.jobId !== analysis.native.jobId
    || previous.native.serviceInstanceId !== analysis.native.serviceInstanceId || previous.native.sha256 !== analysis.native.sha256)) throw new Error("CO_WATCHING_ANALYSIS_MISMATCH");
  progress.analysis = previous ?? ports.catalog.register({ analysisId: analysis.analysisId, title: analysis.title,
    media: analysis.media, serverId: analysis.serverId, native: analysis.native, expectedRevision: 0 });
  await ports.accept(verified);
  return true;
}

async function submitOrLookup(progress: NativeAnalysisProgress, ports: NativeAnalysisPorts): Promise<false> {
  const request = progress.analysisRequest; const tools = progress.analysisTools;
  if (!request || !tools) throw new Error("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  const submit = progress.submitAnalysis === true;
  // The UUID has already been persisted. An uncertain dispatch first requires lookup, never a newly minted key.
  progress.submitAnalysis = false;
  const media = request.media;
  const raw = await ports.execute({ key: submit ? tools.submit : tools.lookup,
    args: submit ? { client_request_id: request.requestId, video_url: `https://www.bilibili.com/video/${media.bvid}?p=${media.page}`,
      output_format: "media_v1", video_understanding: true } : { client_request_id: request.requestId } });
  const receipt = Receipt.parse(unwrapNativeAnalysisResult(raw));
  if (receipt.identity.request_id !== request.requestId || receipt.task_id !== receipt.identity.job_id
    || (ports.serviceInstanceId && receipt.identity.service_instance_id !== ports.serviceInstanceId)) throw new Error("CO_WATCHING_ANALYSIS_MISMATCH");
  progress.analysisRequest = ports.catalog.bind(request.analysisId, { serviceInstanceId: receipt.identity.service_instance_id, jobId: receipt.identity.job_id });
  if (["failed", "interrupted"].includes(receipt.disposition)) throw new Error("CO_WATCHING_ANALYSIS_FAILED");
  progress.analysisFailures = 0;
  return ports.wait();
}
