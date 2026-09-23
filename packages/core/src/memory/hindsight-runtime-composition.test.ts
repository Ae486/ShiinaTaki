import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryEffectMetadata } from "./canonical-tools/memory-effect-tool.ts";
import { HindsightMemoryRecallEnvelopeV1Schema } from "@taki/shared";
import { failingGenerateModel, scriptedGenerateModel } from "../testing/mock-language-model.ts";
import { APPLICATION_TEST_AT, applicationTestNative, applicationTestMemoryPayload, applicationTestEvent,
  applicationTestArtifact, applicationTestBody } from "../testing/hindsight-application-fixtures.ts";
import { applicationTestBind } from "../testing/hindsight-application-runtime-fixtures.ts";
import { curatorTestBank, curatorTestRemotePolicy } from "./hindsight/hindsight-policy-curator-fixtures.ts";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../testing/hindsight-runtime-composition-fixtures.ts";
import type { CapturedMemoryRun } from "./canonical-memory-run.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.useRealTimers(); vi.restoreAllMocks(); });
function fixture(input: Parameters<typeof hindsightRuntimeFixture>[0] = {}) { const f = hindsightRuntimeFixture(input); cleanup.push(f.close); return f; }
function files(f: HindsightRuntimeFixture) { return readdirSync(f.dataDir, { recursive: true }).map(String).filter((name) => !name.startsWith("memory.sqlite")).sort(); }
async function recall(run: CapturedMemoryRun) {
  return HindsightMemoryRecallEnvelopeV1Schema.parse(await run.tools.recall!.execute!({ query: "fact", scope: "both", limit: 8, maxTokens: 1024 },
    { toolCallId: "runtime-recall", messages: [], context: {} }));
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function tick() { return new Promise<void>((resolve) => setImmediate(resolve)); }
function knownPinBank(text: string, expiresAt?: string) {
  const bank = curatorTestBank({ memories: [{ id: "pin", text, policy: { layerId: "profile", importance: 9,
    retention: expiresAt ? { kind: "expiring", expiresAt } : { kind: "permanent" } } }] });
  const old = bank.artifacts.find((entry) => entry.artifact.key.artifact_id === "pin")!;
  if (old.body.content.body_schema !== "application-memory.v1") throw new Error("fixture policy body missing");
  const body = old.body.content.value;
  const current = applicationTestArtifact({ scope: bank.scope, key: old.artifact.key, binding: old.artifact.binding,
    body: applicationTestBody("application-memory.v1", { ...body, policy_basis: "curated",
      assessment: { ...body.assessment, state: "not_required" } }, bank.scope) });
  bank.artifacts = bank.artifacts.map((entry) => entry === old ? current : entry);
  applicationTestBind(bank.native.find((entry) => entry.head.object_id === "pin")!, current.artifact);
  return bank;
}

describe("production Hindsight runtime composition", () => {
  it("exposes the operations() live accessor only for the selected Hindsight subsystem", async () => {
    expect(fixture({ mode: "local" }).compose().operations()).toBeNull();
    const f = fixture(); const runtime = f.compose();
    const operations = runtime.operations();
    expect(operations).not.toBeNull();
    expect(operations!.epochId).toBe("epoch");
    expect(operations!.scheduler.started()).toBe(false);
    expect(operations!.banks().map((bank) => bank.bankId).sort()).toEqual(["bank-a", "bank-taki"]);
    expect(() => operations!.assertConnection()).not.toThrow();
    expect(operations!.pendingSummary("bank-a")).toMatchObject({ pendingCount: 0, failedCount: 0, unknownCount: 0 });
    runtime.start(); expect(runtime.operations()!.scheduler.started()).toBe(true);
    expect(f.remote.calls).toEqual([]);
  });

  it.each(["local", "legacy"] as const)("keeps %s independent of configured Hindsight and preserves its directory layout", async (mode) => {
    const withHindsight = fixture({ mode }); const withoutHindsight = fixture({ mode });
    const first = withHindsight.compose(); const baseline = withoutHindsight.compose(false);
    expect((await first.captureRun("taki")).snapshot.providerId).toBe(mode === "local" ? "local" : "legacy-markdown");
    await baseline.captureRun("taki"); expect(withHindsight.remote.calls).toEqual([]); expect(withoutHindsight.remote.calls).toEqual([]);
    expect(files(withHindsight)).toEqual(files(withoutHindsight));
  });

  it.each([false, true])("constructs selected Hindsight with seeded=%s, then hydrates real policy without a Utility model or Legacy fallback", async (seed) => {
    const model = failingGenerateModel(new Error("unexpected policy model")); const f = fixture({ seed, model }); const runtime = f.compose();
    expect(runtime.selected.legacy).toBeNull(); expect(runtime.selected.canonical).toBe(true); expect(f.remote.calls).toEqual([]);
    expect(existsSync(join(f.dataDir, "workspace", "memory"))).toBe(false);
    const run = await runtime.captureRun("taki"); expect(run.snapshot.providerId).toBe("hindsight");
    expect(run.snapshot.authorityEpochId).toBe("epoch"); expect(Object.keys(run.tools).sort())
      .toEqual(["invalidate_memory", "recall", "reflect", "restore_memory", "retain", "update_memory"]);
    const result = await recall(run); expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.returned).toBe(2); expect(result.data.hits.every((hit) => hit.record.policy.layerId === "unclassified")).toBe(true);
      expect(new Set(result.data.hits.map((hit) => hit.record.unit.bankId))).toEqual(new Set(["bank-a", "bank-taki"]));
    }
    expect(await run.automaticRecall!({ query: "fact", visibleContext: "", now: Date.now() })).toContain("bank-taki fact memory-a");
    for (const bank of f.banks) expect(f.replica.checkpoint(bank.scope.bankId)?.checkpoint).toEqual({ native_cursor: 2, state_cursor: 0 });
    expect(f.remote.calls.filter((call) => call.operation === "native-baseline")).toHaveLength(seed ? 0 : 4);
    expect(model.doGenerateCalls).toHaveLength(0); expect(existsSync(join(f.dataDir, "workspace", "memory"))).toBe(false);
  });

  it("admits known pins and neutral facts while excluding hidden and other-Character data before consumer delivery", async () => {
    const model = failingGenerateModel(new Error("unexpected policy model"));
    const banks = [knownPinBank("GLOBAL_PIN_FACT"),
      curatorTestBank({ bankId: "bank-taki", characterId: "taki", memories: [{ id: "neutral", text: "TAKI_NEUTRAL_FACT" },
        { id: "hidden", text: "TAKI_HIDDEN_FACT", policy: { visibility: "hidden" } }] }),
      curatorTestBank({ bankId: "bank-sayo", characterId: "sayo", memories: [{ id: "other", text: "SAYO_PRIVATE_FACT" }] })];
    const f = fixture({ model, banks }); const run = await f.compose().captureRun("taki");
    expect(run.assemble!("")).toContain("GLOBAL_PIN_FACT");
    const result = await recall(run); expect(result.ok && result.data.returned).toBe(2);
    const text = await run.automaticRecall!({ query: "fact", visibleContext: "", now: Date.now() });
    expect(text).toContain("TAKI_NEUTRAL_FACT"); expect(text).toContain("GLOBAL_PIN_FACT");
    expect(text).not.toContain("HIDDEN"); expect(text).not.toContain("SAYO");
    expect(f.remote.calls.some((call) => call.bankId === "bank-sayo")).toBe(false); expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("keeps a captured prompt immutable while a later Run sees the new application policy", async () => {
    const banks = [knownPinBank("CAPTURED_PIN_FACT"),
      curatorTestBank({ bankId: "bank-taki", characterId: "taki" })];
    const f = fixture({ banks }); const runtime = f.compose(); const first = await runtime.captureRun("taki");
    const original = first.assemble!(""); expect(original).toContain("CAPTURED_PIN_FACT"); expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.tools)).toBe(true); expect(Object.isFrozen(first.snapshot)).toBe(true);
    curatorTestRemotePolicy(banks[0]!, "pin", (body) => ({ ...body, policy: { ...body.policy, visibility: "hidden", policyVersion: 2 } }));
    const second = await runtime.captureRun("taki"); expect(first.assemble!("")).toBe(original); expect(second.assemble!("")).not.toContain("CAPTURED_PIN_FACT");
    expect(JSON.stringify(await recall(first))).not.toContain("CAPTURED_PIN_FACT");
  });

  it.each(["endpoint", "secret", "epoch"] as const)("refuses captured execution after %s drift without changing provider or consulting Legacy", async (change) => {
    const f = fixture(); const runtime = f.compose(); const run = await runtime.captureRun("taki"); const before = f.remote.calls.length;
    if (change === "endpoint") f.config.upsert("TAKI_HINDSIGHT_ENDPOINT", "http://127.0.0.1:18482");
    if (change === "secret") f.secrets.catalog.set("memory.hindsight.connection.api-key", "rotated-fixture-key");
    if (change === "epoch") f.db.exec("UPDATE canonical_memory_authority_epochs SET provider_lineage_id='33333333-3333-4333-8333-333333333333' WHERE epoch_id='epoch'");
    await expect(runtime.captureRun("taki")).rejects.toThrow("MEMORY_AUTHORITY_MISMATCH");
    const result = await recall(run); expect(result).toMatchObject({ ok: false, providerId: "hindsight", error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
    expect(await run.automaticRecall!({ query: "fact", visibleContext: "", now: Date.now() })).toBe("");
    expect(f.remote.calls).toHaveLength(before); expect(runtime.selected.legacy).toBeNull();
  });

  it("does not retarget an already captured Character route after B3 Bank mapping changes", async () => {
    const f = fixture(); const runtime = f.compose(); const run = await runtime.captureRun("taki");
    const original = f.setup.get("character:taki")!; f.setup.upsert({ ...original, externalBankId: "replacement-character-bank" });
    const result = await recall(run); expect(JSON.stringify(result)).toContain("MEMORY_AUTHORITY_MISMATCH");
    if (result.ok) expect(result.data.hits.every((hit) => hit.record.unit.bankId === "bank-a")).toBe(true);
    expect(f.remote.calls.some((call) => call.bankId === "replacement-character-bank")).toBe(false);
    expect(runtime.selected.legacy).toBeNull();
  });

  it("keeps Core serving with an observable unavailable Hindsight runtime when B3 configuration is disabled at boot", async () => {
    const f = fixture(); f.config.upsert("TAKI_HINDSIGHT_ENABLED", false);
    const runtime = f.compose();
    expect(runtime.operations()).toBeNull(); expect(runtime.selected.legacy).toBeNull(); expect(runtime.selected.canonical).toBe(true);
    expect(runtime.hindsightBindingSnapshot()).toMatchObject({ selection: "hindsight", selectedEpochId: "epoch",
      binding: { kind: "unavailable", epochId: "epoch", code: "HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE" } });
    await expect(runtime.captureRun("taki")).rejects.toThrow("MEMORY_RUNTIME_UNAVAILABLE");
    expect(() => runtime.memory.createTools("taki")).toThrow("MEMORY_INTEGRITY_ERROR");
    expect(f.remote.calls).toEqual([]); expect(existsSync(join(f.dataDir, "workspace", "memory"))).toBe(false);
    // Repair once the configuration is back: same epoch, never a second promotion.
    f.config.upsert("TAKI_HINDSIGHT_ENABLED", true);
    expect(runtime.recoverHindsightBinding("epoch")).toEqual({ binding: "published", reconciledGroups: 0 });
    expect(runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "published", epochId: "epoch" });
    expect(runtime.operations()?.epochId).toBe("epoch");
  });

  it("keeps Core serving when the selected Hindsight runtime fails to start at boot and republishes it through recover", async () => {
    const f = fixture(); const runtime = f.compose();
    f.config.upsert("TAKI_HINDSIGHT_ENABLED", false);
    expect(() => runtime.start()).not.toThrow();
    expect(runtime.operations()).toBeNull();
    expect(runtime.hindsightBindingSnapshot().binding).toMatchObject({ kind: "unavailable", epochId: "epoch" });
    await expect(runtime.captureRun("taki")).rejects.toThrow("MEMORY_RUNTIME_UNAVAILABLE");
    f.config.upsert("TAKI_HINDSIGHT_ENABLED", true);
    expect(runtime.recoverHindsightBinding("epoch")).toEqual({ binding: "published", reconciledGroups: 0 });
    expect(runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "published", epochId: "epoch" });
    expect(runtime.operations()?.scheduler.started()).toBe(true);
    expect(runtime.recoverHindsightBinding("epoch")).toEqual({ binding: "healthy", reconciledGroups: 0 });
  });

  it("uses verified replica data during an outage while retaining Hindsight identity and explicit partial status", async () => {
    const f = fixture(); const runtime = f.compose(); await runtime.captureRun("taki"); f.remote.control.offline = true;
    const run = await runtime.captureRun("taki"); expect(run.snapshot.providerId).toBe("hindsight"); const result = await recall(run);
    expect(result).toMatchObject({ ok: true, providerId: "hindsight", data: { returned: 2, partial: true, vectorState: "degraded" } });
    expect(await run.automaticRecall!({ query: "fact", visibleContext: "", now: Date.now() })).toContain("bank-a fact memory-a");
    expect(runtime.selected.legacy).toBeNull();
  });

  it("flushes one exact committed source into real durable two-Bank coverage during an outage", async () => {
    const model = scriptedGenerateModel([{ kind: "text", deltas: [JSON.stringify({ decision: "keep", route: "both", fromSeq: 1, throughSeq: 2 })] }]);
    const f = fixture({ model }); const subsystem = f.subsystem(); await subsystem.captureRun("taki");
    const entries = [f.timeline.append({ characterId: "taki", role: "user", content: "Original runtime source fact" }),
      f.timeline.append({ characterId: "taki", role: "assistant", content: "Original committed answer" })];
    subsystem.recordPrimaryCommitted({ characterId: "taki", entries }); f.remote.control.offline = true;
    expect(await subsystem.memoryFlush.prepareRetirement({ characterId: "taki", fromSeq: 1, throughSeq: 2, operationId: "runtime-flush" }))
      .toMatchObject({ status: "success", writes: 2, throughSeq: 2 });
    expect(model.doGenerateCalls).toHaveLength(1); expect(JSON.stringify(model.doGenerateCalls)).toContain("Do not summarize, extract facts");
    expect(f.db.prepare("SELECT state FROM hindsight_ingestion_spans").get()?.state).toBe("complete");
    expect(subsystem.state.pending.list({ authorityEpochId: "epoch", bankId: "bank-a" })).toHaveLength(1);
    expect(subsystem.state.pending.list({ authorityEpochId: "epoch", bankId: "bank-taki" })).toHaveLength(1);
    expect(await subsystem.memoryFlush.prepareRetirement({ characterId: "taki", fromSeq: 1, throughSeq: 2, operationId: "runtime-flush-again" }))
      .toMatchObject({ status: "success", writes: 0 }); expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("waits for an abort-ignoring active pull, shares repeated-stop completion and blocks queued/late access", async () => {
    const f = fixture(); const runtime = f.compose(); await runtime.captureRun("taki");
    const entered = deferred(); const release = deferred(); cleanup.push(release.resolve);
    f.remote.control.beforeChanges = async () => { entered.resolve(); await release.promise; };
    const outcomes = Promise.allSettled([runtime.captureRun("taki"), runtime.captureRun("taki")]); await entered.promise;
    const stop = runtime.stop(); expect(runtime.stop()).toBe(stop); let settled = false; void stop.then(() => { settled = true; });
    await tick(); expect(settled).toBe(false); release.resolve(); await stop;
    expect((await outcomes).every((entry) => entry.status === "rejected")).toBe(true);
    f.db.close(); const prepare = vi.spyOn(f.db, "prepare"); await runtime.stop();
    await expect(runtime.captureRun("taki")).rejects.toThrow("MEMORY_OPERATION_CANCELLED");
    expect(() => runtime.snapshot()).toThrow("MEMORY_OPERATION_CANCELLED"); await tick(); expect(prepare).not.toHaveBeenCalled();
  });

  it("settles an active captured native recall before completing runtime shutdown", async () => {
    const f = fixture(); const runtime = f.compose(); const run = await runtime.captureRun("taki");
    const entered = deferred(); const release = deferred(); cleanup.push(release.resolve);
    f.remote.control.beforeRecall = async () => { entered.resolve(); await release.promise; };
    let readSettled = false; const running = recall(run).finally(() => { readSettled = true; });
    await entered.promise; const prepare = vi.spyOn(f.db, "prepare");
    let stopped = false; let activeReadAtStop = true;
    const stopping = runtime.stop().then(() => { activeReadAtStop = !readSettled; stopped = true; });
    await tick(); const stoppedBeforeRelease = stopped; const readsAtStop = prepare.mock.calls.length;
    release.resolve(); await running; await stopping;
    const postStopDbReads = stoppedBeforeRelease ? prepare.mock.calls.length - readsAtStop : 0;
    expect({ activeReadAtStop, postStopDbReads }).toEqual({ activeReadAtStop: false, postStopDbReads: 0 });
  });

  it("preserves frozen Effect authority metadata through the foreground lifetime wrapper", async () => {
    const f = fixture(); const run = await f.compose().captureRun("taki");
    for (const [name, operation] of [["recall", "recall"], ["reflect", "reflect"], ["retain", "retain"],
      ["update_memory", "edit"], ["invalidate_memory", "invalidate"], ["restore_memory", "restore"]] as const) {
      const tool = run.tools[name]!; const metadata = memoryEffectMetadata(tool);
      expect(metadata).toMatchObject({ operation, providerId: "hindsight", authorityEpochId: "epoch",
        providerLineageId: run.snapshot.providerLineageId, capabilityDigest: run.snapshot.capabilityDigest });
      expect(Object.isFrozen(tool)).toBe(true); expect(Object.isFrozen(metadata)).toBe(true);
      expect(Object.isFrozen(metadata?.capabilities)).toBe(true);
    }
  });

  it("rejects held consumers after stop before entering a closed SQLite handle", async () => {
    const f = fixture(); const runtime = f.compose(); const run = await runtime.captureRun("taki");
    await runtime.stop(); f.db.close(); const prepare = vi.spyOn(f.db, "prepare");
    await expect(recall(run)).rejects.toThrow("MEMORY_OPERATION_CANCELLED");
    await expect(run.automaticRecall!({ query: "fact", visibleContext: "", now: Date.now() })).rejects.toThrow("MEMORY_OPERATION_CANCELLED");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rereads both policy knobs through ConfigSource for each actual curator pass", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(APPLICATION_TEST_AT));
    const model = scriptedGenerateModel([1, 2].map((id) => ({ kind: "tool" as const, toolCallId: `finish-${id}`, toolName: "policy_review_finish", input: {} })));
    const f = fixture({ model, banks: [curatorTestBank({ memories: [] }), curatorTestBank({ bankId: "bank-taki", characterId: "taki" })] });
    const subsystem = f.subsystem(); const timer = vi.spyOn(globalThis, "setTimeout");
    f.config.upsert("TAKI_HINDSIGHT_POLICY_PROMPT", "GUIDANCE_ALPHA"); f.config.upsert("TAKI_HINDSIGHT_POLICY_TIMEOUT_MS", 12_001);
    await subsystem.curator.runNow("taki"); expect(JSON.stringify(model.doGenerateCalls[0])).toContain("GUIDANCE_ALPHA");
    expect(timer.mock.calls.some(([, delay]) => delay === 12_001)).toBe(true);
    vi.setSystemTime(new Date(Date.parse(APPLICATION_TEST_AT) + 61_000));
    f.config.upsert("TAKI_HINDSIGHT_POLICY_PROMPT", "GUIDANCE_BETA"); f.config.upsert("TAKI_HINDSIGHT_POLICY_TIMEOUT_MS", 13_001);
    await subsystem.curator.runNow("taki"); expect(JSON.stringify(model.doGenerateCalls.at(-1))).toContain("GUIDANCE_BETA");
    expect(timer.mock.calls.some(([, delay]) => delay === 13_001)).toBe(true); expect(model.doGenerateCalls).toHaveLength(2);
  });

  it.each(["active", "invalidated", "expired"] as const)("known required pin in %s state must not silently disappear when rebinding is unavailable", async (state) => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(APPLICATION_TEST_AT));
    const banks = [knownPinBank("OLD_REQUIRED_PIN", state === "expired" ? "2026-09-11T08:00:30.000Z" : undefined),
      curatorTestBank({ bankId: "bank-taki", characterId: "taki" })];
    const f = fixture({ banks }); const runtime = f.compose(); expect((await runtime.captureRun("taki")).assemble!("")).toContain("OLD_REQUIRED_PIN");
    publishUnboundNative(f, state === "invalidated"); f.remote.control.offline = true;
    if (state === "expired") vi.setSystemTime(new Date("2026-09-11T08:00:31.000Z"));
    if (state === "active") {
      const admission = await runtime.captureRun("taki").then((run) => ({ admitted: true,
        hasOldPin: run.assemble!("").includes("OLD_REQUIRED_PIN"), hasUnboundText: run.assemble!("").includes("NEW_UNBOUND_NATIVE_TEXT") }),
      () => ({ admitted: false }));
      expect(admission).toEqual({ admitted: false });
    }
    else expect((await runtime.captureRun("taki")).assemble!("")).not.toContain("OLD_REQUIRED_PIN");
  });
});

function publishUnboundNative(f: HindsightRuntimeFixture, invalidated: boolean) {
  const bank = f.banks[0]!; const previous = bank.native.find((entry) => entry.head.object_id === "pin")!;
  const native = applicationTestNative({ scope: bank.scope, kind: "memory_unit", cursor: 3, revision: 2,
    payload: applicationTestMemoryPayload({ bank_id: bank.scope.bankId, memory_id: "pin", document_id: null, revision: 2,
      text: "NEW_UNBOUND_NATIVE_TEXT", state: invalidated ? "invalidated" : "valid",
      invalidation_reason: invalidated ? "fixture" : null, invalidated_at: invalidated ? APPLICATION_TEST_AT : null }) });
  native.head = { ...native.head, binding_state: "rebind_required", bound_artifact: previous.head.bound_artifact,
    previous_version: previous.head.version, cause: "native_change" };
  const checkpoint = f.replica.checkpoint(bank.scope.bankId)!;
  const event = applicationTestEvent({ scope: bank.scope, native: [native], from: checkpoint.checkpoint });
  const lease = f.replica.leases.acquire({ bankId: bank.scope.bankId, ownerId: "runtime-rebind-test", durationMs: 60_000 });
  try { f.replica.applyEvent({ ...bank.scope, authorityEpochId: "epoch", event, expectedCheckpoint: checkpoint,
    expectedNativeCheckpoint: checkpoint.native, expectedBank: { bankId: bank.scope.bankId, scope: "global", characterId: null },
    lease, deadlineAt: new Date(Date.now() + 60_000).toISOString() }); }
  finally { f.replica.leases.release(lease); }
}
