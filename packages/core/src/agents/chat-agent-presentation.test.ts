import { afterEach, describe, expect, it } from "vitest";
import { createAvatarSubscriptions } from "../avatar/avatar-subscriptions.ts";
import { createAvatarTools } from "../avatar/avatar-tools.ts";
import { presentationTailStop } from "../avatar/presentation-stop.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
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

// Per-turn avatar tools bound to the turn's characterId (mirrors main.ts wiring); no subscriber → publish is a no-op.
function avatarTools(): (characterId: string) => ReturnType<typeof createAvatarTools> {
  const { logger } = createCaptureLogger();
  const subscriptions = createAvatarSubscriptions();
  return (characterId) => createAvatarTools({ subscriptions, characterId, logger });
}

describe("chat-agent presentation tail-stop (1c)", () => {
  it("stops after a spoken presentation-only step — the forced filler generation never runs or persists", async () => {
    const f = fresh();
    // Step 0 speaks AND sets an expression in one step (finishReason tool-calls). Without a stop condition the SDK
    // would force step 1, where the model pads a filler "嗯。" and drifts from its own last line.
    const model = scriptedModel([
      { kind: "textTool", deltas: ["你好呀！"], toolCallId: "c1", toolName: "avatar_set_expression", input: { name: "default" } },
      { kind: "text", deltas: ["嗯。"] },
    ]);
    const agent = createChatAgent({
      model,
      store: f.conversation,
      memory: f.memory,
      characterTools: avatarTools(),
      stopConditions: [presentationTailStop],
    });

    const streamed = await drain(agent.stream({ characterId: "taki", message: "在吗" }));

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
