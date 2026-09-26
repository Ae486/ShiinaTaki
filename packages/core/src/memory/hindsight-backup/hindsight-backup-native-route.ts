/**
 * INPUT:  the live Hindsight connection read (config + secret marker, no network), a client factory over it and a Logger
 * OUTPUT: createHindsightNativeBackupRoute() — the production route c: sends the native request to the opt-in TAKI-HS-013
 *         endpoint, composes the Shared native proof from its proof body and the native-host ZIP digest, and reads that digest back
 * POS:    core/memory/hindsight-backup — the production HindsightNativeBackupRoute (owner PR02); a disabled endpoint is
 *         ROUTE_UNAVAILABLE, a native backup already running (single-flight) is NATIVE_FAILED with a logged reason, anything else
 *         NATIVE_FAILED; the ZIP stays on the native host
 */
import { HindsightBackupNativeProofSchema, type HindsightConnectionProjection } from "@taki/shared";
import type { Logger } from "../../logging/logger.ts";
import type { HindsightNativeBackupResult, HindsightNativeBackupWire } from "../hindsight/hindsight-backup-client.ts";
import type { HindsightClient } from "../hindsight/hindsight-client.ts";
import { HindsightError } from "../hindsight/hindsight-errors.ts";
import type { HindsightLiveProjection } from "../hindsight/hindsight-runtime-connection.ts";
import { HindsightBackupFailure } from "./hindsight-backup-failure.ts";
import type { HindsightNativeBackupRoute, HindsightNativeBackupSnapshot } from "./hindsight-backup-route.ts";

/** An upper bound only: the capture's own native deadline aborts the call through its signal first. */
const SNAPSHOT_TIMEOUT_MS = 600_000;
const READ_BACK_TIMEOUT_MS = 60_000;

export interface HindsightNativeBackupRouteDeps {
  connection(): HindsightLiveProjection;
  client(projection: HindsightConnectionProjection): HindsightClient;
  logger: Logger;
}

export function createHindsightNativeBackupRoute(deps: HindsightNativeBackupRouteDeps): HindsightNativeBackupRoute {
  return {
    available: () => deps.connection().state === "ready",
    snapshot: ({ signal, ...request }) => logged(deps.logger, async () => {
      const api = client(deps);
      if (!api.createNativeBackup) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_NATIVE_FAILED");
      const result = await api.createNativeBackup({ request, context: { signal, timeoutMs: SNAPSHOT_TIMEOUT_MS } });
      if (result.state === "refused") throw refused(deps.logger, result.reason);
      return snapshotOf(request.backupId, result.backup);
    }),
    readBack: ({ file, signal }) => logged(deps.logger, async () => {
      const api = client(deps);
      if (!api.nativeBackupDigest) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_NATIVE_FAILED");
      const result = await api.nativeBackupDigest({ fileName: file, context: { signal, timeoutMs: READ_BACK_TIMEOUT_MS } });
      if (result.state === "found") return { sha256: result.sha256, bytes: result.bytes };
      if (result.reason === "artifact_not_found") return null;
      throw new HindsightBackupFailure("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE");
    }),
  };
}

function client(deps: HindsightNativeBackupRouteDeps): HindsightClient {
  const live = deps.connection();
  if (live.state !== "ready") throw new HindsightBackupFailure("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE");
  return deps.client(live.projection);
}

function refused(logger: Logger, reason: Extract<HindsightNativeBackupResult, { state: "refused" }>["reason"]): HindsightBackupFailure {
  if (reason === "route_absent") return new HindsightBackupFailure("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE");
  logger.warn({ code: "HINDSIGHT_BACKUP_NATIVE_FAILED", reason }, "native backup endpoint refused the snapshot");
  return new HindsightBackupFailure("HINDSIGHT_BACKUP_NATIVE_FAILED");
}

/** The echoed id proves the native snapshot answers this capture; the ZIP digest completes the proof the pair check judges. */
function snapshotOf(backupId: string, wire: HindsightNativeBackupWire): HindsightNativeBackupSnapshot {
  const proof = HindsightBackupNativeProofSchema.safeParse({ ...wire.proof, zipSha256: wire.artifact.sha256, zipBytes: wire.artifact.bytes });
  if (wire.backupId !== backupId || !proof.success) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_NATIVE_FAILED");
  return { proof: proof.data, artifact: { location: "native-host", file: wire.artifact.fileName }, schema: wire.schema };
}

/** A sanitized client failure names only its stable code; the backup code the caller maps it to stays closed. */
async function logged<T>(logger: Logger, call: () => Promise<T>): Promise<T> {
  try { return await call(); }
  catch (error) {
    if (error instanceof HindsightError) logger.warn({ code: "HINDSIGHT_BACKUP_NATIVE_FAILED", cause: error.code }, "native backup call failed");
    throw error;
  }
}
