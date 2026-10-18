import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hindsightTemplateBackupObservationValue, type HindsightTemplateBackupObservationResponse } from "@taki/shared";
import { createTemplateTransitionFixture } from "../../testing/memory-transition-template-fixtures.ts";
import { templateObservationFixture } from "../../testing/hindsight-template-observation-fixtures.ts";
import { resealTemplateAuxiliary } from "../../testing/memory-transition-template-evidence-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { readTransitionNativeEvidence } from "../../db/memory-transition-candidate-repo.ts";
import { verifyTransitionNativeEvidence } from "./transition-native-evidence.ts";
import { hindsightBackupHash } from "../hindsight-backup/hindsight-template-backup-integrity.ts";

type Fixture = Awaited<ReturnType<typeof createTemplateTransitionFixture>>;
const fixtures: Fixture[] = [];
const fixture = async (options?: Parameters<typeof createTemplateTransitionFixture>[0]) => {
  const value = await createTemplateTransitionFixture(options); fixtures.push(value); return value;
};
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const value of fixtures.splice(0)) await value.close();
  vi.useRealTimers();
});

function documents(f: Fixture) {
  return { native: f.fixture.db.prepare("SELECT * FROM memory_transition_native_evidence ORDER BY id").all(),
    candidates: f.fixture.db.prepare("SELECT * FROM memory_transition_candidates ORDER BY id").all() };
}

function driftObservation(value: HindsightTemplateBackupObservationResponse, field: string) {
  if (field === "nonce") { value.nonce = randomUUID(); return value; }
  const bank = value.proof.templates[0]!; const selected = bank.selected;
  if (selected.state !== "selected") throw new Error("drift fixture requires a selected Bank");
  if (field === "inventory") bank.receiptInventory.count++;
  if (field === "database") selected.databaseDefinitionHash = "d".repeat(64);
  if (field === "definition") selected.definitionProjectionHash = "d".repeat(64);
  if (field === "inherited") {
    selected.inheritedConfigHash = "d".repeat(64); selected.configurationObservation.inheritedConfigHash = selected.inheritedConfigHash;
  }
  if (field === "schema") { value.schema = "different_tenant"; selected.configurationObservation.schema = value.schema; }
  if (field === "context") selected.configurationObservation.contextHash = "d".repeat(64);
  selected.configurationObservation.observationHash = hindsightBackupHash("observation",
    hindsightTemplateBackupObservationValue(bank.target, selected.configurationObservation));
  return value;
}

describe("healthy template association current-target checks", () => {
  it("requests each Bank's verified receipt and terminal refresh membership without another Bank's IDs", async () => {
    const f = await fixture({ refresh: true });
    const candidate = await f.prepare();
    expect(candidate.evidenceIds).toHaveLength(2);
    const requested = f.observer.requests.map((wrapper) => wrapper.request);
    expect(requested).toHaveLength(2);
    for (const request of requested) {
      const receipts = [...f.fixture.native.receipts.values()].filter((value) => value.target.bank_id === request.nativeBankIds[0]);
      const ids = receipts.flatMap((value) => ["template-receipt:" + value.request_id,
        ...value.children.map((child) => "template-refresh-result:" + child.child_id)]).sort();
      expect(request.operationIds).toEqual(ids);
    }
    expect(requested.flatMap((request) => request.operationIds).filter((id) => id.startsWith("template-refresh-result:"))).toHaveLength(1);
  }, 30_000);

  it("freshly compares nonce, source context, complete inventory and every definition facet before reusing a candidate", async () => {
    const f = await fixture();
    await f.prepare(); const saved = documents(f);
    const faults = ["nonce", "schema", "context", "inventory", "database", "inherited", "definition"];
    for (const [index, fault] of faults.entries()) {
      f.observer.state.response = (value) => driftObservation(value, fault);
      await expect(f.prepare(), fault).rejects.toThrow();
      expect(f.observer.requests).toHaveLength(3 + index);
      expect(documents(f)).toEqual(saved);
    }
  }, 30_000);

  it("freshly compares saved W2 evidence when a later Bank interrupted preparation", async () => {
    const f = await fixture();
    f.observer.state.before = () => { if (f.observer.requests.length === 2) throw new Error("isolated observation interruption"); };
    await expect(f.prepare()).rejects.toThrow("isolated observation interruption");
    const saved = documents(f);
    expect(saved.native).toHaveLength(1); expect(saved.candidates).toEqual([]);
    f.observer.state.before = undefined;
    f.observer.contexts.set(f.observer.requests[0]!.request.nativeBankIds[0]!, "d".repeat(64));
    await expect(f.prepare()).rejects.toThrow();
    expect(f.observer.requests).toHaveLength(3);
    expect(documents(f)).toEqual(saved);
  }, 30_000);

  it("accepts fresh observations after compatible transport reconstruction and preserves every original document byte", async () => {
    const f = await fixture();
    const candidate = await f.prepare(); const saved = documents(f);
    const restarted = templateObservationFixture(f.fixture.native, f.observer.refreshResults);
    Object.assign(f.native.client, restarted.client);
    let depth = 0;
    const transaction = f.fixture.db.transaction.bind(f.fixture.db);
    vi.spyOn(f.fixture.db, "transaction").mockImplementation((action) => {
      depth++; try { return transaction(action); } finally { depth--; }
    });
    restarted.state.before = () => { expect(depth).toBe(0); };
    expect(await f.prepare()).toEqual(candidate);
    expect(restarted.requests).toHaveLength(2);
    expect(restarted.requests.every((request) => !f.observer.requests.some((previous) => previous.nonce === request.nonce))).toBe(true);
    expect(documents(f)).toEqual(saved);
    restarted.state.before = () => { throw new Error("offline historical verification must not observe Native"); };
    for (const evidenceId of candidate.evidenceIds) verifyTransitionNativeEvidence(readTransitionNativeEvidence(f.fixture.db, evidenceId));
    expect(restarted.requests).toHaveLength(2);
  }, 30_000);
});

describe("healthy W2 independently proves declared semantic refresh results", () => {
  it.each(["missing", "wrong-request", "wrong-target", "pending"])("refuses a %s W2 marker even when Native observation claims membership", async (fault) => {
    const f = await fixture({ refresh: true });
    const evidence = f.initial.find((value) => value.auxiliaryPages.some((page) => page.records.some((row) => row.table === "memory_template_refresh_results")));
    if (!evidence) throw new Error("fixture must have a terminal semantic marker");
    const records = evidence.auxiliaryPages.flatMap((page) => page.records).flatMap((row) => {
      if (row.table !== "memory_template_refresh_results") return [row];
      if (fault === "missing") return [];
      const value = JSON.parse(row.row_json);
      if (fault === "wrong-request") value.result.request_id = randomUUID();
      if (fault === "wrong-target") value.result.target.bank_id = "another-bank";
      if (fault === "pending") { value.result.state = "pending"; value.result.result_revision = null; value.result.result_payload_hash = null; }
      return [{ ...row, row_json: JSON.stringify(value) }];
    });
    Object.assign(evidence, resealTemplateAuxiliary(evidence, records));
    expect(f.observer.refreshResults.size).toBe(1);
    await expect(f.prepare()).rejects.toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    expect(f.fixture.db.prepare("SELECT * FROM memory_transition_candidates").all()).toEqual([]);
  }, 30_000);
});
