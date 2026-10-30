import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { failingGenerateModel, scriptedGenerateModel } from "../../testing/mock-language-model.ts";
import { APPLICATION_TEST_AT, applicationTestArtifact, applicationTestBody } from "../../testing/hindsight-application-fixtures.ts";
import { curatorTestFixture, curatorTestBank, curatorTestPolicy, curatorTestReport,
  curatorTestAssessDriver, curatorTestTool, curatorTestAssessment, curatorTestRemotePolicy, type CuratorTestFixture } from "./hindsight-policy-curator-fixtures.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
function fixture(input: Parameters<typeof curatorTestFixture>[0] = {}) {
  const value = curatorTestFixture(input); cleanup.push(value.close); return value;
}
function tempPath() { const root = mkdtempSync(join(tmpdir(), "taki-policy-curator-")); cleanup.push(() => rmTempDir(root)); return join(root, "state.sqlite"); }
function advance(f: CuratorTestFixture, milliseconds = 60_000) { f.clock.at = new Date(Date.parse(f.clock.at) + milliseconds).toISOString(); }
function commands(f: CuratorTestFixture) {
  return f.db.prepare("SELECT request_id,operation_id,state FROM hindsight_application_command_jobs ORDER BY request_id").all();
}
function calls(f: CuratorTestFixture, name: string) { return f.banks.flatMap((bank) => bank.server.calls).filter((value) => value.startsWith(`${name}:`)); }

describe("Hindsight policy curator through durable application state", () => {
  it("keeps neutral facts usable while proposals are saved and counts assessment only after application", async () => {
    const driver = vi.fn(async (input: Parameters<typeof curatorTestAssessDriver>[0]) => {
      const report = curatorTestReport(input);
      expect(report.policies).toHaveLength(1); expect(report.policies[0]?.text).toBe("bank-a fact memory-a");
      const result = await curatorTestAssessDriver(input);
      expect(curatorTestPolicy(f).assessment.state).toBe("due");
      expect(f.replica.search({ ...f.banks[0]!.scope, query: "fact", limit: 1 })).toHaveLength(1);
      expect(commands(f)).toHaveLength(0); expect(calls(f, "commit")).toHaveLength(0);
      expect(f.db.prepare("SELECT state FROM hindsight_policy_work WHERE work_kind='policy'").get()?.state).toBe("saved");
      return result;
    });
    const f = fixture({ driver }); const before = curatorTestPolicy(f);
    const native = f.replica.nativeHead({ ...f.banks[0]!.scope, objectKind: "memory_unit", objectId: "memory-a" })!.version;
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "ran", assessed: 1, blocks: 0, edits: 1, pending: 0,
      usage: { calls: 1, inputTokens: 11, outputTokens: 7, usageUnknown: 0 } });
    const after = curatorTestPolicy(f);
    expect(after).toMatchObject({ policy_basis: "curated", policy: { layerId: "profile", policyVersion: 2 },
      assessment: { state: "assessed", attempts: 1, prompt_version: "taki-hindsight-policy-curator/v2", target: native } });
    expect(after.assessment.prompt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(after.provenance).toEqual(before.provenance); expect(after.original_record).toEqual(before.original_record);
    expect(f.replica.record({ ...f.banks[0]!.scope, memoryId: "memory-a" })?.policy.layerId).toBe("profile");
    expect(f.replica.checkpoint("bank-a")?.checkpoint).toEqual({ native_cursor: 2, state_cursor: 1 });
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM pending_memory").get()?.n).toBe(0);
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "clean", assessed: 0, edits: 0 });
    expect(driver).toHaveBeenCalledTimes(1); expect(calls(f, "commit")).toHaveLength(1);
  });

  it("persists a real model failure and retries after the saved deadline without making native memory Pending", async () => {
    const path = tempPath(); const model = failingGenerateModel(new Error("PRIVATE_MODEL_ERROR_AND_PROMPT"));
    const f = fixture({ path, model });
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 0, edits: 0 });
    const failed = curatorTestPolicy(f);
    expect(failed).toMatchObject({ policy_basis: "neutral", policy: { layerId: "unclassified", policyVersion: 1 },
      assessment: { state: "failed", attempts: 1, last_failure_code: "model_failed", next_attempt_at: "2026-09-11T08:01:00.000Z" } });
    expect(failed.assessment.prompt_hash).toMatch(/^[a-f0-9]{64}$/); expect(model.doGenerateCalls).toHaveLength(1);
    expect(f.replica.search({ ...f.banks[0]!.scope, query: "fact", limit: 1 })).toHaveLength(1);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM pending_memory").get()?.n).toBe(0);
    expect(JSON.stringify(f.logs)).not.toContain("PRIVATE_MODEL_ERROR_AND_PROMPT");
    await f.close(); const driver = vi.fn(curatorTestAssessDriver);
    const reopened = fixture({ path, banks: f.banks, clock: f.clock, driver });
    expect(curatorTestPolicy(reopened)).toEqual(failed);
    expect(await reopened.curator.runNow("taki")).toMatchObject({ status: "clean", assessed: 0 }); expect(driver).not.toHaveBeenCalled();
    advance(reopened);
    expect(await reopened.curator.runNow("taki")).toMatchObject({ assessed: 1, edits: 1 });
    expect(curatorTestPolicy(reopened)).toMatchObject({ assessment: { state: "assessed", attempts: 2, next_attempt_at: null },
      policy: { layerId: "profile", policyVersion: 2 } }); expect(driver).toHaveBeenCalledTimes(1);
  });

  it("recovers a lost commit acknowledgement after SQLite reopen without a second model call or command", async () => {
    const path = tempPath(); const driver = vi.fn(curatorTestAssessDriver); const f = fixture({ path, driver });
    const bank = f.banks[0]!; const commit = bank.server.client.commitApplication;
    vi.spyOn(bank.server.client, "commitApplication").mockImplementationOnce(async (input) => { await commit(input); throw new Error("PRIVATE_ACK_LOST"); });
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 0, edits: 0, pending: 1 });
    expect(curatorTestPolicy(f).assessment.state).toBe("due");
    const original = commands(f); expect(original).toMatchObject([{ state: "dispatched" }]);
    const request = original[0]!.request_id; const operation = original[0]!.operation_id;
    await f.close(); advance(f);
    const reopened = fixture({ path, banks: f.banks, clock: f.clock, driver });
    expect(await reopened.curator.runNow("taki")).toMatchObject({ status: "ran", assessed: 1, edits: 1, pending: 0 });
    expect(curatorTestPolicy(reopened).assessment.state).toBe("assessed"); expect(driver).toHaveBeenCalledTimes(1);
    expect(commands(reopened)).toMatchObject([{ request_id: request, operation_id: operation, state: "completed" }]);
    expect(calls(reopened, "commit")).toEqual([`commit:${operation}`]); expect(calls(reopened, "status")).toEqual([`status:${operation}`]);
  });

  it("keeps a remote receipt pending until the matching application projection actually exists", async () => {
    const driver = vi.fn(curatorTestAssessDriver); const f = fixture({ driver }); const refresh = f.deps.refreshBank;
    f.deps.refreshBank = vi.fn(async () => undefined);
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", edits: 0, assessed: 0, pending: 1 });
    expect(commands(f)).toMatchObject([{ state: "completed" }]); expect(curatorTestPolicy(f).assessment.state).toBe("due");
    expect(f.db.prepare("SELECT state FROM hindsight_policy_work WHERE work_kind='policy'").get()?.state).toBe("saved");
    f.deps.refreshBank = refresh; advance(f);
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "ran", assessed: 1, edits: 1, pending: 0 });
    expect(driver).toHaveBeenCalledTimes(1); expect(calls(f, "commit")).toHaveLength(1);
  });

  it("filters hidden, invalidated, expired and mood-gated candidates before the report limit and actual model input", async () => {
    const bank = curatorTestBank({ bankId: "character-taki", characterId: "taki", memories: [
      { id: "a-hidden", text: "HIDDEN_PRIVATE_CONTENT", policy: { visibility: "hidden" } },
      { id: "b-invalid", text: "INVALIDATED_PRIVATE_CONTENT", invalidated: true },
      { id: "c-expired", text: "EXPIRED_PRIVATE_CONTENT", policy: { retention: { kind: "expiring", expiresAt: "2026-09-10T08:00:00.000Z" } } },
      { id: "d-mood", text: "MOOD_PRIVATE_CONTENT", policy: { layerId: "intentions", visibility: "mood-gated", disclosure: "specific mood trigger" } },
      { id: "z-visible", text: "VISIBLE_CURATOR_INPUT" },
    ] });
    const model = scriptedGenerateModel([{ kind: "tool", toolCallId: "finish", toolName: "policy_review_finish", input: {} }]);
    const f = fixture({ banks: [bank], model }); f.config.memory.reportClassCap = 1;
    await f.curator.runNow("taki");
    expect(model.doGenerateCalls).toHaveLength(1);
    const submitted = JSON.stringify(model.doGenerateCalls);
    expect(submitted).toContain("VISIBLE_CURATOR_INPUT");
    for (const marker of ["HIDDEN_PRIVATE_CONTENT", "INVALIDATED_PRIVATE_CONTENT", "EXPIRED_PRIVATE_CONTENT", "MOOD_PRIVATE_CONTENT"]) expect(submitted).not.toContain(marker);
    const work = f.db.prepare("SELECT work_kind,target_bytes FROM hindsight_policy_work").all();
    expect(work.filter((row) => row.work_kind === "policy")).toHaveLength(1);
    expect(curatorTestPolicy(f, bank, "a-hidden").assessment.state).toBe("due");
    expect(curatorTestPolicy(f, bank, "d-mood").assessment.state).toBe("due");
  });

  it("retains applied proposal counts but reports a failed pass when the model fails after saving them", async () => {
    const f = fixture({ driver: async (input) => {
      await curatorTestAssessDriver(input); throw new Error("PRIVATE_AFTER_PROPOSAL_FAILURE");
    } });
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 1, edits: 1, usage: { usageUnknown: 1 } });
    expect(curatorTestPolicy(f).assessment.state).toBe("assessed"); expect(calls(f, "commit")).toHaveLength(1);
    expect(JSON.stringify(f.logs)).not.toContain("PRIVATE_AFTER_PROPOSAL_FAILURE");
  });

  it("refuses the user card and restores a background Block through its preserved artifact identity and exact revision", async () => {
    const bank = curatorTestBank(); const key = { artifact_kind: "block" as const, artifact_id: "preserved-model-identity" };
    bank.artifacts.push(applicationTestArtifact({ scope: bank.scope, key, binding: { kind: "core_block" },
      body: applicationTestBody("application-block.v1", { block_id: "user-model", scope: bank.bankScope, content: "Previous supported pattern",
        block_revision: 7, updated_at: APPLICATION_TEST_AT, writer: "background", block_contract_version: 1 }, bank.scope) }));
    const driver = vi.fn(async (input: Parameters<typeof curatorTestAssessDriver>[0]) => {
      expect(Object.keys(input.tools).sort()).toEqual(["block_read", "block_update", "memory_policy_assess", "policy_review_finish"]);
      const cardResult = await curatorTestTool(input, "block_read", { id: "user-card" });
      expect(cardResult).toMatchObject({ ok: true, readOnly: true,
        value: { content: "The user prefers tea", writer: "user" } });
      const modelView = await input.tools.block_read!.toModelOutput!({ toolCallId: "read-card", input: { id: "user-card" }, output: cardResult });
      expect(modelView).toMatchObject({ type: "text" }); expect(JSON.stringify(modelView)).toContain("hindsight-policy-block");
      expect(JSON.stringify(modelView)).toContain("<untrusted-observation");
      expect(await curatorTestTool(input, "block_update", { id: "user-card", content: "Forged card" }))
        .toMatchObject({ ok: false, code: "MEMORY_CAPABILITY_UNSUPPORTED" });
      expect(await curatorTestTool(input, "block_update", { id: "user-model", content: "Previous supported pattern\nNew supported pattern" }))
        .toMatchObject({ ok: true, status: "proposal_saved" });
      expect(f.blocks.read("user-model", bank.bankScope)?.revision).toBe(7);
      return curatorTestAssessDriver(input);
    });
    const f = fixture({ banks: [bank], driver });
    const card = f.blocks.replace({ blockId: "user-card", scope: bank.bankScope, content: "The user prefers tea", actor: "user", now: APPLICATION_TEST_AT });
    const result = await f.curator.runNow("taki");
    expect(result).toMatchObject({ status: "ran", assessed: 1, blocks: 1, edits: 2 });
    expect(f.blocks.read("user-card", bank.bankScope)).toEqual(card);
    expect(f.blocks.read("user-model", bank.bankScope)).toMatchObject({ content: "Previous supported pattern\nNew supported pattern", revision: 8, updatedAt: APPLICATION_TEST_AT });
    const artifact = f.replica.latestArtifact({ ...bank.scope, key })!;
    expect(artifact).toMatchObject({ key, revision: 2, binding: { kind: "core_block" } });
    expect(f.replica.body({ ...bank.scope, bodyId: artifact.body_ref.body_id })?.content).toMatchObject({
      body_schema: "application-block.v1", value: { block_revision: 8, writer: "background", scope: bank.bankScope } });
    expect(f.replica.blockArtifacts(bank.scope)).toHaveLength(1); expect(calls(f, "commit")).toHaveLength(2);
  });

  it("serializes simultaneous Global and Character reviews through one Utility Slot without cross-scope model input", async () => {
    const banks = [curatorTestBank({ memories: [{ id: "global", text: "GLOBAL_POLICY_CONTENT" }] }),
      curatorTestBank({ bankId: "bank-taki", characterId: "taki", memories: [{ id: "taki", text: "TAKI_PRIVATE_CONTENT" }] }),
      curatorTestBank({ bankId: "bank-sayo", characterId: "sayo", memories: [{ id: "sayo", text: "SAYO_PRIVATE_CONTENT" }] })];
    let active = 0; let peak = 0; const seen: string[] = []; const ids = new Map<string, string>();
    const driver = vi.fn(async (input: Parameters<typeof curatorTestAssessDriver>[0]) => {
      active++; peak = Math.max(peak, active); const report = curatorTestReport(input); seen.push(report.bank.id);
      ids.set(report.bank.id, report.policies[0]!.workId);
      if (report.bank.id !== "bank-taki") expect(input.prompt).not.toContain("TAKI_PRIVATE_CONTENT");
      if (report.bank.id !== "bank-sayo") expect(input.prompt).not.toContain("SAYO_PRIVATE_CONTENT");
      if (report.bank.scope.kind === "character" && ids.has("bank-a")) {
        expect(await curatorTestTool(input, "memory_policy_assess", curatorTestAssessment(report.policies[0]!.policy, ids.get("bank-a")!, true)))
          .toMatchObject({ ok: false, code: "MEMORY_CAPABILITY_UNSUPPORTED" });
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      try { return await curatorTestAssessDriver(input); } finally { active--; }
    });
    const f = fixture({ banks, driver }); const outcomes = await Promise.all([f.curator.runNow("taki"), f.curator.runNow("sayo")]);
    expect(peak).toBe(1); expect(seen.sort()).toEqual(["bank-a", "bank-sayo", "bank-taki"]);
    expect(outcomes.reduce((total, result) => total + result.assessed, 0)).toBe(3);
    for (const bank of banks) {
      const memoryId = bank.native.find((entry) => entry.head.object_kind === "memory_unit")!.head.object_id;
      expect(curatorTestPolicy(f, bank, memoryId)).toMatchObject({ policy: { bankId: bank.scope.bankId,
        layerId: bank.bankScope.kind === "global" ? "profile" : "episodes" }, assessment: { state: "assessed" } });
    }
  });

  it.each([false, true])("preserves an existing pin=%s without letting automatic assessment create or increase it", async (pinned) => {
    const bank = curatorTestBank({ memories: [{ id: "memory-a", ...(pinned ? { policy: {
      layerId: "profile", importance: 9, visibility: "pinned" as const } } : {}) }] });
    const f = fixture({ banks: [bank], driver: async (input) => {
      const row = curatorTestReport(input).policies[0]!;
      const candidate = curatorTestAssessment(row.policy, row.workId);
      expect(await curatorTestTool(input, "memory_policy_assess", { ...candidate, importance: pinned ? 10 : 9, visibility: "pinned" }))
        .toMatchObject({ ok: false, code: "MEMORY_INVALID_REQUEST" });
      expect(await curatorTestTool(input, "memory_policy_assess", { ...candidate, disclosure: "<turn-context>private recalled input</turn-context>" }))
        .toMatchObject({ ok: false, code: "MEMORY_INVALID_REQUEST" });
      expect(await curatorTestTool(input, "memory_policy_assess", { ...candidate,
        importance: pinned ? 9 : 5, visibility: pinned ? "pinned" : "retrieved" })).toMatchObject({ ok: true });
      await curatorTestTool(input, "policy_review_finish"); input.onStepEnd();
      return { steps: 1, usage: { inputTokens: 10, outputTokens: 4 } };
    } });
    expect(await f.curator.runNow("taki")).toMatchObject({ assessed: 1, edits: 1 });
    expect(curatorTestPolicy(f).policy).toMatchObject({ layerId: "profile", importance: pinned ? 9 : 5, visibility: pinned ? "pinned" : "retrieved" });
  });

  it("shares the configured model-step ceiling across Bank reviews and leaves the remaining Bank retryable", async () => {
    const banks = [curatorTestBank(), curatorTestBank({ bankId: "bank-taki", characterId: "taki" })];
    const driver = vi.fn(curatorTestAssessDriver); const f = fixture({ banks, driver }); f.config.memory.tidyMaxSteps = 1;
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 1, edits: 1, steps: 1 });
    expect(driver).toHaveBeenCalledTimes(1); expect(curatorTestPolicy(f, banks[0]!).assessment.state).toBe("assessed");
    expect(curatorTestPolicy(f, banks[1]!).assessment.state).toBe("due");
    expect(f.db.prepare("SELECT state,next_attempt_at FROM hindsight_policy_work WHERE bank_id='bank-taki'").all())
      .toMatchObject([{ state: "ready", next_attempt_at: "2026-09-11T08:01:00.000Z" }, { state: "ready", next_attempt_at: "2026-09-11T08:01:00.000Z" }]);
  });

  it.each(["policy", "block"] as const)("supersedes an undispatched %s proposal after an upload ACK loss and restrictive input change", async (kind) => {
    const driver = vi.fn(async (input: Parameters<typeof curatorTestAssessDriver>[0]) => {
      if (kind === "block") expect(await curatorTestTool(input, "block_update", { id: "user-model", content: "Supported before restriction" })).toMatchObject({ ok: true });
      return curatorTestAssessDriver(input);
    });
    const f = fixture({ driver }); const bank = f.banks[0]!; const part = bank.server.client.putApplicationBodyPart; let failed = false;
    vi.spyOn(bank.server.client, "putApplicationBodyPart").mockImplementation(async (input) => {
      const result = await part(input); const schema = bank.server.uploads.get(input.bodyId)?.ref.body_schema;
      if (!failed && schema === (kind === "policy" ? "application-memory.v1" : "application-block.v1")) {
        failed = true; throw new Error("PRIVATE_PART_ACK_LOST");
      }
      return result;
    });
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", pending: 1, assessed: kind === "policy" ? 0 : 1 });
    const original = commands(f); expect(original.filter((job) => job.state === "prepared")).toHaveLength(1);
    curatorTestRemotePolicy(bank, "memory-a", (body) => ({ ...body, policy: { ...body.policy,
      visibility: "hidden", policyVersion: body.policy.policyVersion + 1 } }));
    await f.deps.refreshBank(bank.scope.bankId, { timeoutMs: 10_000 }); advance(f);
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 0, edits: 0 });
    expect(f.db.prepare("SELECT state FROM hindsight_policy_work WHERE work_kind=:kind").get({ kind })?.state).toBe("superseded");
    expect(commands(f)).toEqual(original); expect(f.blocks.read("user-model", bank.bankScope)).toBeUndefined();
    expect(await f.curator.runNow("taki")).toMatchObject({ status: "clean", assessed: 0, edits: 0 });
    expect(driver).toHaveBeenCalledTimes(1); expect(calls(f, "commit")).toHaveLength(kind === "policy" ? 0 : 1);
  });
});
