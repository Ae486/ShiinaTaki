import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemoryOperationListResultSchema, MemoryOperationStatusResultSchema, MemoryOperationSubmitResultSchema,
  MemoryTidyResultSchema, type MemoryOperation,
} from "@taki/shared";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createStructuredMemoryBlockRepo } from "../../db/structured-memory-block-repo.ts";
import { createSummaryRepo } from "../../db/summary-repo.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";
import { createMemoryOperationSubscriptions } from "../../server/memory-operation-subscriptions.ts";
import { createMethodRegistry, type MethodContext, type MethodRegistry } from "../../server/method-registry.ts";
import { registerMemoryOperationMethods } from "../../server/methods/memory-operation-methods.ts";
import { memoryTidyMethod } from "../../server/methods/memory-tidy.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { scriptedGenerateModel, type ScriptStep } from "../../testing/mock-language-model.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { canonicalLayerRetention } from "../canonical-layer-policy.ts";
import { createCanonicalLocalRuntime } from "../canonical-local-runtime.ts";
import { getLayer } from "../layer-registry.ts";
import { composeMemoryRuntime } from "../runtime-composition.ts";
import { activateLocalRuntimeFixture } from "../runtime-local-activation-test-fixture.ts";
import { fakeSetup } from "./memory-operation-fixtures.ts";
import { createMemoryOperationService, type MemoryOperationService } from "./memory-operation-service.ts";
import { createTidyOperationAdapter } from "./tidy-operation-adapter.ts";
import { createAuxiliaryUsageMeter } from "../../observability/auxiliary-usage-meter.ts";
import { createAuxiliaryUsageRepo } from "../../db/auxiliary-usage-repo.ts";
import { createMaintenanceMonitorRepo } from "../../db/maintenance-monitor-repo.ts";

const FINISH: ScriptStep = { kind: "tool", toolCallId: "finish", toolName: "memory_finish_edits", input: {} };
const UPDATE_BLOCK: ScriptStep = { kind: "tool", toolCallId: "update-block", toolName: "block_rethink",
  input: { id: "user-model", content: "Synthetic reviewed understanding." } };
const GLOBAL = { kind: "global", characterId: null } as const;

interface Opened {
  db: Database;
  dataDir: string;
  release: Array<() => void>;
  services: MemoryOperationService[];
  runtime?: ReturnType<typeof composeMemoryRuntime>;
}
const opened: Opened[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) {
    for (const release of item.release) release();
    await item.runtime?.stop();
    for (const service of item.services) await service.stop();
    item.db.close();
    rmTempDir(item.dataDir);
  }
  vi.restoreAllMocks();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function boot(steps: ScriptStep[], env: Record<string, string> = {}, canonical = true) {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-tidy-integration-"));
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const lifetime: Opened = { db, dataDir, release: [], services: [] };
  opened.push(lifetime);
  const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority(new Date().toISOString());
  if (canonical) activateLocalRuntimeFixture(db, epoch.epochId);
  const model = scriptedGenerateModel(steps);
  const calls: Array<Parameters<typeof model.doGenerate>[0]> = [];
  const holds = new Map<number, { entered: ReturnType<typeof deferred>; resume: ReturnType<typeof deferred> }>();
  const generate = model.doGenerate.bind(model);
  vi.spyOn(model, "doGenerate").mockImplementation(async (options) => {
    calls.push(options);
    const hold = holds.get(calls.length);
    if (hold) { hold.entered.resolve(); await hold.resume.promise; }
    return generate(options);
  });
  const { logger, records } = createCaptureLogger();
  const usageMeter = createAuxiliaryUsageMeter({ repo: createAuxiliaryUsageRepo(db), logger });
  const runtime = composeMemoryRuntime({ db, dataDir, bootId: "fixture-first-boot", promptDir: join(dataDir, "prompt"), model,
    usageMeter,
    timeline: createTimelineRepo(db), summaries: createSummaryRepo(db), windowStart: () => 1,
    estimatedTokens: () => 0, budget: () => 100_000, compact: { triggerRatio: 0.8, keepMessages: 3 },
    env: { TAKI_MEMORY_TIDY_WRITE_THRESHOLD: "1", ...env }, logger });
  lifetime.runtime = runtime;
  await runtime.captureRun("taki");
  const subscriptions = createMemoryOperationSubscriptions();
  const serviceInput = { db, live: runtime.operations, tidy: runtime.tidyOperations, setup: fakeSetup(),
    bootId: "fixture-first-boot", logger, onChanged: subscriptions.publish };
  const service = createMemoryOperationService(serviceInput);
  lifetime.services.push(service);
  const adapter = createTidyOperationAdapter(service, () => runtime.tidyOperations().authorityEpochId);
  runtime.installTidySubmit(async (characterId) => { await adapter.runNow(characterId); });
  const registry = createMethodRegistry();
  registerMemoryOperationMethods(registry, { service, subscriptions, logger });
  registry.register(memoryTidyMethod(adapter));
  const seedRuntime = createCanonicalLocalRuntime({ db, epochId: epoch.epochId });
  const banks = seedRuntime.banks("taki");
  const layer = getLayer("profile")!;
  const at = new Date().toISOString();
  for (const suffix of ["one", "two"]) {
    const retained = await seedRuntime.provider.retain({ requestId: `seed-${suffix}`, authorityEpochId: epoch.epochId, actor: "foreground-agent" }, {
      bankId: banks.global.bankId, content: `Synthetic stable fact ${suffix}.`, context: "integration fixture", timestamp: at,
      tags: [], entities: [], metadata: {}, observationScopes: null, documentId: null, strategy: null, updateMode: "replace",
      provenance: { actor: "agent", origin: "explicit-agent", characterId: "taki", timelineFromSeq: null,
        timelineToSeq: null, capturedAt: at, sanitized: true, sourceRef: `fixture-${suffix}` },
      policy: { layerId: layer.id, importance: 5, visibility: layer.recallPolicy, disclosure: `lookup ${suffix}`, origin: "self",
        emotionalWeight: null, retention: canonicalLayerRetention({ layer, at }), policyVersion: 1 },
    });
    expect(retained.ok).toBe(true);
  }
  const holdCall = (number: number) => {
    const entered = deferred();
    const resume = deferred();
    lifetime.release.push(resume.resolve);
    holds.set(number, { entered, resume });
    return { entered: entered.promise, release: resume.resolve };
  };
  return { db, runtime, service, serviceInput, subscriptions, registry, logger, records, calls, holdCall, lifetime,
    blocks: createStructuredMemoryBlockRepo(db) };
}

function client() {
  const notifications: Array<{ method: string; params: unknown }> = [];
  const closers: Array<() => void> = [];
  const ctx: MethodContext = {
    connection: { state: { status: "authenticated", deviceId: "fixture-operator", role: "operator", capabilities: [] } },
    notify: (method, params) => { notifications.push({ method, params }); }, close: () => undefined,
    onClose: (callback) => { closers.push(callback); },
  };
  return { ctx, notifications, close: () => { for (const close of closers.splice(0)) close(); } };
}

let requestId = 0;
function rpc(registry: MethodRegistry, ctx: MethodContext, call: { method: string; params: unknown }) {
  return registry.dispatch({ jsonrpc: "2.0", id: ++requestId, ...call }, ctx);
}

function result(response: Awaited<ReturnType<typeof rpc>>): unknown {
  if (!("result" in response)) throw new Error(`Unexpected RPC error: ${JSON.stringify(response)}`);
  return response.result;
}

function latestTidy(service: MemoryOperationService): MemoryOperation {
  const operation = service.list({ kind: "tidy", characterId: "taki", includeTerminal: true, limit: 1 })[0];
  if (!operation) throw new Error("Expected a durable tidy operation");
  return operation;
}

describe("memory tidy production wiring", () => {
  it("admits automatic Legacy tidy through the same operation owner and records its actual call", async () => {
    const f = await boot([FINISH], {}, false);
    f.runtime.memory.writeEntry({ characterId: "taki", type: "episodes", content: "Synthetic Legacy automatic observation.",
      importance: 4, disclosure: "synthetic trigger", origin: "observed" });
    await f.runtime.tidy.maybeRun("taki");
    const monitor = createMaintenanceMonitorRepo(f.db);
    const operation = monitor.read({ characterId: "taki" }).rows[0]!;
    expect(operation).toMatchObject({ status: "completed", ref: { kind: "tidy" }, progress: { reviewed: null, remaining: null } });
    expect(monitor.read({ characterId: "taki", selected: operation.ref }).detail?.calls.rows[0])
      .toMatchObject({ operation: operation.ref, source: "utility", label: "tidy", status: "completed" });
  });

  it("associates every actual SDK call across bounded batches with one durable tidy operation", async () => {
    const f = await boot([FINISH, FINISH], { TAKI_MEMORY_TIDY_REPORT_CAP: "1" });
    const operation = f.service.submit({ kind: "tidy", characterId: "taki" });
    const settled = await f.service.wait(operation.operationId);
    expect(settled).toMatchObject({ state: "completed", result: { kind: "tidy", outcome: { reviewed: 2, remaining: 0 } } });
    const detail = createMaintenanceMonitorRepo(f.db).read({ characterId: "taki",
      selected: { kind: "tidy", operationId: operation.operationId, characterId: "taki" } }).detail!;
    expect(detail.calls.totalCalls).toBe(2);
    expect(detail.calls.rows.every((call) => call.operation?.operationId === operation.operationId && call.label === "tidy")).toBe(true);
    expect(new Set(detail.calls.rows.map((call) => call.taskId)).size).toBe(2);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM run_usage").get()?.n).toBe(0);
  });

  it("joins an automatic Local pass through compatibility RPC and restores its result through a replacement subscriber", async () => {
    const f = await boot([UPDATE_BLOCK, FINISH]);
    const first = client();
    await rpc(f.registry, first.ctx, { method: "memory.operations.subscribe", params: {} });
    const gate = f.holdCall(1);
    const automatic = f.runtime.autoMemory.onTurnCompleted("taki", "heartbeat");
    await gate.entered;
    const operation = latestTidy(f.service);
    const compatibility = rpc(f.registry, first.ctx, { method: "memory.tidy", params: { characterId: "taki" } });
    const duplicate = await rpc(f.registry, first.ctx, { method: "memory.operations.submit", params: { request: { kind: "tidy", characterId: "taki" } } });
    expect(duplicate).toMatchObject({ error: { data: { reason: "MEMORY_OPERATION_BUSY", activeOperationId: operation.operationId } } });
    expect(f.db.prepare("SELECT count(*) AS count FROM memory_operations WHERE kind='tidy'").get()?.count).toBe(1);
    first.close();
    expect(f.subscriptions.count()).toBe(0);
    const replacement = client();
    await rpc(f.registry, replacement.ctx, { method: "memory.operations.subscribe", params: {} });
    const baseline = MemoryOperationStatusResultSchema.parse(result(await rpc(f.registry, replacement.ctx,
      { method: "memory.operations.status", params: { operationId: operation.operationId } })));
    expect(baseline.operation.terminalAt).toBeNull();
    gate.release();
    await automatic;
    expect(MemoryTidyResultSchema.parse(result(await compatibility))).toMatchObject({ status: "ran", edits: 1 });
    expect(f.blocks.read("user-model", GLOBAL)?.content).toBe("Synthetic reviewed understanding.");
    const settled = MemoryOperationStatusResultSchema.parse(result(await rpc(f.registry, replacement.ctx,
      { method: "memory.operations.status", params: { operationId: operation.operationId } })));
    expect(settled.operation).toMatchObject({ state: "completed", result: { kind: "tidy", outcome: { edits: 1, remaining: 0 } } });
    expect(replacement.notifications).toContainEqual(expect.objectContaining({ method: "memory.operations.changed",
      params: expect.objectContaining({ operation: expect.objectContaining({ operationId: operation.operationId, state: "completed" }) }) }));
    expect(f.calls).toHaveLength(2);
    await f.runtime.autoMemory.onTurnCompleted("taki", "heartbeat");
    expect(f.calls).toHaveLength(2);
    expect(f.db.prepare("SELECT count(*) AS count FROM memory_operations WHERE kind='tidy'").get()?.count).toBe(1);
    replacement.close();
  });

  it("captures a fresh Block after queued utility work finishes, through the actual runtime producer", async () => {
    const f = await boot([FINISH]);
    f.blocks.replace({ blockId: "user-model", scope: GLOBAL, actor: "background", content: "obsolete-before-queue" });
    const blocker = deferred();
    const entered = deferred();
    f.lifetime.release.push(blocker.resolve);
    const precedingWork = f.runtime.utility.run("synthetic-preceding-work", async () => { entered.resolve(); await blocker.promise; });
    await entered.promise;
    const operator = client();
    const admitted = MemoryOperationSubmitResultSchema.parse(result(await rpc(f.registry, operator.ctx,
      { method: "memory.operations.submit", params: { request: { kind: "tidy", characterId: "taki" } } })));
    expect(f.calls).toHaveLength(0);
    f.blocks.replace({ blockId: "user-model", scope: GLOBAL, actor: "background", expectedRevision: 1, content: "fresh-after-queue" });
    blocker.resolve();
    await precedingWork;
    const settled = await f.service.wait(admitted.operation.operationId);
    expect(settled.state).toBe("completed");
    const providerRequest = JSON.stringify(f.calls[0]?.prompt);
    expect(providerRequest).toContain("fresh-after-queue");
    expect(providerRequest).not.toContain("obsolete-before-queue");
    expect(f.calls).toHaveLength(1);
  });

  it("recovers committed actual Block progress through RPC after reconstructing the operation owner", async () => {
    const f = await boot([UPDATE_BLOCK, { kind: "tool", toolCallId: "retired-update", toolName: "block_rethink",
      input: { id: "user-model", content: "A retired operation must not commit this replacement." } }],
    { TAKI_MEMORY_TIDY_MAX_STEPS: "2" });
    const gate = f.holdCall(2);
    const original = client();
    const admitted = MemoryOperationSubmitResultSchema.parse(result(await rpc(f.registry, original.ctx,
      { method: "memory.operations.submit", params: { request: { kind: "tidy", characterId: "taki" } } })));
    await gate.entered;
    expect(f.blocks.read("user-model", GLOBAL)?.revision).toBe(1);
    expect(f.service.status(admitted.operation.operationId).producer).toMatchObject({ kind: "tidy", progress: { edits: 1 } });

    const subscriptions = createMemoryOperationSubscriptions();
    const restarted = createMemoryOperationService({ ...f.serviceInput, bootId: "fixture-second-boot", onChanged: subscriptions.publish });
    f.lifetime.services.push(restarted);
    const registry = createMethodRegistry();
    registerMemoryOperationMethods(registry, { service: restarted, subscriptions, logger: f.logger });
    const replacement = client();
    await rpc(registry, replacement.ctx, { method: "memory.operations.subscribe", params: {} });
    const recovered = MemoryOperationStatusResultSchema.parse(result(await rpc(registry, replacement.ctx,
      { method: "memory.operations.status", params: { operationId: admitted.operation.operationId } })));
    expect(recovered.operation).toMatchObject({ state: "outcome_unknown", reason: "core_restart",
      producer: { kind: "tidy", progress: { edits: 1 } }, result: null });
    gate.release();
    await f.service.stop();
    expect((await restarted.wait(admitted.operation.operationId)).state).toBe("outcome_unknown");
    expect(f.blocks.read("user-model", GLOBAL)?.revision).toBe(1);
    expect(f.blocks.read("user-model", GLOBAL)?.content).toBe("Synthetic reviewed understanding.");
    expect(f.calls).toHaveLength(2);

    const setup = restarted.submit({ kind: "setup.validate", expectedRevision: f.serviceInput.setup.status().revision });
    await restarted.wait(setup.operationId);
    const latest = MemoryOperationListResultSchema.parse(result(await rpc(registry, replacement.ctx,
      { method: "memory.operations.list", params: { kind: "tidy", characterId: "taki", includeTerminal: true, limit: 1 } })));
    expect(latest.operations.map((operation) => operation.operationId)).toEqual([admitted.operation.operationId]);
    expect(latest.operations[0]?.producer).toMatchObject({ progress: { edits: 1 } });
    expect(f.calls).toHaveLength(2);
    replacement.close();
    expect(subscriptions.count()).toBe(0);
  });
});
