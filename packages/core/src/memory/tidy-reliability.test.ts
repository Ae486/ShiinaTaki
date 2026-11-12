import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import { createMemoryAutoRepo } from "../db/memory-auto-repo.ts";
import { createMemoryEventsRepo } from "../db/memory-events-repo.ts";
import { createMemoryTidyReviewRepo } from "../db/memory-tidy-review-repo.ts";
import { createStructuredMemoryBlockRepo } from "../db/structured-memory-block-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { loadMemoryConfig } from "../config/memory-config.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { scriptedGenerateModel, type ScriptStep } from "../testing/mock-language-model.ts";
import { createCanonicalLocalRuntime } from "./canonical-local-runtime.ts";
import { canonicalLayerRetention } from "./canonical-layer-policy.ts";
import { getLayer } from "./layer-registry.ts";
import { createTidyPass, type TidyPassDeps } from "./tidy-pass.ts";
import { createUtilitySlot } from "./utility-slot.ts";

const opened: Database[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const db of opened.splice(0)) db.close();
});
const finish = (id: string, resolutions?: object[]): ScriptStep => ({ kind: "tool", toolCallId: id,
  toolName: "memory_finish_edits", input: resolutions ? { resolutions } : {} });

async function fixture(script: ScriptStep[], changes: Partial<TidyPassDeps> = {}) {
  const at = new Date(Date.now() - 86_400_000).toISOString();
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  opened.push(db);
  const authority = createCanonicalMemoryAuthorityRepo(db);
  const epoch = authority.initializeLocalAuthority(at);
  const engine = createCanonicalLocalRuntime({ db, epochId: epoch.epochId });
  const banks = engine.banks("taki");
  const records = createCanonicalMemoryRepo(db);
  const checkpoints = createMemoryTidyReviewRepo(db, epoch.epochId);
  const model = scriptedGenerateModel(script);
  const { logger } = createCaptureLogger();
  const slot = changes.slot ?? createUtilitySlot({ mainModel: model, logger });
  const autoState = createMemoryAutoRepo(db);
  const deps = { view: engine.tidy, autoState, events: createMemoryEventsRepo(db), slot, checkpoints,
    config: loadMemoryConfig({}), logger, ...changes };
  const pass = createTidyPass(deps);
  let seeds = 0;
  const seed = async (content = "Synthetic distinct memory") => {
    const layer = getLayer("profile")!;
    const result = await engine.provider.retain({ requestId: `seed-${seeds++}`, authorityEpochId: epoch.epochId, actor: "foreground-agent" }, {
      bankId: banks.global.bankId, content, context: "synthetic", timestamp: at, tags: [], entities: [], metadata: {},
      observationScopes: null, documentId: null, strategy: null, updateMode: "replace",
      provenance: { actor: "agent", origin: "explicit-agent", characterId: "taki", timelineFromSeq: null,
        timelineToSeq: null, capturedAt: at, sanitized: true, sourceRef: `source-${seeds}` },
      policy: { layerId: "profile", importance: 5, visibility: layer.recallPolicy, disclosure: "test trigger", origin: "self",
        emotionalWeight: null, retention: canonicalLayerRetention({ layer, at }), policyVersion: 1 },
    });
    if (!result.ok) throw new Error(result.error.code);
    return records.record(epoch.epochId, banks.global.bankId, result.data.memories[0]!.memoryId)!;
  };
  return { db, engine, epoch, model, slot, pass, seed, checkpoints, autoState, records, deps };
}

describe("Local tidy whole-chain reliability", () => {
  it("drains 627 short facts under the default batch size in one request, without repeating input batches", async () => {
    const f = await fixture(Array.from({ length: 7 }, (_, n) => finish(`batch-${n}`)));
    for (let n = 0; n < 627; n++) await f.seed(`Distinct backlog fact number ${n}`);
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", reviewed: 627, remaining: 0, steps: 7 });
    expect(f.model.doGenerateCalls).toHaveLength(7);
    expect(f.model.doGenerateCalls.map((call) => JSON.stringify(call.prompt).match(/Visible review batch \((\d+) memories/)?.[1]))
      .toEqual(["100", "100", "100", "100", "100", "100", "27"]);
  }, 20_000);

  it("lets other Utility work run between batches and accounts each model call exactly once", async () => {
    const f = await fixture([finish("one"), finish("two")], { config: { ...loadMemoryConfig({}), reportClassCap: 1 } });
    await f.seed("First fact"); await f.seed("Second fact");
    const order: string[] = [];
    const generate = f.model.doGenerate.bind(f.model);
    f.model.doGenerate = async (options) => {
      order.push("tidy");
      if (order.length === 1) void f.slot.run("other-background-task", async () => {
        order.push("other"); return { usage: { inputTokens: 0, outputTokens: 0 } };
      });
      const result = await generate(options);
      return { ...result, usage: { inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 3, text: 3, reasoning: 0 } } };
    };
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", reviewed: 2, usage: { inputTokens: 14, outputTokens: 6 } });
    expect(order).toEqual(["tidy", "other", "tidy"]);
  });

  it("uses a fresh deadline per batch rather than ending healthy work at the old operation deadline", async () => {
    const f = await fixture([finish("one"), finish("two")], { config: { ...loadMemoryConfig({}), reportClassCap: 1 } });
    await f.seed("First"); await f.seed("Second");
    const generate = f.model.doGenerate.bind(f.model);
    vi.useFakeTimers({ toFake: ["Date"] });
    f.model.doGenerate = async (options) => {
      vi.setSystemTime(Date.now() + 180_000);
      return generate(options);
    };
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", steps: 2, reviewed: 2, remaining: 0 });
  });

  it("reads changed pending identities afresh but does not chase newly added memories indefinitely", async () => {
    const f = await fixture([finish("one"), finish("two")], { config: { ...loadMemoryConfig({}), reportClassCap: 1 } });
    const originals = [await f.seed("First existing memory"), await f.seed("Second existing memory")];
    const generate = f.model.doGenerate.bind(f.model);
    let calls = 0;
    f.model.doGenerate = async (options) => {
      const result = await generate(options);
      if (++calls === 1) {
        const later = originals.find((record) => !JSON.stringify(options.prompt).includes(record.unit.text))!;
        await f.seed("New memory for later maintenance");
        f.engine.maintenanceStore.policyEdit({ epochId: f.epoch.epochId, bankId: later.unit.bankId,
          memoryId: later.unit.memoryId, expectedRevision: 1, characterId: "taki", requestId: "queued-update",
          now: new Date().toISOString(), patch: { disclosure: "fresh pending version" } });
      }
      return result;
    };
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", reviewed: 2, remaining: 1, nextAction: "continue" });
    expect(JSON.stringify(f.model.doGenerateCalls[1]?.prompt)).toContain("fresh pending version");
    expect(f.checkpoints.read("taki").retry.pending).toBe(true);
  });

  it("shrinks long-content batches by initial input budget instead of truncating memories", async () => {
    const f = await fixture([finish("one"), finish("two"), finish("three")], {
      config: { ...loadMemoryConfig({}), tidyInputTokens: 6500 },
    });
    for (let n = 0; n < 3; n++) await f.seed(`Complete fact ${n}: ${"界".repeat(3000)} end-${n}`);
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", reviewed: 3, remaining: 0 });
    expect(f.model.doGenerateCalls).toHaveLength(3);
    for (const call of f.model.doGenerateCalls) expect(JSON.stringify(call.prompt)).toContain("界".repeat(3000));
  });

  it("drops departed backlog identities without repeatedly reviewing newly edited blocks", async () => {
    const f = await fixture([finish("one")], { config: { ...loadMemoryConfig({}), reportClassCap: 1 } });
    const originals = [await f.seed("First pending memory"), await f.seed("Second pending memory")];
    const blocks = createStructuredMemoryBlockRepo(f.db);
    const scope = { kind: "global" as const, characterId: null };
    blocks.replace({ blockId: "user-card", scope, expectedRevision: 0, actor: "user", content: "界".repeat(600), now: new Date().toISOString() });
    const generate = f.model.doGenerate.bind(f.model);
    f.model.doGenerate = async (options) => {
      const unseen = originals.find((record) => !JSON.stringify(options.prompt).includes(record.unit.text))!;
      f.engine.maintenanceStore.policyEdit({ epochId: f.epoch.epochId, bankId: unseen.unit.bankId,
        memoryId: unseen.unit.memoryId, expectedRevision: 1, characterId: "taki", requestId: "hide-unseen",
        now: new Date().toISOString(), patch: { visibility: "hidden" } });
      blocks.replace({ blockId: "user-card", scope, expectedRevision: 1, actor: "user", content: "新".repeat(601), now: new Date().toISOString() });
      return generate(options);
    };
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", reviewed: 1, remaining: 0, nextAction: "continue" });
    expect(f.model.doGenerateCalls).toHaveLength(1);
    expect(f.checkpoints.read("taki").blocks.find((block) => block.blockId === "user-card")?.revision).toBe(1);
    expect(f.checkpoints.read("taki").retry.pending).toBe(true);
  });

  it("reports an indivisible over-budget memory before calling the model and leaves coverage pending", async () => {
    const f = await fixture([], { config: { ...loadMemoryConfig({}), tidyInputTokens: 1000 } });
    await f.seed("A memory which cannot fit with its required instructions and tools");
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "failed", reason: "input-too-large", nextAction: "check-settings", remaining: 1, reviewed: 0 });
    expect(f.model.doGenerateCalls).toHaveLength(0);
    expect(f.checkpoints.read("taki").memories).toHaveLength(0);
  });

  it("does not split an over-budget duplicate group or mark hidden peers reviewed", async () => {
    const f = await fixture([], { config: { ...loadMemoryConfig({}), tidyInputTokens: 6500 } });
    await f.seed(`SAME ${"界".repeat(3000)}`);
    await f.seed(`same ${"界".repeat(3000)}`);
    expect(await f.pass.runNow("taki")).toMatchObject({ reason: "input-too-large", reviewed: 0, remaining: 2 });
    expect(f.model.doGenerateCalls).toHaveLength(0);
    expect(f.checkpoints.read("taki").memories).toHaveLength(0);
  });

  it("aborts an active ten-minute batch at shutdown and never dispatches the next batch", async () => {
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    let calls = 0;
    const server = createServer(() => { calls++; requestStarted(); });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing fixture address");
    const model = createOpenAICompatible({ name: "fixture", baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "synthetic" }).languageModel("fixture");
    const { logger } = createCaptureLogger();
    const slot = createUtilitySlot({ mainModel: model, logger });
    const f = await fixture([], { slot, config: { ...loadMemoryConfig({}), reportClassCap: 1 } });
    await f.seed("One"); await f.seed("Two");
    const pending = f.pass.runNow("taki");
    await started;
    await f.pass.stop();
    expect(await pending).toMatchObject({ status: "failed", reason: "unfinished", reviewed: 0, remaining: 2 });
    expect(calls).toBe(1);
    expect(await slot.run("after-tidy-stop", async () => "available")).toBe("available");
    await slot.stop();
  });

  it("corrects a malformed handle and rejects premature finish until it is explicitly acknowledged", async () => {
    const f = await fixture([
      { kind: "tool", toolCallId: "bad", toolName: "memory_refile", input: { id: "invented", layer: "episodes" } },
      { kind: "tool", toolCallId: "fixed", toolName: "memory_refile", input: { id: "m1", layer: "episodes" } },
      finish("premature"), finish("accepted", [{ issueId: "issue-1", status: "corrected", correctedBy: "fixed" }]),
    ]);
    await f.seed();
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", edits: 1, steps: 4, reviewed: 1, remaining: 0, recoveredIssues: 1 });
    expect(f.model.doGenerateCalls).toHaveLength(4);
    expect(f.checkpoints.read("taki").memories).toHaveLength(2);
  });

  it("accounts for schema errors in the same ledger without stopping on an unaccepted finish", async () => {
    const f = await fixture([
      { kind: "tool", toolCallId: "bad", toolName: "memory_refile", input: {} },
      finish("accepted", [{ issueId: "issue-1", status: "not-needed", reason: "mistaken-request" }]),
    ]);
    await f.seed();
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", edits: 0, steps: 2, recoveredIssues: 0, skippedIssues: 1 });
    expect(JSON.stringify(f.model.doGenerateCalls[1]?.prompt)).toContain("issue-1");
  });

  it("drains a less-than-threshold tail with fresh per-batch budgets in one operation", async () => {
    const f = await fixture([finish("first"), finish("second"), finish("third")], {
      config: { ...loadMemoryConfig({}), reportClassCap: 2, tidyMaxSteps: 2 },
    });
    for (let n = 0; n < 5; n++) await f.seed(`Independent synthetic fact ${n}`);
    f.autoState.setTidy("taki", new Date().toISOString());
    expect(f.checkpoints.read("taki").memories).toHaveLength(0);
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", steps: 3, reviewed: 5, remaining: 0, nextAction: "none" });
    expect(f.checkpoints.read("taki").memories).toHaveLength(5);
    expect(f.model.doGenerateCalls).toHaveLength(3);
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "clean", remaining: 0 });
    expect(f.model.doGenerateCalls).toHaveLength(3);
  });

  it("captures a fresh view after the shared queue and joins duplicate raw requests", async () => {
    const f = await fixture([finish("done")]);
    const record = await f.seed();
    let release!: () => void;
    const blocker = f.slot.run("synthetic-blocker", () => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    const pending = f.pass.runNow("taki");
    expect(f.pass.runNow("taki")).toBe(pending);
    f.engine.maintenanceStore.policyEdit({ epochId: f.epoch.epochId, bankId: record.unit.bankId, memoryId: record.unit.memoryId,
      expectedRevision: record.unit.revision, characterId: "taki", requestId: "external-change", now: new Date().toISOString(),
      patch: { disclosure: "fresh queue evidence" } });
    release(); await blocker;
    expect(await pending).toMatchObject({ status: "ran", reviewed: 1 });
    expect(JSON.stringify(f.model.doGenerateCalls[0]?.prompt)).toContain("fresh queue evidence");
    expect(f.checkpoints.read("taki").memories[0]?.revision).toBe(2);
  });

  it("keeps admitted retention policy through the shared queue and updates the next tidy operation", async () => {
    const config = { ...loadMemoryConfig({}), intentionsDefaultDays: 4 };
    const f = await fixture([
      { kind: "tool", toolCallId: "refile-old", toolName: "memory_refile", input: { id: "m1", layer: "intentions" } }, finish("old-done"),
      { kind: "tool", toolCallId: "refile-new", toolName: "memory_refile", input: { id: "m1", layer: "intentions" } }, finish("new-done"),
    ], { config, captureConfig: () => config });
    await f.seed("First planned intention");
    let release!: () => void;
    const blocker = f.slot.run("retention-test-blocker", () => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    const old = f.pass.runNow("taki");
    config.intentionsDefaultDays = 9;
    release(); await blocker;
    expect(await old).toMatchObject({ status: "ran", edits: 1 });
    await f.seed("Second planned intention");
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", edits: 1 });
    const intentions = f.engine.maintenanceStore.list({ epochId: f.epoch.epochId, characterId: "taki" })
      .filter((record) => record.policy.layerId === "intentions");
    expect(intentions).toHaveLength(2);
    expect(intentions.map((record) => record.policy.retention.kind === "expiring"
      ? (Date.parse(record.policy.retention.expiresAt) - Date.parse(record.policy.updatedAt)) / 86_400_000 : null).sort())
      .toEqual([4, 9]);
  });

  it("keeps a complete duplicate group visible and actionable even with a one-candidate cap", async () => {
    const f = await fixture([
      { kind: "tool", toolCallId: "archive", toolName: "memory_archive_supersede", input: { id: "m2" } }, finish("done"),
    ], { config: { ...loadMemoryConfig({}), reportClassCap: 1 } });
    const first = await f.seed("same content");
    const second = await f.seed("SAME   CONTENT");
    expect(first.unit.memoryId).not.toBe(second.unit.memoryId);
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", edits: 1, reviewed: 2, remaining: 0 });
    const prompt = JSON.stringify(f.model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("[m1]");
    expect(prompt).toContain("[m2]");
    expect(prompt).toContain("same content");
    expect(prompt).toContain("SAME   CONTENT");
  });

  it("does not checkpoint an external revision which changed after the report was captured", async () => {
    const f = await fixture([finish("first"), finish("second")], { config: { ...loadMemoryConfig({}), tidyMaxSteps: 1 } });
    const record = await f.seed();
    const generate = f.model.doGenerate.bind(f.model);
    let changed = false;
    f.model.doGenerate = async (options) => {
      const result = await generate(options);
      if (!changed) {
        changed = true;
        f.engine.maintenanceStore.policyEdit({ epochId: f.epoch.epochId, bankId: record.unit.bankId, memoryId: record.unit.memoryId,
          expectedRevision: 1, characterId: "taki", requestId: "mid-review-change", now: new Date().toISOString(), patch: { disclosure: "new external version" } });
      }
      return result;
    };
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", reviewed: 1, remaining: 1, nextAction: "continue" });
    expect(f.checkpoints.read("taki").retry.pending).toBe(true);
    expect(f.checkpoints.read("taki").memories[0]?.revision).toBe(1);
    expect(await f.pass.runNow("taki")).toMatchObject({ status: "ran", reviewed: 1, remaining: 0 });
    expect(f.checkpoints.read("taki").memories[0]?.revision).toBe(2);
  });

  it("does not report an unreadable capture as zero remaining work", async () => {
    const f = await fixture([]);
    await f.seed();
    const view = { ...f.engine.tidy, captureReview: () => { throw new Error("capture unavailable"); } };
    const progress: unknown[] = [];
    await expect(createTidyPass({ ...f.deps, view }).runNow("taki", { onProgress: (value) => progress.push(value) }))
      .rejects.toThrow("MEMORY_PROVIDER_UNAVAILABLE");
    expect(progress).toHaveLength(0);
    expect(f.model.doGenerateCalls).toHaveLength(0);
  });

  it("rolls back an edit when its operation progress cannot be persisted", async () => {
    const f = await fixture([
      { kind: "tool", toolCallId: "change", toolName: "memory_set_disclosure", input: { id: "m1", disclosure: "should roll back" } },
      finish("done"),
    ]);
    const record = await f.seed();
    const outcome = await f.pass.runNow("taki", { onProgress: (progress) => { if (progress.edits > 0) throw new Error("observer persistence failed"); } });
    expect(outcome).toMatchObject({ status: "failed", edits: 0, reason: "tool-errors" });
    expect(f.records.record(f.epoch.epochId, record.unit.bankId, record.unit.memoryId)?.unit.revision).toBe(1);
    expect(f.checkpoints.read("taki").memories).toHaveLength(0);
  });

  it("rearms automatic maintenance when an explicit retry confirms the store is already clean", async () => {
    const f = await fixture([finish("fresh")], { config: { ...loadMemoryConfig({}), tidyWriteThreshold: 1 } });
    for (let attempt = 0; attempt < 3; attempt++) f.checkpoints.failed("taki", new Date().toISOString());
    expect(f.checkpoints.read("taki").retry).toMatchObject({ pending: true, failures: 3, retryAt: null });

    expect(await f.pass.runNow("taki")).toMatchObject({ status: "clean", remaining: 0 });
    expect(f.checkpoints.read("taki").retry).toEqual({ pending: false, failures: 0, retryAt: null });
    expect(f.model.doGenerateCalls).toHaveLength(0);

    await f.seed("A new memory after the store recovered");
    await f.pass.maybeRun("taki");
    expect(f.model.doGenerateCalls).toHaveLength(1);
    expect(f.checkpoints.read("taki").memories).toHaveLength(1);
  });

  it("keeps retry backoff and the stop budget across producer recreation", async () => {
    const f = await fixture([]);
    await f.seed();
    for (let n = 0; n < 3; n++) {
      expect(await f.pass.runNow("taki")).toMatchObject({ status: "failed", nextAction: n < 2 ? "retry" : "manual-retry" });
      const calls = f.model.doGenerateCalls.length;
      await createTidyPass(f.deps).maybeRun("taki");
      expect(f.model.doGenerateCalls).toHaveLength(calls);
    }
    expect(f.checkpoints.read("taki").retry).toEqual({ pending: true, failures: 3, retryAt: null });
  });

  it("aborts a stalled real compatible HTTP response and releases the Utility Slot", async () => {
    let calls = 0;
    const server = createServer((_request, response) => {
      calls += 1;
      if (calls > 1) return;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "synthetic", object: "chat.completion", created: 1, model: "fixture",
        choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
          tool_calls: [{ id: "block", type: "function", function: { name: "block_rethink",
            arguments: JSON.stringify({ id: "memory-index", content: "Synthetic updated block" }) } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing fixture address");
    const model = createOpenAICompatible({ name: "fixture", baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "synthetic" }).languageModel("fixture");
    const { logger } = createCaptureLogger();
    const slot = createUtilitySlot({ mainModel: model, logger });
    const f = await fixture([], { slot, timeoutMs: 300 });
    await f.seed();
    const progress: number[] = [];
    const result = await f.pass.runNow("taki", { onProgress: (value) => progress.push(value.edits) });
    expect(result).toMatchObject({ status: "partial", edits: 1, reason: "timeout", nextAction: "retry" });
    expect(progress).toContain(1);
    expect(calls).toBe(2);
    expect(await slot.run("after-timeout", async () => "available")).toBe("available");
    await slot.stop();
  });
});
