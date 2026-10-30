import { afterEach, describe, expect, it } from "vitest";
import { createAvatarOutcomes, type AvatarOutcomes } from "../avatar/avatar-outcomes.ts";
import { createAvatarSubscriptions, type AvatarSubscriptions } from "../avatar/avatar-subscriptions.ts";
import { createAvatarTools } from "../avatar/avatar-tools.ts";
import { presentationTailStop } from "../avatar/presentation-stop.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel, type ScriptStep } from "../testing/mock-language-model.ts";
import { createChatAgent } from "./chat-agent.ts";

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const delta of stream) text += delta;
  return text;
}

const VOCAB = { motions: ["wave"], expressions: ["default", "smile"] };

// Per-turn avatar tools bound to the turn's characterId (mirrors main.ts wiring). With no subscriber the outcome is
// not_rendered instantly; a test may inject one subscriber + its own outcomes registry to script a rejection.
function avatarTools(deps: { subscriptions?: AvatarSubscriptions; outcomes?: AvatarOutcomes } = {}) {
  const { logger } = createCaptureLogger();
  const subscriptions = deps.subscriptions ?? createAvatarSubscriptions();
  const outcomes = deps.outcomes ?? createAvatarOutcomes({ deadlineMs: () => 1000 });
  return (characterId: string) => createAvatarTools({ subscriptions, outcomes, characterId, logger, vocab: VOCAB });
}

async function run(steps: ScriptStep[], tools = avatarTools()) {
  const f = fresh();
  const model = scriptedModel(steps);
  const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, characterTools: tools, stopConditions: [presentationTailStop] });
  const streamed = await drain(agent.stream({ characterId: "taki", message: "在吗" }));
  return { f, model, streamed };
}

const expression = (toolCallId: string, name: string) => ({ toolCallId, toolName: "avatar_set_expression", input: { name } });

describe("chat-agent presentation tail-stop (1c)", () => {
  it("stops after a spoken presentation-only step — the forced filler generation never runs or persists", async () => {
    // Step 0 speaks AND sets an expression in one step (finishReason tool-calls). Without a stop condition the SDK
    // would force step 1, where the model pads a filler "嗯。" and drifts from its own last line.
    const { f, model, streamed } = await run([
      { kind: "textTool", deltas: ["你好呀！"], ...expression("c1", "default") },
      { kind: "text", deltas: ["嗯。"] },
    ]);

    // The loop stopped after step 0: the second generation never happened, so only the greeting was streamed.
    expect(model.doStreamCalls).toHaveLength(1);
    expect(streamed).toBe("你好呀！");

    // The persisted turn holds the spoken text + the tool call, but never the filler segment.
    const persisted = JSON.stringify(f.conversation.history("taki"));
    expect(persisted).toContain("你好呀！");
    expect(persisted).toContain("avatar_set_expression");
    expect(persisted).not.toContain("嗯。");
  });
});

describe("chat-agent one-correction rule for invalid presentation calls (D69)", () => {
  it("text + invalid avatar call → the SDK re-calls the model once so it reads the validation error", async () => {
    const { model, streamed } = await run([
      { kind: "textTool", deltas: ["你好呀！"], ...expression("c1", "not_in_vocab") },
      { kind: "tool", ...expression("c2", "smile") },
      { kind: "text", deltas: ["(never)"] },
    ]);
    // Request 2 carries the corrected call; its valid outcome then stops the loop (a third request never happens).
    expect(model.doStreamCalls).toHaveLength(2);
    expect(streamed).toBe("你好呀！");
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("AI_InvalidToolInputError");
  });

  it("two consecutive invalid avatar steps → stop after the second (no third request)", async () => {
    const { model } = await run([
      { kind: "textTool", deltas: ["你好呀！"], ...expression("c1", "not_in_vocab") },
      { kind: "tool", ...expression("c2", "still_wrong") },
      { kind: "text", deltas: ["(never)"] },
    ]);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("no text + invalid call → no stop (unchanged express-first behaviour): the reply still comes", async () => {
    const { model, streamed } = await run([
      { kind: "tool", ...expression("c1", "not_in_vocab") },
      { kind: "text", deltas: ["现在说话"] },
    ]);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(streamed).toBe("现在说话");
  });

  it("valid call with a rejected outcome → stop (a rejection is never a reason to re-generate)", async () => {
    const subscriptions = createAvatarSubscriptions();
    const outcomes = createAvatarOutcomes({ deadlineMs: () => 1000 });
    const pet = { state: { status: "awaiting" as const } };
    subscriptions.subscribe("taki", pet, (command) => {
      queueMicrotask(() => outcomes.report(command.commandId, { connection: pet, outcome: "rejected", reason: "motion_busy" }));
    });
    const { f, model } = await run([
      { kind: "textTool", deltas: ["你好呀！"], ...expression("c1", "smile") },
      { kind: "text", deltas: ["(never)"] },
    ], avatarTools({ subscriptions, outcomes }));
    expect(model.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(f.conversation.history("taki"))).toContain("AVATAR_REJECTED");
  });
});
