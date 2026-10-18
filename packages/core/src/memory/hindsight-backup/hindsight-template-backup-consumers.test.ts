import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hindsightTemplateBackupObservationValue, type HindsightTemplateBackupObservationResponse } from "@taki/shared";
import { templateBackupConsumerFixture } from "../../testing/hindsight-template-backup-consumer-fixture.ts";
import { readHindsightBackupCopy } from "./hindsight-backup-copy-readback.ts";
import { hindsightBackupHash } from "./hindsight-template-backup-integrity.ts";
import { openDatabase, openReadonlyDatabase } from "../../db/sqlite.ts";
import { digestFile } from "./hindsight-backup-files.ts";
import { validateHindsightRestoreCore } from "./hindsight-backup-restore.ts";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of closers.splice(0)) await close(); });
async function harness(scenario: "unselected" | "selected" | "removed" = "selected") {
  const h = await templateBackupConsumerFixture(scenario); closers.unshift(h.close); return h;
}
function rehashObservations(value: HindsightTemplateBackupObservationResponse) {
  for (const bank of value.proof.templates) if (bank.selected.state === "selected") {
    const observation = bank.selected.configurationObservation;
    observation.observationHash = hindsightBackupHash("observation", hindsightTemplateBackupObservationValue(bank.target, observation));
  }
  return value;
}

describe("actual backup-v2 Core consumers", () => {
  it("route-c capture and native-host verify enforce the same selected inventory and full projection", async () => {
    const h = await harness();
    const good = await h.captureNative(); expect(good.result).toMatchObject({ ok: true }); expect(good.verified).toMatchObject({ ok: true });
    for (const field of ["inventory", "definition"] as const) {
      const bad = await h.captureNative((proof) => {
        if (field === "inventory") proof.templates[0]!.receiptInventory.count++;
        else { const selected = proof.templates[0]!.selected; if (selected.state === "selected") selected.definitionProjectionHash = "f".repeat(64); }
      });
      expect(bad.result).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_PAIR_MISMATCH" });
      expect(h.joint.store.readSync(bad.backupId)).toBeNull();
    }
  }, 45_000);

  it("actual unknown dispatch and missing hold evidence both refuse capture without clearing the original plan", async () => {
    const h = await harness();
    h.source.native.hooks.before = (call) => { if (call.method === "apply") throw new Error("isolated unknown dispatch"); };
    await expect(h.joint.apply(h.joint.fixture.params())).rejects.toThrow();
    const db = h.joint.fixture.db;
    const hold = db.prepare("SELECT * FROM hindsight_template_holds WHERE state='active'").get();
    expect(hold).toBeDefined();
    expect(db.prepare("SELECT * FROM hindsight_template_dispatches WHERE plan_id=:id").all({ id: String(hold!.plan_id) }).length).toBeGreaterThan(0);
    await expect(h.joint.capture()).rejects.toThrow("HINDSIGHT_BACKUP_TEMPLATE_UNPUBLISHED");
    expect(db.prepare("SELECT * FROM hindsight_template_holds WHERE state='active'").get()).toEqual(hold);
    db.exec("DROP TRIGGER hindsight_template_hold_no_delete");
    db.prepare("DELETE FROM hindsight_template_holds WHERE plan_id=:id").run({ id: String(hold!.plan_id) });
    await expect(h.joint.capture()).rejects.toThrow();
    expect(await h.joint.store.list()).toEqual([]);
  }, 30_000);

  it.each(["unselected", "selected", "removed"] as const)(
    "captures, admits, verifies and restores %s history before the explicit stopped-writer trap", async (scenario) => {
      const h = await harness(scenario); const capture = await h.joint.capture();
      const copied = readHindsightBackupCopy(capture.corePath, capture.staged.core, capture.staged.request);
      expect(copied.version).toBe(2);
      if (copied.version !== 2) throw new Error("v2 copy required");
      expect(copied.state.attestation.banks.every((bank) => bank.selected === null)).toBe(scenario === "unselected");
      await h.artifact(capture);
      expect(await h.admit(capture.backupId)).toMatchObject({ ok: true });
      const calls = h.observer.requests.length;
      expect(await h.verify(capture.backupId)).toMatchObject({ ok: true });
      expect(h.observer.requests).toHaveLength(calls);
      const writerStart = vi.fn(); const restored = await h.preflight(capture.backupId, writerStart);
      expect(restored.banks).toHaveLength(2); expect(writerStart).toHaveBeenCalledOnce();
      expect(h.observer.requests).toHaveLength(calls + 1);
    }, 30_000);

  it("refuses changed staged request and copied SQLite even if their metadata is consistently repinned", async () => {
    const h = await harness(); const capture = await h.joint.capture(); await h.artifact(capture);
    const requestPath = join(h.joint.store.root, `${capture.backupId}.staged`, "native-request.json");
    const original = readFileSync(requestPath); const request = JSON.parse(original.toString());
    request.createdAt = "2026-10-07T00:00:00.000Z"; writeFileSync(requestPath, JSON.stringify(request));
    expect(await h.admit(capture.backupId)).toMatchObject({ ok: false });
    writeFileSync(requestPath, original);
    const db = openDatabase({ path: capture.corePath, migrations: [] });
    try {
      db.exec("DROP TRIGGER hindsight_template_users_immutable_update");
      db.prepare("UPDATE hindsight_template_users SET document_hash=:hash WHERE revision=0").run({ hash: "f".repeat(64) });
    } finally { db.close(); }
    const identityPath = join(h.joint.store.root, `${capture.backupId}.staged`, "core-identity.json");
    const identity = JSON.parse(readFileSync(identityPath, "utf8")); Object.assign(identity.core, await digestFile(capture.corePath));
    writeFileSync(identityPath, JSON.stringify(identity));
    expect(await h.admit(capture.backupId)).toMatchObject({ ok: false });
    expect(existsSync(join(h.joint.store.root, "inbox", "consumer-native.zip"))).toBe(true);
    expect(await h.joint.store.list()).toEqual([]);
  }, 30_000);

  it("keeps historical admit/verify independent of today's resolver, and refuses fresh target drift before writer start", async () => {
    const h = await harness(); const capture = await h.joint.capture(); await h.artifact(capture);
    h.observer.state.before = () => { throw new Error("current resolver unavailable"); };
    expect(await h.admit(capture.backupId)).toMatchObject({ ok: true });
    expect(await h.verify(capture.backupId)).toMatchObject({ ok: true });
    const writerStart = vi.fn(); await expect(h.preflight(capture.backupId, writerStart)).rejects.toThrow();
    h.observer.state.before = undefined;
    const changes: Array<[string, (value: HindsightTemplateBackupObservationResponse) => void]> = [
      ["nonce", (value) => { value.nonce = randomUUID(); }],
      ["schema", (value) => { value.schema = "different_schema"; }],
      ["context", (value) => { for (const bank of value.proof.templates) if (bank.selected.state === "selected") bank.selected.configurationObservation.contextHash = "f".repeat(64); }],
      ["inherited config", (value) => { for (const bank of value.proof.templates) if (bank.selected.state === "selected") { bank.selected.inheritedConfigHash = "f".repeat(64); bank.selected.configurationObservation.inheritedConfigHash = "f".repeat(64); } }],
      ["definition", (value) => { for (const bank of value.proof.templates) if (bank.selected.state === "selected") bank.selected.definitionProjectionHash = "f".repeat(64); }],
      ["incarnation", (value) => { const generation = randomUUID(); value.proof.banks[0]!.bankGeneration = generation; value.proof.templates[0]!.target.bank_generation = generation; }],
      ["undeclared receipt", (value) => { value.proof.templates[0]!.receiptInventory.count++; }],
    ];
    for (const [name, change] of changes) {
      h.observer.state.response = (value) => { change(value); return rehashObservations(value); };
      await expect(h.preflight(capture.backupId, writerStart), name).rejects.toThrow();
      expect(await h.verify(capture.backupId), name).toMatchObject({ ok: true });
    }
    expect(writerStart).not.toHaveBeenCalled();
    h.observer.state.response = undefined;
    await h.preflight(capture.backupId, writerStart); expect(writerStart).toHaveBeenCalledOnce();
  }, 60_000);

  it("rejects independently changed ZIP proof inventory and incarnation without consuming the staged copy", async () => {
    const h = await harness(); const capture = await h.joint.capture();
    for (const change of [
      (proof: HindsightTemplateBackupObservationResponse["proof"]) => { proof.templates[0]!.receiptInventory.count++; },
      (proof: HindsightTemplateBackupObservationResponse["proof"]) => { const generation = randomUUID(); proof.banks[0]!.bankGeneration = generation; proof.templates[0]!.target.bank_generation = generation; },
      (proof: HindsightTemplateBackupObservationResponse["proof"]) => { proof.receipts.missingCount = 1; proof.receipts.missingSample = [capture.staged.request.operationIds[0]!]; },
    ]) {
      await h.artifact(capture, change); expect(await h.admit(capture.backupId)).toMatchObject({ ok: false });
      expect(await h.joint.store.readStaged(capture.backupId)).not.toBeNull();
      expect(existsSync(join(h.joint.store.root, "inbox", "consumer-native.zip"))).toBe(true);
    }
    await h.artifact(capture); expect(await h.admit(capture.backupId)).toMatchObject({ ok: true });
  }, 30_000);

  it("historical verify and direct restore reread corrupt or missing nonselected history despite repinned file digests", async () => {
    const h = await harness("removed"); const capture = await h.joint.capture(); await h.artifact(capture);
    expect(await h.admit(capture.backupId)).toMatchObject({ ok: true });
    const path = h.joint.store.corePath(capture.backupId); const original = readFileSync(path);
    const manifestPath = join(h.joint.store.root, capture.backupId, "manifest.json");
    const manifestBytes = readFileSync(manifestPath);
    for (const missing of [false, true]) {
      writeFileSync(path, original); writeFileSync(manifestPath, manifestBytes);
      const db = openDatabase({ path, migrations: [] });
      try {
        db.exec(`DROP TRIGGER hindsight_template_users_immutable_${missing ? "delete" : "update"}`);
        if (missing) { db.exec("PRAGMA foreign_keys=OFF"); db.prepare("DELETE FROM hindsight_template_users WHERE revision=0").run(); }
        else db.prepare("UPDATE hindsight_template_users SET document_hash=:hash WHERE revision=0").run({ hash: "f".repeat(64) });
      } finally { db.close(); }
      const manifest = JSON.parse(manifestBytes.toString()); const digest = await digestFile(path); Object.assign(manifest.core, digest);
      writeFileSync(manifestPath, JSON.stringify(manifest));
      expect(await h.verify(capture.backupId)).toMatchObject({ ok: false });
      const readonly = openReadonlyDatabase(path);
      try { expect(() => validateHindsightRestoreCore(readonly, { manifest, native: manifest.native.proof,
        nativeSchema: manifest.native.schema, coreSha256: digest.sha256, coreBytes: digest.bytes, missingCredentials: () => [] })).toThrow(); }
      finally { readonly.close(); }
    }
  }, 45_000);
});
