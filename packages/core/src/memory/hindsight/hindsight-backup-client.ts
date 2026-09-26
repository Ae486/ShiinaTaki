/**
 * INPUT:  the Shared native backup request or a native-host ZIP file name, and the existing authenticated, deadline-bound requester
 * OUTPUT: createNativeBackup/nativeBackupDigest methods over the opt-in TAKI-HS-013 routes, answering a closed refusal (route
 *         absent, backup in progress/exists, artifact missing) as a value and every other failure as a HindsightError
 * POS:    core/memory/hindsight — transport-only backup calls; the ZIP never crosses (only its proof and digest), no pairing here
 */
import { z } from "zod";
import { HindsightBackupNativeRequestSchema, type HindsightBackupNativeRequest } from "@taki/shared";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";
import { hindsightError } from "./hindsight-errors.ts";

const BACKUPS_PATH = "/ext/taki-memory/admin/backups";
const Digest = z.string().regex(/^[0-9a-f]{64}$/);
export const HindsightNativeBackupFileSchema = z.string().regex(/^taki-backup-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$/);

/** The proof body is judged by the Shared proof schema once the artifact digest joins it. */
const NativeBackupWireSchema = z.strictObject({
  version: z.literal(1), backupId: z.uuid(), schema: z.string().min(1).max(120),
  proof: z.record(z.string(), z.unknown()),
  artifact: z.strictObject({ location: z.literal("native-host"), fileName: HindsightNativeBackupFileSchema, sha256: Digest, bytes: z.int().positive() }),
});
export type HindsightNativeBackupWire = z.infer<typeof NativeBackupWireSchema>;
const DigestWireSchema = z.strictObject({ fileName: HindsightNativeBackupFileSchema, sha256: Digest, bytes: z.int().positive() });
const RefusalSchema = <R extends z.ZodType<string>>(reason: R) => z.object({ error: z.literal("taki_backup_refused"), reason });
/** A disabled route is absent: native answers FastAPI's plain not-found body, never a Taki refusal. */
const AbsentRouteSchema = z.object({ detail: z.string() });

export type HindsightNativeBackupResult =
  | { state: "created"; backup: HindsightNativeBackupWire }
  | { state: "refused"; reason: "route_absent" | "backup_in_progress" | "backup_exists" };
export type HindsightNativeBackupDigest =
  | { state: "found"; sha256: string; bytes: number }
  | { state: "refused"; reason: "route_absent" | "artifact_not_found" };

export interface HindsightBackupClient {
  createNativeBackup(input: { request: HindsightBackupNativeRequest; context: HindsightCallContext }): Promise<HindsightNativeBackupResult>;
  nativeBackupDigest(input: { fileName: string; context: HindsightCallContext }): Promise<HindsightNativeBackupDigest>;
}

export function createHindsightBackupMethods(request: <T>(input: HindsightRequestInput<T>) => Promise<T>): HindsightBackupClient {
  return {
    createNativeBackup: (input) => request<HindsightNativeBackupResult>({
      path: BACKUPS_PATH, init: { method: "POST", body: requestBody(input.request) }, context: input.context,
      schema: { parse: (raw) => ({ state: "created", backup: NativeBackupWireSchema.parse(raw) }) },
      responses: {
        404: { parse: (raw) => (AbsentRouteSchema.parse(raw), { state: "refused", reason: "route_absent" }) },
        409: { parse: (raw) => ({ state: "refused", reason: RefusalSchema(z.enum(["backup_in_progress", "backup_exists"])).parse(raw).reason }) },
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
  try { return JSON.stringify(HindsightBackupNativeRequestSchema.parse(value)); }
  catch { throw hindsightError("HINDSIGHT_RESPONSE_INVALID"); }
}
