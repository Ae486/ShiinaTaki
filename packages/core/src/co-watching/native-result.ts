/**
 * INPUT: governed media-bridge result and the operator's original exact analysis reference
 * OUTPUT: verified native identity and original moments, including explicitly unknown ends
 * POS: core/co-watching — external-result adapter; result text is data and never grants authority
 */
import { z } from "zod";
import { BrowserMediaIdentitySchema, type CoWatchingAnalysis } from "@taki/shared";

const NativeIdentity = z.strictObject({ service_instance_id: z.uuid(), request_id: z.uuid(), job_id: z.uuid() });
const Moment = z.object({ moment_id: z.string().min(1).max(160), at_seconds: z.number().nonnegative(),
  end_seconds: z.number().nonnegative().nullable(), content: z.string().max(32_000) });
const Native = z.object({ schema_version: z.literal("bilinote.media-result.v1"), identity: NativeIdentity,
  source: z.object({ binding: z.literal("exact"), resolved: BrowserMediaIdentitySchema }),
  duration: z.object({ seconds: z.number().positive(), platform_seconds: z.number().positive().nullable() }),
  analysis: z.object({ format: z.literal("media_v1"), markdown: z.string().max(512_000), moments: z.array(Moment).max(2048) }) });
const Complete = z.object({ ok: z.literal(true), complete: z.literal(true), identity: NativeIdentity,
  sha256: z.string().regex(/^[0-9a-f]{64}$/), result: z.unknown() });
const Envelope = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() });
export type CoWatchingNative = z.infer<typeof Native>;

export function verifyCoWatchingNative(raw: unknown, expected: CoWatchingAnalysis): { native: CoWatchingNative; complete: unknown } {
  const envelope = Envelope.parse(raw);
  if (envelope.isError) throw new Error("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  const text = envelope.content?.find((item) => item.type === "text")?.text;
  if (text && Buffer.byteLength(text, "utf8") > 16 * 1024 * 1024) throw new Error("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  const result = Complete.parse(envelope.structuredContent ?? (text ? JSON.parse(text) : undefined));
  const native = Native.parse(result.result);
  const identity = { service_instance_id: expected.native.serviceInstanceId, request_id: expected.native.requestId,
    job_id: expected.native.jobId };
  if (JSON.stringify(result.identity) !== JSON.stringify(identity) || JSON.stringify(native.identity) !== JSON.stringify(identity)
    || result.sha256 !== expected.native.sha256 || JSON.stringify(native.source.resolved) !== JSON.stringify(expected.media)) {
    throw new Error("CO_WATCHING_ANALYSIS_MISMATCH");
  }
  if (new Set(native.analysis.moments.map((moment) => moment.moment_id)).size !== native.analysis.moments.length
    || native.analysis.moments.some((moment) => moment.at_seconds > native.duration.seconds
      || (moment.end_seconds !== null && (moment.end_seconds < moment.at_seconds || moment.end_seconds > native.duration.seconds)))) {
    throw new Error("CO_WATCHING_ANALYSIS_MISMATCH");
  }
  return { native, complete: result.result };
}
