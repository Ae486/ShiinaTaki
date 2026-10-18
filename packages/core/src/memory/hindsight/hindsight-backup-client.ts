/**
 * INPUT:  the Shared native backup request or a native-host ZIP file name, and the existing authenticated, deadline-bound requester
 * OUTPUT: createNativeBackup/nativeBackupDigest methods over the opt-in TAKI-HS-013 routes, answering a closed refusal (route
 *         absent, backup in progress/exists, artifact missing) as a value and every other failure as a HindsightError
 * POS:    core/memory/hindsight — transport-only backup calls; the ZIP never crosses (only its proof and digest), no pairing here
 */
import { z } from "zod";
import { HindsightBackupNativeProofBodyV1Schema, HindsightBackupNativeResponseV2Schema,
  HindsightTemplateBackupObservationRequestSchema, HindsightTemplateBackupObservationResponseSchema, HindsightTemplateBackupFailureSchema,
  HINDSIGHT_TEMPLATE_BACKUP_OBSERVATION_PATH, HINDSIGHT_BACKUP_PROOF_MAX_BYTES, HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES,
  HINDSIGHT_BACKUP_OBSERVATION_REQUEST_MAX_BYTES, parseHindsightApplicationJson,
  type HindsightBackupNativeRequest, type HindsightTemplateBackupObservationRequest,
  type HindsightTemplateBackupObservationResponse, type HindsightTemplateBackupFailure } from "@taki/shared";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";
import { hindsightError } from "./hindsight-errors.ts";
import { readHindsightBackupRequest } from "../hindsight-backup/hindsight-template-backup-integrity.ts";

const BACKUPS_PATH = "/ext/taki-memory/admin/backups";
const Digest = z.string().regex(/^[0-9a-f]{64}$/);
export const HindsightNativeBackupFileSchema = z.string().regex(/^taki-backup-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$/);

/** The proof body is judged by the Shared proof schema once the artifact digest joins it. */
const NativeBackupV1WireSchema = z.strictObject({
  version: z.literal(1), backupId: z.uuid(), schema: z.string().min(1).max(120),
  proof: HindsightBackupNativeProofBodyV1Schema,
  artifact: z.strictObject({ location: z.literal("native-host"), fileName: HindsightNativeBackupFileSchema, sha256: Digest, bytes: z.int().positive() }),
});
const NativeBackupWireSchema = z.discriminatedUnion("version", [NativeBackupV1WireSchema, HindsightBackupNativeResponseV2Schema]);
export type HindsightNativeBackupWire = z.infer<typeof NativeBackupWireSchema>;
const DigestWireSchema = z.strictObject({ fileName: HindsightNativeBackupFileSchema, sha256: Digest, bytes: z.int().positive() });
const RefusalSchema = <R extends z.ZodType<string>>(reason: R) => z.object({ error: z.literal("taki_backup_refused"), reason });
/** A disabled route is absent: native answers FastAPI's plain not-found body, never a Taki refusal. */
const AbsentRouteSchema = z.object({ detail: z.string() });

export type HindsightNativeBackupResult =
  | { state: "created"; backup: HindsightNativeBackupWire }
  | { state: "refused"; reason: "route_absent" | "backup_in_progress" | "backup_exists" | HindsightTemplateBackupFailure["reason"] };
export type HindsightNativeBackupDigest =
  | { state: "found"; sha256: string; bytes: number }
  | { state: "refused"; reason: "route_absent" | "artifact_not_found" };

export interface HindsightBackupClient {
  createNativeBackup(input: { request: HindsightBackupNativeRequest; context: HindsightCallContext }): Promise<HindsightNativeBackupResult>;
  nativeBackupDigest(input: { fileName: string; context: HindsightCallContext }): Promise<HindsightNativeBackupDigest>;
  observeTemplateBackup(input: { request: HindsightTemplateBackupObservationRequest; context: HindsightCallContext }): Promise<HindsightTemplateBackupObservationResponse>;
}

export function createHindsightBackupMethods(request: <T>(input: HindsightRequestInput<T>) => Promise<T>): HindsightBackupClient {
  return {
    createNativeBackup: (input) => request<HindsightNativeBackupResult>({
      path: BACKUPS_PATH, init: { method: "POST", body: requestBody(input.request) }, context: input.context,
      schema: { parse: (raw) => ({ state: "created", backup: readBackupResponse(raw, input.request) }) },
      maxResponseBytes: HINDSIGHT_BACKUP_PROOF_MAX_BYTES, decodeJson: parseHindsightApplicationJson,
      responses: {
        404: { parse: (raw) => (AbsentRouteSchema.parse(raw), { state: "refused", reason: "route_absent" }) },
        403: { parse: templateRefused }, 413: { parse: templateRefused }, 422: { parse: templateRefused }, 503: { parse: templateRefused },
        409: { parse: (raw) => {
          const legacy = RefusalSchema(z.enum(["backup_in_progress", "backup_exists"])).safeParse(raw);
          return legacy.success ? { state: "refused", reason: legacy.data.reason } : templateRefused(raw);
        } },
      },
    }),
    nativeBackupDigest: (input) => request<HindsightNativeBackupDigest>({
      path: `${BACKUPS_PATH}/${fileName(input.fileName)}`, context: input.context,
      schema: { parse: (raw) => {
        const digest = DigestWireSchema.parse(raw);
        if (digest.fileName !== input.fileName) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
        return { state: "found", sha256: digest.sha256, bytes: digest.bytes };
      } },
      responses: { 404: { parse: notFound } },
    }),
    observeTemplateBackup: async (input) => {
      const value = HindsightTemplateBackupObservationRequestSchema.parse(input.request);
      readHindsightBackupRequest(value.request);
      const body = JSON.stringify(value);
      if (Buffer.byteLength(body, "utf8") > HINDSIGHT_BACKUP_OBSERVATION_REQUEST_MAX_BYTES) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
      const result = await request<HindsightTemplateBackupObservationResponse | HindsightTemplateBackupFailure>({
        path: HINDSIGHT_TEMPLATE_BACKUP_OBSERVATION_PATH, init: { method: "POST", body }, context: input.context,
        schema: HindsightTemplateBackupObservationResponseSchema, maxResponseBytes: HINDSIGHT_BACKUP_PROOF_MAX_BYTES,
        decodeJson: parseHindsightApplicationJson, responses: { 403: HindsightTemplateBackupFailureSchema, 409: HindsightTemplateBackupFailureSchema,
          413: HindsightTemplateBackupFailureSchema, 422: HindsightTemplateBackupFailureSchema, 503: HindsightTemplateBackupFailureSchema },
      });
      if ("error" in result) throw new HindsightTemplateBackupRefusal(result.reason);
      if (result.nonce !== value.nonce || result.requestHash !== value.request.requestHash) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
      return result;
    },
  };
}

function notFound(raw: unknown): HindsightNativeBackupDigest {
  if (RefusalSchema(z.literal("artifact_not_found")).safeParse(raw).success) return { state: "refused", reason: "artifact_not_found" };
  AbsentRouteSchema.parse(raw);
  return { state: "refused", reason: "route_absent" };
}

function fileName(value: string): string {
  if (!HindsightNativeBackupFileSchema.safeParse(value).success) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  return value;
}

function requestBody(value: HindsightBackupNativeRequest): string {
  try {
    const body = JSON.stringify(readHindsightBackupRequest(value));
    if (Buffer.byteLength(body, "utf8") > HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
    return body;
  }
  catch { throw hindsightError("HINDSIGHT_RESPONSE_INVALID"); }
}

function readBackupResponse(raw: unknown, request: HindsightBackupNativeRequest): HindsightNativeBackupWire {
  const value = NativeBackupWireSchema.parse(raw);
  if (value.version !== request.version || value.backupId !== request.backupId
    || request.version === 2 && (value.version !== 2 || value.requestHash !== request.requestHash)) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  return value;
}
function templateRefused(raw: unknown): HindsightNativeBackupResult {
  return { state: "refused", reason: HindsightTemplateBackupFailureSchema.parse(raw).reason };
}
export class HindsightTemplateBackupRefusal extends Error {
  readonly reason: HindsightTemplateBackupFailure["reason"];
  constructor(reason: HindsightTemplateBackupFailure["reason"]) {
    super("HINDSIGHT_BACKUP_NATIVE_FAILED"); this.name = "HindsightTemplateBackupRefusal"; this.reason = reason;
  }
}
