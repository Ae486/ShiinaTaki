/**
 * INPUT:  the durable memory_operations ledger
 * OUTPUT: automaticLifecycleAttempted() — whether Core already started an automatic bank.provision for (Character, connection
 *         fingerprint) or connection.revalidate for (epoch, fingerprint), whatever that attempt's outcome
 * POS:    core/db — read-only once-guard for the automatic lifecycle trigger; it reads rows, so it holds across restart
 */
import type { Database } from "./sqlite.ts";

export type AutomaticLifecycleAttempt =
  | { kind: "bank.provision"; characterId: string; configFingerprint: string }
  | { kind: "connection.revalidate"; epochId: string; configFingerprint: string };

export function automaticLifecycleAttempted(db: Database, attempt: AutomaticLifecycleAttempt): boolean {
  const row = attempt.kind === "bank.provision"
    ? db.prepare(`SELECT 1 AS hit FROM memory_operations WHERE kind='bank.provision' AND json_extract(producer_json,'$.origin')='automatic'
        AND json_extract(producer_json,'$.characterId')=:key AND json_extract(producer_json,'$.configFingerprint')=:fingerprint LIMIT 1`)
      .get({ key: attempt.characterId, fingerprint: attempt.configFingerprint })
    : db.prepare(`SELECT 1 AS hit FROM memory_operations WHERE kind='connection.revalidate' AND json_extract(producer_json,'$.origin')='automatic'
        AND json_extract(producer_json,'$.epochId')=:key AND json_extract(producer_json,'$.fingerprintAfter')=:fingerprint LIMIT 1`)
      .get({ key: attempt.epochId, fingerprint: attempt.configFingerprint });
  return row !== undefined;
}
