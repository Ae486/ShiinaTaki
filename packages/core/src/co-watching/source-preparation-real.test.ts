import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { expect, it, vi } from "vitest";
import { CoWatchingPlanSchema } from "@taki/shared";
import { coWatchingFixture } from "../testing/co-watching-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { openSourceLiveEvidence } from "../testing/source-live-evidence.ts";

const PATHS = ["packages/core/src/co-watching/source-preparation-real.test.ts", "packages/core/src/co-watching/child-adapter.ts",
  "packages/core/src/co-watching/task-workspace.ts", "packages/core/src/testing/co-watching-fixture.ts",
  "packages/core/src/testing/co-watching-tool-fixture.ts", "packages/core/src/agents/chat-agent.ts",
  "packages/core/src/harness/subagent-service.ts", "packages/core/src/harness/subagent-execution.ts",
  "packages/core/src/agents/source-context.ts", "packages/core/src/agents/source-interpretation.ts",
  "packages/core/src/skills/skills-loader.ts", "packages/core/src/workspace/read-file-tool.ts", "packages/core/src/workspace/write-file-tool.ts",
  "packages/core/src/governance/core-tool-governance-adapter.ts", "integrations/taki-co-watching/SKILL.md"];

function scriptedPreparationModel() {
  let stage = 0;
  return new MockLanguageModelV4({ doStream: async (options) => {
    const prompt = options.prompt.flatMap((message) => typeof message.content === "string" ? [message.content]
      : message.content.flatMap((part) => part.type === "text" ? [part.text] : [])).join("\n");
    const output = /to (co-watching\/[^\s]+\.json) with revision ([0-9a-f-]+)/.exec(prompt)!;
    const analysis = /Read (co-watching-inputs\/[^\s]+\/analysis\.json)/.exec(prompt)!;
    const steps = [
      { kind: "tool" as const, toolCallId: "load", toolName: "load_skill", input: { name: "taki-co-watching" } },
      { kind: "tool" as const, toolCallId: "read", toolName: "read_file", input: { path: analysis[1] } },
      { kind: "tool" as const, toolCallId: "write", toolName: "write_file", input: { path: output[1], content: JSON.stringify({ revision: output[2],
        candidates: [{ candidateRef: "narrator", momentId: "first", text: "视频里林述的遭遇真不容易。" }] }) } },
      { kind: "text" as const, deltas: ["准备好了。"] },
    ];
    return scriptedModel([steps[stage++]!]).doStream(options);
  } });
}

async function runPreparation(model: LanguageModel, options: {
  modelId: string; provider?: string; save?: (name: string, value: unknown) => void;
}) {
  const f = await coWatchingFixture({ preparation: { model, modelId: options.modelId, provider: options.provider } });
  f.raw.structuredContent.result.analysis.markdown = "合成访谈：讲述者林述说自己被裁员、自己的项目停了；后来决定重新学习并开始下一段生活。";
  f.raw.structuredContent.result.analysis.moments[0]!.content = "林述（视频讲述者）说：我被裁员了，我的项目也停了。";
  f.raw.structuredContent.result.analysis.moments[1]!.content = "林述整理资料，决定重新学习。视频没有说明观看者的工作或经历。";
  let stage = "starting";
  const evidence = () => ({ stage, session: f.runtime.read("taki").session, skillRevision: f.skillRevision,
    privateMessages: f.db.prepare("SELECT role,content,parts_json,source_context_json FROM run_messages ORDER BY seq").all(),
    executions: f.session()?.subagentId ? f.executions!.list({ subagentId: f.session().subagentId! }) : [],
    timeline: f.timeline.latestAscending("taki", 20), errors: f.errors,
    effects: f.db.prepare("SELECT kind,state,outcome,source_ref_json,error_code FROM run_effects").all(),
    usage: f.db.prepare("SELECT provider,model_id,quality,input_tokens,output_tokens,total_tokens FROM run_usage").all(),
    directMockArtifactWrites: f.generate.mock.calls.length });
  try {
    f.start();
    await vi.waitFor(() => expect(["ready", "failed", "stopped"]).toContain(f.session().status), { timeout: 240_000, interval: 50 });
    stage = "preparation-settled"; options.save?.(`${stage}.json`, evidence());
    expect(f.session().status).toBe("ready"); expect(f.errors).toEqual([]); expect(f.generate).not.toHaveBeenCalled();
    const current = f.subagents.summary(f.session().subagentId!);
    const result = f.subagents.result({ characterId: "taki", completionId: current.latestCompletionId! }).result;
    expect(result.child).toMatchObject({ outcome: "completed", outputKind: "validated" });
    const artifact = result.child.artifact!;
    const plan = CoWatchingPlanSchema.parse(JSON.parse(readFileSync(join(f.workspaceRoot, artifact.reference), "utf8")));
    options.save?.("artifact.json", plan);
    expect(plan.revision).toBe(artifact.revision);
    expect(plan.candidates.length).toBeGreaterThan(0);
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    const privateRows = f.messages.history({ subagentId: current.subagentId });
    const completedTools = privateRows.flatMap((row) => row.parts ?? []).flatMap((part) => part.type === "tool-result" ? [part.toolName] : []);
    expect(completedTools).toEqual(expect.arrayContaining(["load_skill", "read_file", "write_file"]));
    const first = [...plan.candidates].sort((left, right) => {
      const moments = f.raw.structuredContent.result.analysis.moments;
      return moments.find((item) => item.moment_id === left.momentId)!.at_seconds - moments.find((item) => item.moment_id === right.momentId)!.at_seconds;
    })[0]!;
    const moment = f.raw.structuredContent.result.analysis.moments.find((item) => item.moment_id === first.momentId)!;
    f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = moment.at_seconds + 1; f.runtime.playbackChanged();
    await vi.waitFor(() => expect(f.session().sentCount).toBeGreaterThan(0));
    const speech = f.timeline.latestAscending("taki", 10)[0]!;
    const original = f.db.prepare("SELECT run_id FROM runs WHERE trigger_request_id=:id").get({ id: f.input.requestId })!;
    const delivery = f.db.prepare("SELECT r.parent_run_id FROM run_deliveries d JOIN runs r ON r.run_id=d.run_id WHERE d.timeline_seq=:seq").get({ seq: speech.seq });
    expect(delivery?.parent_run_id).toBe(original.run_id); expect(original.run_id).not.toBe(result.child.runId);
    expect(speech.sourceContext?.generatedBy?.runId).toBe(result.child.runId);
    expect(JSON.stringify(speech.sourceContext)).toContain(`moment ${first.momentId}`);
    stage = "completed";
    return { ...evidence(), plan, originalRootRunId: original.run_id, publicationParentRunId: delivery?.parent_run_id };
  } catch (error) {
    options.save?.("failure.json", evidence());
    throw error;
  } finally { await f.cleanup(); }
}

it("loads the actual Skill and executes governed file tools through the shared child without direct fixture writes", async () => {
  const model = scriptedPreparationModel();
  const result = await runPreparation(model, { modelId: "scripted" });
  expect(model.doStreamCalls).toHaveLength(4);
  expect(model.doStreamCalls[0]!.tools!.every((entry) => entry.type !== "function" || entry.inputSchema.type === "object")).toBe(true);
  expect(result.directMockArtifactWrites).toBe(0);
  expect(result.skillRevision).toMatch(/^sha256\./);
});

it.skipIf(process.env.TAKI_E2E_REAL_SOURCE_PREPARATION !== "1")("observes one real shared-child Skill/file plan and original-root publication", async () => {
  const live = await openSourceLiveEvidence({ maxRequests: 8, paths: PATHS, deadlineMs: 260_000 });
  let completed = false;
  try {
    live.save("result.json", await runPreparation(live.model, { modelId: live.requestedModel, provider: live.provider, save: live.save }));
    completed = true;
  } finally { await live.close({ completed, maxModelSteps: 6, nativeAnalysisAndPlayback: "isolated synthetic producers",
    modelSkillFileTools: "real", semanticReview: "Review candidate wording separately; transport acceptance is not owner acceptance." }); }
}, 300_000);
