import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LanguageModel } from "ai";
import { expect, it } from "vitest";
import { createChatAgent } from "./chat-agent.ts";
import { BASE_SYSTEM_PROMPT } from "./base-prompt.ts";
import { createConversationStore } from "./conversation-store.ts";
import { createCompactionPass } from "./compaction-pass.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import { createUtilitySlot } from "../memory/utility-slot.ts";
import { createModels } from "../config/provider-factory.ts";
import { loadProviderConfig } from "../config/provider-config.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { preparedPublicationFixture } from "../testing/prepared-publication-fixture.ts";
import { streamingMockModel, generatingModel } from "../testing/mock-language-model.ts";
import { observeRealProvider } from "../../../../e2e/src/fixture/real-provider-observer.ts";
import { realProviderEnv } from "../../../../e2e/src/fixture/paths.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const CASES = [
  { id: "a1-external", external: true, unknown: false,
    question: "刚才是谁被裁员了？是谁的项目停了？请只依据这段对话简短回答。",
    followup: "仅根据当前提供的对话记录，回顾一下：裁员和项目停止分别是谁的经历？" },
  { id: "a2-self-report", external: false, unknown: false,
    question: "我被裁员了，我的项目也停了。请简短确认你理解的是谁的事情。",
    followup: "仅根据当前提供的对话记录，回顾一下：谁失业了、谁的项目停了？" },
  { id: "a3-mixed-unknown", external: true, unknown: true,
    question: "视频里林述说自己被裁员了。我没有被裁员，但我的项目停了。另外那句‘搬家那阵子特别累’来源不明。请把人物和事件分开说明。",
    followup: "仅根据当前提供的对话记录，上次说的裁员、项目停止和搬家分别能确定是谁的经历？哪些还不知道？" },
] as const;
type Scenario = typeof CASES[number];
type Fixture = Awaited<ReturnType<typeof preparedPublicationFixture>>;

async function answer(f: Fixture, agent: ReturnType<typeof createChatAgent>, message: string) {
  const id = randomUUID();
  const admission = await f.runs.admit({ triggerRequestId: id, idempotencyKey: id, characterId: "taki", initiator: "primary",
    provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary" });
  f.runs.start(admission.run.runId, admission.attempt.attemptId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("source acceptance deadline"), 120_000);
  let text = "";
  try {
    for await (const part of agent.stream({ characterId: "taki", message }, { runId: admission.run.runId,
      attemptId: admission.attempt.attemptId, signal: controller.signal, runContext: {
        ...f.runs.context(admission.run.runId), tools: {}, memoryTools: {}, memoryPrompt: BASE_SYSTEM_PROMPT,
        assembleMemory: () => "This isolated synthetic Character has no stored personal user facts. Answer from the supplied conversation; no Memory tools are available.",
      } })) text += part;
    if (controller.signal.aborted || !text.trim()) throw new Error("SOURCE_ACCEPTANCE_NO_COMPLETED_ANSWER");
    f.runs.settle(admission.run.runId, admission.attempt.attemptId, "completed", { retryable: false });
    return text;
  } catch {
    f.runs.settle(admission.run.runId, admission.attempt.attemptId, "failed", { retryable: false });
    throw new Error("SOURCE_ACCEPTANCE_ANSWER_FAILED");
  } finally { clearTimeout(timer); }
}

async function runScenario(scenario: Scenario, model: LanguageModel, requestedModel: string) {
  const f = await preparedPublicationFixture({ expiresAt: new Date(Date.now() + 600_000).toISOString(), modelId: requestedModel });
  const logger = createCaptureLogger().logger;
  const slot = createUtilitySlot({ mainModel: model, logger });
  const summaries = createSummaryRepo(f.db);
  const store = createConversationStore({ repo: f.timeline, summaries });
  const agent = createChatAgent({ model, memory: f.memory, store, effectLifecycle: f.effects, maxSteps: 6 });
  try {
    if (scenario.external) {
      f.candidates.set("one", { candidateRef: "one", revision: "r1", text: "我被裁员了，我的项目也停了。", expiresAt: f.accepted.expiresAt,
        sourceContext: { materials: [{ label: "合成访谈视频", speaker: "林述（视频叙述者）", reference: "fixture:interview-lin", time: "10-20 seconds" }] } });
      const publication = await f.owner.publish({ candidateRef: "one", expectedRevision: "r1" });
      expect(publication).toMatchObject({ state: "sent" });
    }
    if (scenario.unknown) f.timeline.append({ characterId: "taki", role: "assistant", content: "搬家那阵子特别累。" });
    const initial = await answer(f, agent, scenario.question);
    const mustRetire = f.timeline.latestSeq("taki");
    for (const [role, content] of [["user", "先把这个话题放一放，换个轻松一点的聊天内容。"],
      ["assistant", "可以，我们先放松一会儿，再回到刚才的话题。"],
      ["user", "给我介绍一种常见的颜色搭配吧。"],
      ["assistant", "蓝色和白色是常见搭配，也可以调整深浅来形成不同的感觉。"]] as const) {
      f.timeline.append({ characterId: "taki", role, content });
    }
    const witnesses = Number(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_primary_commits").get()?.n ?? 0);
    expect(witnesses).toBe(0);
    const before = f.timeline.latestAscending("taki", 30);
    const pass = createCompactionPass({ timeline: f.timeline, summaries, operations: createCompactionOperationRepo(f.db), slot, logger,
      view: { estimatedTokens: () => 1000, budget: () => 100 }, config: { triggerRatio: 0.8, keepMessages: 1, summaryQuality: true, retryBudget: 1 },
      // This fixture never installs canonical primary eligibility. It tests projection, not Memory flush.
      flush: { prepareRetirement: async () => ({ status: "not_required", reason: "before_canonical_ingestion_eligibility" }) } });
    await pass.maybeRun("taki");
    const summary = summaries.get("taki");
    expect(summary?.throughSeq).toBeGreaterThanOrEqual(mustRetire);
    expect(summary?.text.trim()).toBeTruthy();
    const after = await answer(f, agent, scenario.followup);
    return { id: scenario.id, question: scenario.question, initial, summary, followup: scenario.followup, after,
      sourceRows: before, finalReplay: store.history("taki"), utilityUsage: slot.usage(),
      usage: f.db.prepare("SELECT provider,model_id,quality,input_tokens,output_tokens,total_tokens FROM run_usage").all(),
      compaction: f.db.prepare("SELECT state,source_digest,failure_code,selected_from_seq,selected_through_seq FROM conversation_compaction_operations").all(),
      memoryFlush: "unexercised: no canonical witness callbacks installed; test-controlled flush seam", primaryWitnessCount: witnesses };
  } finally { await slot.stop(); f.cleanup(); }
}

function sourceHashes() {
  const paths = ["pnpm-lock.yaml", "packages/core/src/agents/chat-agent.ts", "packages/core/src/agents/base-prompt.ts",
    "packages/core/src/agents/source-context.ts", "packages/core/src/agents/source-interpretation.ts", "packages/core/src/agents/turn-mapping.ts",
    "packages/core/src/agents/context-reduction.ts", "packages/core/src/agents/compaction-pass.ts", "packages/core/src/agents/compaction-coordinator.ts",
    "packages/core/src/agents/conversation-store.ts", "packages/core/src/db/timeline-repo.ts", "packages/core/src/memory/write-convention.ts",
    "packages/core/src/delivery/prepared-publication.ts", "packages/core/src/db/run-delivery-repo.ts", "packages/core/src/agents/source-context-real.test.ts"];
  return Object.fromEntries(paths.map((path) => [path, createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex")]));
}

it("exercises all source semantic fixture paths without paying for model calls", async () => {
  for (const scenario of CASES) {
    const model = streamingMockModel(["合成回答保留人物归属。"]);
    model.doGenerate = generatingModel("我们讨论了材料中的人物及用户明确说过的情况。来源不明的旧话没有确定主体。").doGenerate;
    const result = await runScenario(scenario, model, "scripted");
    expect(result.compaction).toEqual([expect.objectContaining({ state: "committed" })]);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(result.utilityUsage.calls).toBe(1);
  }
});

it.skipIf(process.env.TAKI_E2E_REAL_SOURCE_CONTEXT !== "1")("observes three bounded candidate-only real source and post-compaction cases", async () => {
  const environment = realProviderEnv(); if (!environment) throw new Error("SOURCE_PROVIDER_CONFIGURATION_MISSING");
  const config = loadProviderConfig(environment);
  const output = resolve(process.env.TAKI_E2E_SOURCE_EVIDENCE_DIR ?? "");
  const allowed = resolve(ROOT, ".trellis/tasks/10-21-agent-source-context/research");
  if (!output.startsWith(allowed + (process.platform === "win32" ? "\\" : "/"))) throw new Error("SOURCE_EVIDENCE_PATH_REQUIRED");
  mkdirSync(output, { recursive: true });
  const save = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n", "utf8");
  const before = sourceHashes(); save("source-hashes-before.json", before);
  const relay = await observeRealProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey, syntheticCapture: {
    maxUpstreamRequests: 12, onRequest(request) { writeFileSync(join(output, `request-${request.requestNumber}.json`), request.body, "utf8"); },
  } });
  const model = createModels({ provider: { ...config, baseUrl: relay.baseUrl, apiKey: "synthetic-observer-only" }, vision: null, includeUsage: true }).model;
  const completed: string[] = [];
  try {
    for (const scenario of CASES) { save(`${scenario.id}.json`, await runScenario(scenario, model, config.model)); completed.push(scenario.id); }
    expect(sourceHashes()).toEqual(before);
  } finally {
    await relay.close(); save("requests.json", relay.requests); save("source-hashes-after.json", sourceHashes());
    save("run.json", { requestedModel: config.model, completed, candidateOnly: true, sourceAndPlayback: "synthetic accepted source; no actual playback",
      logicalGenerationsLimit: 9, physicalRequestsLimit: 12, semanticReview: "Review saved outputs; deterministic checks alone do not pass semantics." });
  }
}, 600_000);
