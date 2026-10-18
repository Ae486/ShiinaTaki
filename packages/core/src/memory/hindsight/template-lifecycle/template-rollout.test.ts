import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createConfigRepo } from "../../../db/config-repo.ts";
import { createHindsightConnectionRepo } from "../../../db/hindsight-connection-repo.ts";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { applicationCheckpointHash, readApplicationCheckpoint } from "../../../db/hindsight-application-replica-checkpoint.ts";
import { readMemoryAuthoritySelection } from "../../legacy-migration/legacy-activation-repo.ts";
import { readTemplateDefaults } from "./template-default-store.ts";
import { readTemplateHold, readTemplatePublication } from "./template-execution-reads.ts";
import { TEMPLATE_EXECUTOR_LEASE_MS } from "./template-executor-store.ts";
import { templateLifecycleFixture, type TemplateLifecycleFixture } from "./template-lifecycle-fixtures.ts";

const fixtures: TemplateLifecycleFixture[] = [];
const fixture = () => { const f = templateLifecycleFixture(); fixtures.push(f); return f; };
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

describe("original-plan template rollout and publication", () => {
  it("recovers a partial two-Bank rollout after physical SQLite reopen using the original requests", async () => {
    const f = fixture();
    let dispatched = 0;
    f.native.hooks.before = (call) => { if (call.method === "apply" && ++dispatched === 2) throw new Error("HINDSIGHT_TIMEOUT"); };
    const original = f.owner.submit(await f.request()); await f.owner.stop();
    const plan = f.plan(original);
    const first = plan.banks[0]!.identity.target.bank_id;
    const second = plan.banks[1]!.identity.target.bank_id;
    const oldResult = f.owner.status(original.operationId);
    expect(oldResult).toMatchObject({ state: "outcome_unknown", result: { outcome: "partial", appliedBanks: 1, totalBanks: 2 } });
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
    expect(f.service.status().previewAvailable).toBe(false);
    expect(() => f.owner.submit({ kind: "bank.provision", characterId: "other" })).toThrow("MEMORY_TEMPLATE_HOLD");
    await f.reopen();
    expect(f.plan(original)).toEqual(plan);
    expect(f.owner.status(original.operationId)).toEqual(oldResult);
    expect(f.service.status().recoverPlanId).toBe(plan.planId);
    f.native.hooks.before = undefined;
    const recovery = f.owner.submit({ kind: "template.recover", requestId: randomUUID(), planId: plan.planId }); await f.owner.stop();
    expect(f.owner.status(recovery.operationId)).toMatchObject({ state: "completed", result: { outcome: "bound", originalOperationId: original.operationId } });
    expect(f.owner.status(original.operationId)).toEqual(oldResult);
    const applied = f.native.calls.filter((call) => call.method === "apply");
    expect(applied.filter((call) => call.bankId === first)).toHaveLength(1);
    expect(applied.filter((call) => call.bankId === second)).toHaveLength(2);
    expect(new Set(applied.map((call) => call.request?.request_id))).toEqual(new Set(plan.banks.map((bank) => bank.preview.request.request_id)));
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("published");
  });

  it("recovers a committed Apply whose reply was lost without repeating either Native mutation", async () => {
    const f = fixture();
    let committed = 0;
    f.native.hooks.afterCommit = () => {
      if (++committed === 2) throw new Error("HINDSIGHT_TIMEOUT");
    };
    const original = f.owner.submit(await f.request()); await f.owner.stop();
    const plan = f.plan(original);
    expect(f.native.receipts.size).toBe(2);
    expect(f.db.prepare("SELECT * FROM hindsight_template_bank_receipts").all()).toHaveLength(1);
    const originalRequests = plan.banks.map((bank) => bank.preview.request);
    await f.reopen(); f.native.hooks.afterCommit = undefined;
    const recovery = f.owner.submit({ kind: "template.recover", requestId: randomUUID(), planId: plan.planId }); await f.owner.stop();
    expect(f.owner.status(recovery.operationId).state).toBe("completed");
    expect(f.native.calls.filter((call) => call.method === "apply").map((call) => call.request)).toEqual(originalRequests);
    expect(f.db.prepare("SELECT * FROM hindsight_template_bank_receipts").all()).toHaveLength(2);
    expect(f.plan(original)).toEqual(plan);
  });

  it("uses binding-only recovery after selection COMMIT and keeps the original failed operation unchanged", async () => {
    const f = fixture(); f.state.failBinding = true;
    const original = f.owner.submit(await f.request()); await f.owner.stop();
    const plan = f.plan(original); const failed = f.owner.status(original.operationId);
    expect(failed).toMatchObject({ state: "failed", errorCode: "MEMORY_TEMPLATE_BINDING_UNAVAILABLE", result: { outcome: "binding_unavailable" } });
    const publication = readTemplatePublication(f.db, plan.planId);
    expect(publication).not.toBeNull();
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("published");
    const nativeCalls = structuredClone(f.native.calls);
    await f.reopen(); f.state.failBinding = false; f.state.runtimeCalls.length = 0;
    const recovery = f.owner.submit({ kind: "template.recover", requestId: randomUUID(), planId: plan.planId }); await f.owner.stop();
    expect(f.owner.status(recovery.operationId).state).toBe("completed");
    expect(f.owner.status(original.operationId)).toEqual(failed);
    expect(readTemplatePublication(f.db, plan.planId)).toEqual(publication);
    expect(f.native.calls).toEqual(nativeCalls);
    expect(f.state.runtimeCalls).toEqual(["bind"]);
  });

  it("rolls back every Core publication row on deferred COMMIT failure then recovers from original Native receipts", async () => {
    const f = fixture();
    const setup = createHindsightBankSetupRepo(f.db).list();
    const connection = createHindsightConnectionRepo(f.db).read(setup);
    f.db.exec(`CREATE TABLE fixture_parent(id TEXT PRIMARY KEY);
      CREATE TABLE fixture_child(id TEXT REFERENCES fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER fixture_fail_publication AFTER INSERT ON hindsight_template_publications
        BEGIN INSERT INTO fixture_child VALUES('missing'); END`);
    const original = f.owner.submit(await f.request()); await f.owner.stop();
    const plan = f.plan(original);
    expect(f.owner.status(original.operationId).state).toBe("outcome_unknown");
    expect(readTemplatePublication(f.db, plan.planId)).toBeNull();
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
    expect(readTemplateDefaults(f.db, plan.guard.providerLineage)).toBeNull();
    expect(f.db.prepare("SELECT * FROM hindsight_template_applied").all()).toEqual([]);
    expect(f.db.prepare("SELECT * FROM hindsight_template_selections").all()).toEqual([]);
    expect(f.db.prepare("SELECT * FROM hindsight_application_runtime_admission").all()).toEqual([]);
    expect(createHindsightBankSetupRepo(f.db).list()).toEqual(setup);
    expect(createHindsightConnectionRepo(f.db).read(setup)).toEqual(connection);
    expect(f.native.receipts.size).toBe(2);
    f.db.exec("DROP TRIGGER fixture_fail_publication");
    const recovery = f.owner.submit({ kind: "template.recover", requestId: randomUUID(), planId: plan.planId }); await f.owner.stop();
    expect(f.owner.status(recovery.operationId).state).toBe("completed");
    expect(f.native.calls.filter((call) => call.method === "apply")).toHaveLength(2);
    expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("checks the live deadline after final publication readback and rolls back a now-expired executor", async () => {
    const f = fixture(); let expired = false;
    const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (!sql.startsWith("SELECT * FROM hindsight_template_publications")) return statement;
      return { ...statement, get: (params) => {
        const row = statement.get(params);
        if (row && !expired) { expired = true; f.state.now = new Date(Date.parse(f.state.now) + TEMPLATE_EXECUTOR_LEASE_MS + 1).toISOString(); }
        return row;
      } };
    };
    const original = f.owner.submit(await f.request()); await f.owner.stop();
    const plan = f.plan(original);
    expect(expired).toBe(true);
    expect(f.owner.status(original.operationId).state).toBe("outcome_unknown");
    expect(readTemplatePublication(f.db, plan.planId)).toBeNull();
    expect(f.db.prepare("SELECT * FROM hindsight_template_applied").all()).toEqual([]);
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
    expect(f.state.runtimeCalls).not.toContain("bind");
  });

  it.each(["configuration", "secret"])("retains the hold when %s changes after readback but before publication", async (drift) => {
    const f = fixture(); let manifests = 0;
    f.native.hooks.before = (call) => {
      if (call.method !== "compatibility" || ++manifests !== 3) return;
      if (drift === "configuration") {
        createConfigRepo(f.db).upsert("TAKI_HINDSIGHT_ENABLED", false);
        createConfigRepo(f.db).upsert("TAKI_HINDSIGHT_ENABLED", true);
      } else f.base.secrets.state.version++;
    };
    const original = f.owner.submit(await f.request()); await f.owner.stop();
    const plan = f.plan(original);
    expect(f.native.receipts.size).toBe(2);
    expect(readTemplatePublication(f.db, plan.planId)).toBeNull();
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
    expect(f.db.prepare("SELECT * FROM hindsight_template_applied").all()).toEqual([]);
    expect(f.service.status().recoverUnavailableReason).toBe("stale");
  });

  it.each(["configuration", "secret", "epoch", "bank_generation", "bank_scope", "bank_identity"] as const)(
    "rolls back the entire publication when %s changes inside final readback", async (drift) => {
      const f = fixture(); const setups = createHindsightBankSetupRepo(f.db).list();
      const connection = createHindsightConnectionRepo(f.db).read(setups);
      const authority = readMemoryAuthoritySelection(f.db);
      const prepare = f.db.prepare.bind(f.db); let injected = false;
      f.db.prepare = (sql) => {
        const statement = prepare(sql);
        if (!sql.startsWith("SELECT * FROM hindsight_template_publications")) return statement;
        return { ...statement, get: (params) => {
          const row = statement.get(params);
          if (row && !injected) { changeFinalIdentity(f, drift); injected = true; }
          return row;
        } };
      };
      const original = f.owner.submit(await f.request()); await f.owner.stop();
      const plan = f.plan(original);
      expect(injected).toBe(true); expect(f.native.receipts.size).toBe(2);
      expect(f.owner.status(original.operationId).state).toBe("outcome_unknown");
      for (const table of ["hindsight_template_selections", "hindsight_template_applied", "hindsight_template_default_history",
        "hindsight_template_defaults", "hindsight_application_runtime_admission", "hindsight_template_publications"]) {
        expect(f.db.prepare(`SELECT * FROM ${table}`).all(), table).toEqual([]);
      }
      expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
      expect(createHindsightBankSetupRepo(f.db).list()).toEqual(setups);
      expect(createHindsightConnectionRepo(f.db).read(setups)).toEqual(connection);
      expect(readMemoryAuthoritySelection(f.db)).toEqual(authority);
      for (const bank of plan.banks) expect(readApplicationCheckpoint(f.db, bank.identity.target.bank_id)?.namespace).toEqual(bank.namespace);
      expect(f.db.prepare("SELECT * FROM hindsight_template_users").all()).toHaveLength(2);
      expect(f.state.runtimeCalls).not.toContain("bind");
    });
});

function changeFinalIdentity(f: TemplateLifecycleFixture, drift: string): void {
  if (drift === "configuration") {
    const config = createConfigRepo(f.db); config.upsert("TAKI_HINDSIGHT_ENABLED", false); config.upsert("TAKI_HINDSIGHT_ENABLED", true);
  } else if (drift === "secret") f.base.secrets.state.version++;
  else if (drift === "epoch") {
    expect(f.db.prepare("UPDATE memory_authority_selection SET active_epoch_id='fixture-other-epoch' WHERE singleton=1").run().changes).toBe(1);
    expect(f.db.prepare("SELECT active_epoch_id FROM memory_authority_selection WHERE singleton=1").get()?.active_epoch_id).toBe("fixture-other-epoch");
  } else if (drift === "bank_generation") {
    const checkpoint = readApplicationCheckpoint(f.db, f.bindings[0].externalBankId)!;
    const generation = randomUUID();
    // Keep the embedded Native/application checkpoint and its hash valid: the final
    // identity guard must reject a changed incarnation, not a malformed fixture.
    const changed = { ...checkpoint, namespace: { ...checkpoint.namespace, bank_generation: generation },
      native: { ...checkpoint.native, bankGeneration: generation } };
    expect(f.db.prepare("UPDATE hindsight_application_replica_checkpoints SET bank_generation=:generation,checkpoint_json=:json,checkpoint_hash=:hash WHERE bank_id=:bank")
      .run({ bank: changed.bankId, generation, json: JSON.stringify(changed), hash: applicationCheckpointHash(changed) }).changes).toBe(1);
    expect(readApplicationCheckpoint(f.db, changed.bankId)).toEqual(changed);
  } else {
    const column = drift === "bank_scope" ? "scope_kind" : "canonical_identity";
    expect(f.db.prepare(`UPDATE hindsight_bank_setup SET ${column}=:value WHERE external_bank_id=:bank`)
      .run({ bank: f.bindings[1].externalBankId, value: drift === "bank_scope" ? "global" : "character:changed" }).changes).toBe(1);
  }
}
