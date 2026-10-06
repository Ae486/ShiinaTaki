import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryTransitionIntent } from "@taki/shared";
import { openReadonlyDatabase, type Database } from "../../db/sqlite.ts";
import { reserveEmergencyCapture, acknowledgeEmergencyIncident, readEmergencyIncident } from "../../db/memory-transition-emergency-repo.ts";
import { transitionIdentity } from "../../db/memory-transition-fixtures.ts";
import { admitFixtureTransition, W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { DEFAULT_TRANSITION_QUEUE_POLICY } from "../../db/memory-transition-repo.ts";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { backupHarness, HARNESS_BANK, HARNESS_GENERATION, seedVerifiedBank } from "./hindsight-backup-harness.ts";
import { sealEmergencyEvidence } from "./hindsight-backup-emergency.ts";

const dirs: string[] = []; const dbs: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });

function fixture() {
  const h = backupHarness({ dirs, dbs }); seedVerifiedBank(h.db);
  const expected = transitionIdentity();
  expected.banks[0] = { ...expected.banks[0]!, sourceBankId: HARNESS_BANK.bankId, nativeBankId: HARNESS_BANK.bankId,
    nativeGeneration: HARNESS_GENERATION };
  const kind = "transition.emergency-local" as const;
  const intent: MemoryTransitionIntent = { version: 1, transitionId: randomUUID(), operationId: randomUUID(), actorId: "owned-emergency-test",
    admittedAt: W3_AT, queuePolicy: { ...DEFAULT_TRANSITION_QUEUE_POLICY }, incidentId: randomUUID(),
    request: { kind, requestId: randomUUID(), previewId: randomUUID(), expected, confirmation: "emergency-takeover",
      previewHash: canonicalPayloadHash(["taki-transition-preview.v1", kind, expected]) } };
  const lease = admitFixtureTransition(h.db, intent);
  const work = { lease, now: W3_AT };
  const capture = reserveEmergencyCapture(h.db, work);
  return { ...h, intent, work, capture, input: { db: h.db, store: h.store, lastVerified: null, capture } };
}

describe("transition-owned offline incident seal", () => {
  it("binds metadata to the completed copy, preserves original capture and performs no native dispatch", async () => {
    const f = fixture(); const copy = f.db.backupTo.bind(f.db);
    vi.spyOn(f.db, "backupTo").mockImplementation(async (path) => {
      const pages = await copy(path);
      f.db.exec("CREATE TABLE late_after_copy(value TEXT)");
      return pages;
    });
    const native = vi.spyOn(f.route, "snapshot").mockImplementation(() => new Promise(() => undefined));
    const result = await sealEmergencyEvidence(f.input);
    expect(result.manifest.transition?.capture).toEqual(f.capture);
    expect(result.manifest.transition?.tables.some((table) => table.table === "late_after_copy")).toBe(false);
    expect(result.manifest.transition?.banks).toMatchObject([{ bankId: HARNESS_BANK.bankId, evidence: "native-only",
      replicaCursor: 5, applicationNativeCursor: null, remoteHead: "unknown", remoteLoss: "unknown" }]);
    expect(native).not.toHaveBeenCalled();
    const path = f.store.incidentCorePath(result.incidentId); const snapshot = openReadonlyDatabase(path);
    try {
      expect(snapshot.prepare("SELECT capture_id FROM memory_transition_emergency_captures").get()?.capture_id).toBe(f.capture.captureId);
      expect(() => snapshot.exec("CREATE TABLE forbidden(value TEXT)")).toThrow();
    } finally { snapshot.close(); }
    expect(readdirSync(join(f.store.root, `incident-${result.incidentId}`)).sort()).toEqual(["core.sqlite", "manifest.json"]);
  });

  it("recovers a completed seal after lost reply by the same identity without a second copy", async () => {
    const f = fixture(); const write = f.store.writeIncident.bind(f.store);
    vi.spyOn(f.store, "writeIncident").mockImplementationOnce(async (id, input) => { await write(id, input); throw new Error("owned lost seal reply"); });
    await expect(sealEmergencyEvidence(f.input)).rejects.toThrow("lost seal reply");
    expect(readEmergencyIncident(f.db, f.intent.transitionId)).toBeUndefined();
    const copy = vi.spyOn(f.db, "backupTo"); const result = await sealEmergencyEvidence(f.input);
    expect(copy).not.toHaveBeenCalled();
    acknowledgeEmergencyIncident(f.db, { ...f.work, manifest: result.manifest });
    acknowledgeEmergencyIncident(f.db, { ...f.work, manifest: result.manifest });
    expect(readEmergencyIncident(f.db, f.intent.transitionId)).toEqual(result.manifest);
    expect(f.db.prepare("SELECT count(*) AS n FROM memory_transition_incidents").get()?.n).toBe(1);
  });

  it("refuses conflicting capture association and corrupt bytes without overwriting a sealed artifact", async () => {
    const f = fixture(); const result = await sealEmergencyEvidence(f.input);
    const path = f.store.incidentCorePath(result.incidentId); const before = readFileSync(path);
    const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    await expect(sealEmergencyEvidence({ ...f.input, capture: { ...f.capture, captureId: randomUUID() } })).rejects.toThrow("PROOF_INVALID");
    expect(digest(readFileSync(path))).toBe(digest(before));
    appendFileSync(path, "owned corruption");
    await expect(sealEmergencyEvidence(f.input)).rejects.toThrow("ARTIFACT_INVALID");
    expect(readFileSync(path).byteLength).toBeGreaterThan(before.byteLength);
    expect(readEmergencyIncident(f.db, f.intent.transitionId)).toBeUndefined();
  });

  it("keeps an interrupted prior partial untouched and never advertises it as a completed incident", async () => {
    const f = fixture(); const partial = join(f.store.root, `incident-${f.capture.incidentId}.partial`);
    mkdirSync(partial, { recursive: true });
    expect(await f.store.readIncident(f.capture.incidentId)).toBeNull();
    await expect(sealEmergencyEvidence(f.input)).rejects.toThrow();
    expect(readdirSync(f.store.root)).toContain(`incident-${f.capture.incidentId}.partial`);
    expect(await f.store.list()).toEqual([]);
  });

  it("does not acknowledge a failed copy or alter the selected predecessor", async () => {
    const f = fixture(); vi.spyOn(f.db, "backupTo").mockRejectedValue(new Error("owned storage failure"));
    await expect(sealEmergencyEvidence(f.input)).rejects.toThrow("storage failure");
    expect(await f.store.readIncident(f.capture.incidentId)).toBeNull();
    expect(readEmergencyIncident(f.db, f.intent.transitionId)).toBeUndefined();
    expect(f.db.prepare("SELECT active_epoch_id FROM memory_authority_selection").get()?.active_epoch_id).toBe("epoch");
  });
});
