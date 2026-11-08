import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HINDSIGHT_TEMPLATE_BACKUP_BUILD, type HindsightBackupRoute } from "@taki/shared";
import { createJointTemplateBackupFixture, JOINT_TEMPLATE_USER_MODEL } from "../../testing/hindsight-template-backup-joint-fixture.ts";
import { templateLifecycleFixture } from "../hindsight/template-lifecycle/template-lifecycle-fixtures.ts";
import { TAKI_MANAGED_TEMPLATE_REVISION } from "../hindsight/template-lifecycle/template-catalog.ts";
import { readHindsightBackupCopy } from "./hindsight-backup-copy-readback.ts";
import { readHindsightBackupCustody } from "./hindsight-backup-custody.ts";
import { createHindsightBackupService, type HindsightBackupPhase } from "./hindsight-backup-service.ts";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0)) await close();
});

/** Actual Core admission, publication and SQLite copy; only Native and runtime delegates are synthetic. */
async function harness() {
  const source = templateLifecycleFixture();
  closers.unshift(() => source.close());
  source.service.stop(); await source.owner.stop();
  source.native.manifest.source_identity.compatibility_build = HINDSIGHT_TEMPLATE_BACKUP_BUILD;
  source.native.manifest.contracts.template_backup = {
    version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" },
  };
  const joint = await createJointTemplateBackupFixture({ endpoint: "http://127.0.0.1:18481", client: source.native.client,
    targets: source.base.banks.map((bank) => ({ bank_id: bank.scope.bankId,
      provider_lineage: bank.scope.namespace.provider_lineage, bank_generation: bank.scope.namespace.bank_generation })) });
  closers.unshift(() => joint.close());
  const snapshot = vi.fn(async () => { throw new Error("Native dispatch must not follow a rejected Core copy"); });
  const service = createHindsightBackupService({ db: joint.fixture.db, store: joint.store,
    route: { available: () => true, snapshot, readBack: async () => null },
    custody: () => readHindsightBackupCustody({ catalog: joint.fixture.base.secrets.catalog, storeId: "isolated-capture-test" }),
    missingCredentials: () => [], logger: joint.fixture.base.logger, now: () => joint.fixture.state.now });
  closers.unshift(() => service.stop());
  const runtime = { ...joint.fixture.live,
    scheduler: { started: () => true, start: vi.fn(), stop: vi.fn(async () => undefined) },
    writeFence: { quiesce: vi.fn(async () => undefined), release: vi.fn() } };
  const backupId = randomUUID();
  const capture = (input: { route?: HindsightBackupRoute; checkpoint?: (phase: HindsightBackupPhase) => void } = {}) =>
    service.capture({ operationId: randomUUID(), backupId, route: input.route ?? "operator-artifact", runtime,
      checkpoint: input.checkpoint ?? (() => undefined) });
  return { joint, service, runtime, snapshot, backupId, capture };
}

async function expectRefusal(h: Awaited<ReturnType<typeof harness>>, outcome: Awaited<ReturnType<typeof h.capture>>, code: string) {
  expect(outcome).toEqual({ ok: false, code, mismatch: null });
  expect(h.snapshot).not.toHaveBeenCalled();
  expect(await h.joint.store.list()).toEqual([]);
  expect(h.joint.store.listStagedSync()).toEqual([]);
  expect(await h.joint.store.readStaged(h.backupId)).toBeNull();
  expect(h.runtime.writeFence.release).toHaveBeenCalledOnce();
  expect(h.runtime.scheduler.start).toHaveBeenCalledOnce();
}

describe("template-capable capture preserves the admitted configured connection", () => {
  it("uses the actual joint publication and copy path for removed overlays and complete user-owned models", async () => {
    const h = await harness();
    const status = await h.joint.prepare("removed");
    expect(status.bank?.selected?.templateRevision).toBe("none");
    expect(status.bank?.selected?.user.models[0]?.choice).toEqual({ mode: "value", value: JOINT_TEMPLATE_USER_MODEL });
    expect(await h.capture()).toEqual({ ok: true, verifiedAt: null });
    const staged = await h.joint.store.readStaged(h.backupId);
    if (!staged) throw new Error("Core capture did not stage its copied identity");
    const copied = readHindsightBackupCopy(h.joint.store.corePath(h.backupId, "staged"), staged.core, staged.request);
    expect(copied.version).toBe(2);
    if (copied.version !== 2) throw new Error("Template-capable capture downgraded");
    expect(copied.state.attestation.banks.map((bank) => ({ scope: bank.scope, receipts: bank.receiptInventory.count,
      selected: bank.selected?.templateRevision }))).toEqual([
      { scope: "character", receipts: 3, selected: "none" }, { scope: "global", receipts: 1, selected: TAKI_MANAGED_TEMPLATE_REVISION },
    ]);
    expect(staged.request.operationIds).toHaveLength(4);
    expect(h.snapshot).not.toHaveBeenCalled();
  }, 20_000);

  it("refuses a compatibility-only connection before taking any Core copy", async () => {
    const h = await harness(); await h.joint.apply(h.joint.fixture.params());
    h.joint.fixture.db.prepare("UPDATE hindsight_connection_state SET phase='compatible' WHERE singleton=1").run();
    const copy = vi.spyOn(h.joint.fixture.db, "backupTo");
    await expectRefusal(h, await h.capture(), "HINDSIGHT_BACKUP_READBACK_MISMATCH");
    expect(copy).not.toHaveBeenCalled();
  });

  it("rejects a copied connection revision changed after admission but before backupTo", async () => {
    const h = await harness(); await h.joint.apply(h.joint.fixture.params());
    const copy = h.joint.fixture.db.backupTo.bind(h.joint.fixture.db);
    vi.spyOn(h.joint.fixture.db, "backupTo").mockImplementation(async (path) => {
      h.joint.fixture.db.prepare("UPDATE hindsight_connection_state SET revision=revision+1 WHERE singleton=1").run();
      return copy(path);
    });
    await expectRefusal(h, await h.capture(), "HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN");
  });

  it.each([
    { name: "connection revision", sql: "UPDATE hindsight_connection_state SET revision=revision+1 WHERE singleton=1",
      code: "HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN" },
    { name: "configuration fingerprint", sql: "UPDATE hindsight_connection_state SET config_fingerprint=:changed WHERE singleton=1",
      values: { changed: "f".repeat(64) }, code: "HINDSIGHT_BACKUP_READBACK_MISMATCH" },
    { name: "reviewed deployment mode", sql: "UPDATE hindsight_connection_state SET reviewed_deployment_mode=NULL WHERE singleton=1",
      code: "HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN" },
    { name: "raw Bank setup", sql: "UPDATE hindsight_bank_setup SET last_verified_at='2026-10-09T00:00:00.000Z'",
      code: "HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN" },
  ])("refuses $name drift after backupTo completes", async ({ sql, values, code }) => {
    const h = await harness(); await h.joint.apply(h.joint.fixture.params());
    const copy = h.joint.fixture.db.backupTo.bind(h.joint.fixture.db);
    vi.spyOn(h.joint.fixture.db, "backupTo").mockImplementation(async (path) => {
      const pages = await copy(path);
      if (values) h.joint.fixture.db.prepare(sql).run(values); else h.joint.fixture.db.prepare(sql).run();
      return pages;
    });
    await expectRefusal(h, await h.capture(), code);
  });

  it.each([
    { phase: "capturing-native" as const, route: "native-endpoint" as const },
    { phase: "sealing" as const, route: "operator-artifact" as const },
  ])("rechecks the complete connection at $phase before dispatch or staging", async ({ phase, route }) => {
    const h = await harness(); await h.joint.apply(h.joint.fixture.params());
    const checkpoint = vi.fn((current: HindsightBackupPhase) => {
      if (current === phase) h.joint.fixture.db.prepare("UPDATE hindsight_connection_state SET revision=revision+1 WHERE singleton=1").run();
    });
    await expectRefusal(h, await h.capture({ route, checkpoint }), "HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN");
    expect(checkpoint).toHaveBeenCalledWith(phase);
  });
});
