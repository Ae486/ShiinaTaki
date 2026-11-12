import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { expect, it } from "vitest";
import { z } from "zod";
import { createChatAgent } from "./chat-agent.ts";
import { BASE_SYSTEM_PROMPT } from "./base-prompt.ts";
import { createConversationStore } from "./conversation-store.ts";
import { createCompactionPass } from "./compaction-pass.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import { createUtilitySlot } from "../memory/utility-slot.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { preparedPublicationFixture } from "../testing/prepared-publication-fixture.ts";
import { streamingMockModel, generatingModel } from "../testing/mock-language-model.ts";
import { openSourceLiveEvidence } from "../testing/source-live-evidence.ts";

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
const INTERLUDE = [
  ["user", "暂时换个话题。介绍一下常见蓝白配色的用法吧，只讨论一般设计知识。"],
  ["assistant", "蓝白配色常见于信息页面和日常用品。可以先用白色提供大面积留白，再用不同明度的蓝色区分层级：深蓝适合标题和主要文字，较浅的蓝色适合背景分区，中等亮度的蓝色可以作为按钮或链接的提示。颜色用得少并不意味着层次少，字号、间距、线条和位置同样能帮助阅读。设计里通常要检查文字与底色的对比度，浅蓝背景上的浅灰字往往难读；如果改成深色文字，可读性就会好很多。蓝白只是一个例子，实际作品仍需根据内容和用途选择，不能只依赖颜色传达重要信息。"],
  ["user", "那暖色搭配和中性色搭配有什么不同？继续比较一般原则就好。"],
  ["assistant", "暖色搭配常用橙、红、黄及其相邻色，视觉上容易形成活跃或温暖的感受；中性色搭配则更多使用黑、白、灰、米色，能让内容和图片成为重点。不过这些感受并不是固定规律，同一种颜色改变明度、饱和度和面积比例，效果可能完全不同。比如大面积高饱和橙色容易抢眼，少量柔和橙色用于重点提示就会更克制。中性色也不等于缺少重点，可以用字重、边框、位置变化形成清楚的阅读顺序。做实际页面时，先确定主要内容，再限制强调色数量，并检查错误、成功、禁用等状态是否有文字或图标作为补充。"],
  ["user", "最后说说检查可读性时可以做哪些基本步骤。"],
  ["assistant", "可以先把页面缩到实际使用尺寸，逐项检查标题、正文、辅助说明和按钮是否清楚，再看相邻区域是否容易区分。接着试着暂时去掉颜色，检查内容能否依靠文字、形状和位置仍然表达同样的含义；这有助于发现只靠红绿颜色区分状态的问题。还可以比较亮背景和暗背景下的效果，确认较细的线条没有消失，浅色文字没有融入底色。最后按用户真实阅读顺序浏览一遍，从主要标题到正文再到操作入口，观察是否有不必要的跳跃。以上是一般设计知识的概括，实际检查还应结合目标设备和读者需求。这个配色与阅读检查的讨论已经回答完整。"],
  ["user", "颜色知识的话题到这里就结束了，不需要继续补充。"],
  ["assistant", "好，这个话题结束了。"],
] as const;

const CapturedRequest = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })) });
function assertSummaryOnlyInput(body: string, scenario: Scenario) {
  const messages = CapturedRequest.parse(JSON.parse(body)).messages;
  const summaries = messages.filter((message) => typeof message.content === "string" && message.content.startsWith("<conversation-summary>"));
  expect(summaries).toHaveLength(1);
  const outside = messages.filter((message) => !summaries.includes(message)).map((message) => JSON.stringify(message.content)).join("\n");
  expect(outside).not.toContain(scenario.question);
  expect(outside).not.toContain("我被裁员了，我的项目也停了");
  expect(outside).not.toContain("搬家那阵子特别累。");
  expect(messages.some((message) => message.role === "user" && message.content === INTERLUDE.at(-2)![1])).toBe(true);
  expect(messages.some((message) => message.role === "assistant" && message.content === INTERLUDE.at(-1)![1])).toBe(true);
}

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

async function runScenario(scenario: Scenario, model: LanguageModel, options: {
  requestedModel: string; checkpoint?: (stage: string, evidence: unknown) => void;
}) {
  const f = await preparedPublicationFixture({ expiresAt: new Date(Date.now() + 600_000).toISOString(), modelId: options.requestedModel });
  const logger = createCaptureLogger().logger;
  const slot = createUtilitySlot({ mainModel: model, logger });
  const summaries = createSummaryRepo(f.db);
  const store = createConversationStore({ repo: f.timeline, summaries });
  const agent = createChatAgent({ model, memory: f.memory, store, effectLifecycle: f.effects, maxSteps: 6 });
  let initial: string | undefined;
  let after: string | undefined;
  let stage = "preparing";
  const evidence = () => ({ id: scenario.id, stage, question: scenario.question, initial, summary: summaries.get("taki"),
    followup: scenario.followup, after, sourceRows: f.timeline.latestAscending("taki", 30), finalReplay: store.history("taki"),
    utilityUsage: slot.usage(), usage: f.db.prepare("SELECT provider,model_id,quality,input_tokens,output_tokens,total_tokens FROM run_usage").all(),
    compaction: f.db.prepare("SELECT state,source_digest,failure_code,selected_from_seq,selected_through_seq FROM conversation_compaction_operations").all(),
    memoryFlush: "unexercised: no canonical witness callbacks installed; test-controlled flush seam",
    primaryWitnessCount: Number(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_primary_commits").get()?.n ?? 0) });
  const checkpoint = (next: string) => { stage = next; options.checkpoint?.(stage, evidence()); };
  try {
    if (scenario.external) {
      f.candidates.set("one", { candidateRef: "one", revision: "r1", text: "我被裁员了，我的项目也停了。", expiresAt: f.accepted.validity.expiresAt,
        sourceContext: { materials: [{ label: "合成访谈视频", speaker: "林述（视频叙述者）", reference: "fixture:interview-lin", time: "10-20 seconds" }] } });
      const publication = await f.owner.publish({ candidateRef: "one", expectedRevision: "r1" });
      expect(publication).toMatchObject({ state: "sent" });
    }
    if (scenario.unknown) f.timeline.append({ characterId: "taki", role: "assistant", content: "搬家那阵子特别累。" });
    checkpoint("initial-started");
    initial = await answer(f, agent, scenario.question);
    checkpoint("initial-completed");
    const mustRetire = f.timeline.latestSeq("taki");
    for (const [role, content] of INTERLUDE) {
      f.timeline.append({ characterId: "taki", role, content });
    }
    const witnesses = Number(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_primary_commits").get()?.n ?? 0);
    expect(witnesses).toBe(0);
    const pass = createCompactionPass({ timeline: f.timeline, summaries, operations: createCompactionOperationRepo(f.db), slot, logger,
      view: { estimatedTokens: () => 1000, budget: () => 100 }, config: { triggerRatio: 0.8, keepMessages: 2, summaryQuality: true, retryBudget: 1 } });
    checkpoint("compaction-started");
    await pass.maybeRun("taki");
    checkpoint("compaction-settled");
    const summary = summaries.get("taki");
    expect(summary?.throughSeq).toBeGreaterThanOrEqual(mustRetire);
    expect(summary?.text.trim()).toBeTruthy();
    expect(store.history("taki").slice(1)).toEqual(INTERLUDE.slice(-2).map(([role, content]) => ({ role, content })));
    checkpoint("followup-started");
    after = await answer(f, agent, scenario.followup);
    checkpoint("completed");
    return evidence();
  } catch (error) {
    options.checkpoint?.("failed", { ...evidence(), failedAt: stage });
    throw error;
  } finally { await slot.stop(); f.cleanup(); }
}

const PATHS = ["packages/core/src/agents/chat-agent.ts", "packages/core/src/agents/base-prompt.ts",
    "packages/core/src/agents/source-context.ts", "packages/core/src/agents/source-interpretation.ts", "packages/core/src/agents/turn-mapping.ts",
    "packages/core/src/agents/context-reduction.ts", "packages/core/src/agents/compaction-pass.ts", "packages/core/src/agents/compaction-coordinator.ts",
    "packages/core/src/agents/conversation-store.ts", "packages/core/src/db/timeline-repo.ts", "packages/core/src/memory/write-convention.ts",
    "packages/core/src/delivery/prepared-publication.ts", "packages/core/src/db/run-delivery-repo.ts", "packages/core/src/agents/source-context-real.test.ts",
    "packages/core/src/testing/prepared-publication-fixture.ts"];

it("exercises all source semantic fixture paths without paying for model calls", async () => {
  for (const scenario of CASES) {
    const model = streamingMockModel(["合成回答保留人物归属。"]);
    model.doGenerate = generatingModel("我们讨论了材料中的人物及用户明确说过的情况。来源不明的旧话没有确定主体。").doGenerate;
    const result = await runScenario(scenario, model, { requestedModel: "scripted" });
    expect(result.compaction).toEqual([expect.objectContaining({ state: "committed" })]);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(result.utilityUsage.calls).toBe(1);
    assertSummaryOnlyInput(JSON.stringify({ messages: model.doStreamCalls[1]!.prompt.map((message) => ({ role: message.role,
      content: typeof message.content === "string" ? message.content : message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("") })) }), scenario);
  }
});

it.skipIf(process.env.TAKI_E2E_REAL_SOURCE_CONTEXT !== "1")("observes three bounded candidate-only real source and post-compaction cases", async () => {
  const requested = process.env.TAKI_E2E_SOURCE_CASES?.split(",");
  if (requested?.some((id) => !CASES.some((scenario) => scenario.id === id))) throw new Error("SOURCE_CASE_SELECTION_INVALID");
  const scenarios = CASES.filter((scenario) => !requested || requested.includes(scenario.id));
  if (!scenarios.length) throw new Error("SOURCE_CASE_SELECTION_EMPTY");
  const campaign = z.enum(["source-semantics", "a3-compaction-fix", "final-prompt-regression"])
    .parse(process.env.TAKI_E2E_SOURCE_CAMPAIGN ?? "source-semantics");
  const repair = campaign === "a3-compaction-fix";
  if (repair && (scenarios.length !== 1 || scenarios[0]!.id !== "a3-mixed-unknown")) throw new Error("SOURCE_REPAIR_CASE_SELECTION_INVALID");
  if (campaign === "final-prompt-regression" && (scenarios.length !== 2 || scenarios.some((scenario) => scenario.id === "a3-mixed-unknown"))) {
    throw new Error("SOURCE_REGRESSION_CASE_SELECTION_INVALID");
  }
  let followup: Scenario | undefined;
  const live = await openSourceLiveEvidence({ maxRequests: repair ? 4 : requested ? 7 : 12, paths: PATHS,
    inspectRequest(request) {
      if (!followup) return;
      assertSummaryOnlyInput(request.body, followup);
      live.save(`${followup.id}-actual-followup-input.json`, { requestNumber: request.requestNumber,
        retiredMaterialOnlyInSummary: true, retainedRecentPair: true });
    } });
  const completed: string[] = [];
  try {
    for (const scenario of scenarios) {
      followup = undefined;
      live.save(`${scenario.id}.json`, await runScenario(scenario, live.model, { requestedModel: live.requestedModel,
        checkpoint: (stage, evidence) => {
          if (stage === "followup-started") followup = scenario;
          live.save(`${scenario.id}-${stage}.json`, evidence);
        } }));
      completed.push(scenario.id);
    }
  } finally {
    await live.close({ completed, candidateOnly: true, sourceAndPlayback: "synthetic accepted source; no actual playback",
      selectedCases: scenarios.map((scenario) => scenario.id), logicalGenerationsLimit: scenarios.length * 3,
      campaign,
      semanticReview: "Review saved outputs; deterministic checks alone do not pass semantics." });
  }
}, 600_000);
