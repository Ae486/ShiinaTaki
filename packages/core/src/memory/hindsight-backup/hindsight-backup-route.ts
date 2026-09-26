/**
 * INPUT:  a Core-minted backup id, the committed provider lineage, the native Bank ids and the Core terminal-operation ids
 * OUTPUT: HindsightNativeBackupRoute (native snapshot request -> native proof + artifact reference) and
 *         createUnavailableHindsightBackupRoute(), the production route until the native backup endpoint lands
 * POS:    core/memory/hindsight-backup — capture step 5 seam (§6); the route never receives Core cursors, it reports native
 *         truth read in the same REPEATABLE READ transaction as its snapshot and the pair check judges it
 */
import type { HindsightBackupNativeProof, HindsightBackupNativeRequest } from "@taki/shared";

/** The same request body route b writes as `native-request.json`; the proof answers membership for exactly its operation ids. */
export type HindsightNativeBackupRequest = HindsightBackupNativeRequest & { signal: AbortSignal };

export interface HindsightNativeBackupSnapshot {
  proof: HindsightBackupNativeProof;
  /** The native ZIP stays on the native host; a Core-held copy needs a store writer the native endpoint does not have yet. */
  artifact: { location: "native-host"; file: string };
  schema: string;
}

export interface HindsightNativeBackupRoute {
  /** False when no native backup endpoint is configured; a route-c capture then fails before pausing anything. */
  available(): boolean;
  snapshot(request: HindsightNativeBackupRequest): Promise<HindsightNativeBackupSnapshot>;
}

/** Deferred to W5: no native backup endpoint exists yet, so every route-c capture fails ROUTE_UNAVAILABLE (route b still works). */
export function createUnavailableHindsightBackupRoute(): HindsightNativeBackupRoute {
  return {
    available: () => false,
    snapshot: () => Promise.reject(new Error("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE")),
  };
}
