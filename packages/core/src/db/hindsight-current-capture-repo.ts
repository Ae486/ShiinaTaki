/**
 * INPUT:  a lease-owned selected Local manifest and the synchronous database
 * OUTPUT: immutable complete D78 capture, validated again on every reopen
 * POS:    core/db — durable migration evidence survives replica reseeding and native retries
 */
import type { HindsightCurrentCapture } from "@taki/shared";
import { canonicalJson } from "../memory/legacy-migration/legacy-identities.ts";
import { assertHindsightCurrentCapture, readHindsightCurrentCapture } from "./hindsight-current-capture-reader.ts";
import type { HindsightCutoverLease } from "./hindsight-cutover-run-repo.ts";
import { createHindsightLocalCoverageRepo, reserveHindsightLocalWriter } from "./hindsight-local-coverage-repo.ts";
import type { Database } from "./sqlite.ts";

export interface HindsightCurrentCaptureInput {
  lease: HindsightCutoverLease; manifestId: string; expectedEpochId: string; now: string;
}

export function captureHindsightCurrentLocal(db: Database, input: HindsightCurrentCaptureInput): HindsightCurrentCapture {
  let capture: HindsightCurrentCapture | undefined;
  db.transaction(() => {
    reserveHindsightLocalWriter(db, input.expectedEpochId);
    requireCurrentCaptureLease(db, input);
    const coverage = createHindsightLocalCoverageRepo(db); const manifest = coverage.selected(input.lease.runId);
    if (!manifest || manifest.manifestId !== input.manifestId) throw new Error("HINDSIGHT_LOCAL_COVERAGE_SELECTION_STALE");
    coverage.assertCurrent(manifest.manifestId);
    const existing = readHindsightCurrentCaptureByManifest(db, manifest.manifestId);
    capture = existing ?? readHindsightCurrentCapture(db, manifest);
    if (existing) return;
    db.prepare(`INSERT INTO hindsight_current_captures
      (capture_id,run_id,manifest_id,manifest_digest,local_epoch_id,capture_json)
      VALUES (:id,:run,:manifest,:digest,:epoch,:json)`)
      .run({ id: capture.captureId, run: manifest.runId, manifest: manifest.manifestId,
        digest: manifest.manifestDigest, epoch: manifest.localEpochId, json: canonicalJson(capture) });
  });
  if (!capture) throw new Error("HINDSIGHT_CURRENT_CAPTURE_INCOMPLETE");
  return capture;
}

export function readHindsightCurrentCaptureByManifest(db: Database, manifestId: string): HindsightCurrentCapture | undefined {
  const row = db.prepare("SELECT * FROM hindsight_current_captures WHERE manifest_id=:id").get({ id: manifestId });
  if (!row) return undefined;
  const capture = assertHindsightCurrentCapture(JSON.parse(String(row.capture_json)));
  if (capture.captureId !== row.capture_id || capture.manifest.manifestId !== row.manifest_id
    || capture.manifest.runId !== row.run_id || capture.manifest.localEpochId !== row.local_epoch_id
    || capture.manifest.manifestDigest !== row.manifest_digest) throw new Error("HINDSIGHT_CURRENT_CAPTURE_CORRUPT");
  return capture;
}

export function requireCurrentCaptureLease(db: Database, input: { lease: HindsightCutoverLease; now: string }): void {
  const row = db.prepare(`SELECT 1 AS valid FROM hindsight_cutover_runs WHERE run_id=:run AND lease_owner=:owner
    AND lease_fence=:fence AND lease_expires_at>:now AND status IN ('running','ready')`)
    .get({ run: input.lease.runId, owner: input.lease.owner, fence: input.lease.fence, now: input.now });
  if (!row) throw new Error("LEASE_LOST");
}
