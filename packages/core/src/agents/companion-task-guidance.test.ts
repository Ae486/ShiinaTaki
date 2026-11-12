import { afterEach, describe, expect, it } from "vitest";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { InitiativeSelectedContext } from "@taki/shared";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createChatAgent, CANONICAL_MEMORY_SYSTEM_PROMPT, type TurnContext } from "./chat-agent.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
const answer = { kind: "text" as const, deltas: ["Done"] };
const stub = () => tool({ inputSchema: z.object({}), execute: () => ({ ok: true }) });
function fixture(steps = [answer] as Parameters<typeof scriptedModel>[0]) {
  const f = createCompanionFixture(); fixtures.push(f);
  return { f, model: scriptedModel(steps) };
}
async function send(agent: ReturnType<typeof createChatAgent>, turn?: TurnContext) {
  for await (const delta of agent.stream({ characterId: "taki", message: "Help with this task" }, turn)) void delta;
}
function instructions(model: ReturnType<typeof scriptedModel>, step = 0) {
  return model.doStreamCalls[step]?.prompt.filter((message) => message.role === "system").map((message) => message.content).join("\n");
}

describe("Companion guidance at the actual SDK request", () => {
  it("keeps the active Memory procedure and shows only exposed capability guidance", async () => {
    const { f, model } = fixture();
    const extraTools: ToolSet = { delegate_subagent: stub(), schedule_task: stub(), manage_interaction_pattern: stub(),
      plan_follow_up: stub(), arbitrary_mcp_manage_media_recommendations: stub() };
    await send(createChatAgent({ model, store: f.conversation, memory: f.memory,
      memoryPrompt: CANONICAL_MEMORY_SYSTEM_PROMPT, extraTools }));
    const text = instructions(model);
    expect(text).toContain("Helping with a task:");
    expect(text).toContain("later corrections");
    expect(text).toContain("personally ran a tool or performed an action");
    expect(text).toContain("Accepted worker reports supplied by Core are attributed evidence");
    expect(text).toContain("without a duplicate read");
    expect(text).toContain("Delegation:");
    expect(text).toContain("Ending the current reply while asynchronous work is pending does not mean the task is complete");
    expect(text).toContain("without another user message");
    expect(text).toContain("a concrete task need, a relevant user request, or a reported problem");
    expect(text).toContain("Reminders:");
    expect(text).toContain("Interaction habits:");
    expect(text).toContain("Follow-up:");
    expect(text).not.toContain("Recommendations:");
    expect(text).not.toContain("Video intent:");
    expect(text).toContain("run recall");
    expect(text).not.toContain("run memory_search");
    expect(text).toContain("look it up before making a claim");
    expect(text).toContain("If the fact remains unresolved, state the uncertainty");
    expect(text).toContain("that no result exists, or that a result is still pending");
  });

  it("does not give non-primary work the primary task or capability instructions", async () => {
    const { f, model } = fixture();
    await send(createChatAgent({ model, store: f.conversation, memory: f.memory,
      extraTools: { delegate_subagent: stub(), schedule_task: stub() } }), { turnKind: "non-primary", controlInput: "Private inbox work" });
    expect(instructions(model)).not.toContain("Helping with a task:");
    expect(instructions(model)).not.toContain("Delegation:");
    expect(instructions(model)).not.toContain("Reminders:");
    expect(f.conversation.history("taki")).toEqual([]);
  });

  it("keeps selected initiative instructions and restricted tools separate from Companion work", async () => {
    const { f, model } = fixture();
    const selectedContext: InitiativeSelectedContext = { instructions: "SELECTED_INITIATIVE", controlInput: "Consider this opportunity",
      candidateIds: ["one"], allowedToolNames: [], manifest: { version: "initiative-context.v1", profile: "initiative-thin",
        capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), policyRevision: "test",
        primaryVersion: 0, timezoneRevision: 1, accountingQuality: "unknown", sources: [] } };
    await send(createChatAgent({ model, store: f.conversation, memory: f.memory,
      extraTools: { delegate_subagent: stub(), heartbeat_respond: stub() } }),
    { turnKind: "non-primary", runContext: { selectedContext } });
    expect(instructions(model)).toContain("SELECTED_INITIATIVE");
    expect(instructions(model)).toContain("Ordinary text is private reasoning output and is not delivered");
    expect(instructions(model)).not.toContain("Helping with a task:");
    expect(model.doStreamCalls[0]?.tools?.map((item) => item.name)).toEqual(["heartbeat_respond"]);
  });

  it("adds a feature's guidance only after successful Skill disclosure, never for an excluded sibling", async () => {
    const { f, model } = fixture([{ kind: "tool", toolCallId: "load", toolName: "load_skill", input: { name: "video" } }, answer]);
    const loaded = { ok: true, content: "Video instructions", contentRevision: "revision-1" };
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory,
      extraTools: { load_skill: tool({ inputSchema: z.object({ name: z.string() }), execute: () => loaded }) },
      skillTools: () => [{ skillName: "video", tools: { manage_co_watching: stub(), manage_media_recommendations: stub() } }],
      runContext: () => ({ toolDisclosure: { deferredToolNames: [], describedTools: {},
        skills: { video: { extensionId: "video-extension", contentRevision: "revision-1" } } },
      tools: { extension_call: tool({ inputSchema: z.object({ extensionId: z.string(), input: z.unknown() }),
        execute: () => ({ ok: true, owner: { extensionId: "video-extension" }, output: loaded }) }) } }),
    });
    await send(agent, { allowedToolNames: ["load_skill", "manage_co_watching"] });
    expect(instructions(model, 0)).toContain("Capability discovery:");
    expect(instructions(model, 0)).not.toContain("Video intent:");
    expect(instructions(model, 1)).toContain("Video intent:");
    expect(instructions(model, 1)).not.toContain("Recommendations:");
    expect(model.doStreamCalls[0]?.tools?.map((item) => item.name)).toEqual(["load_skill"]);
    expect(model.doStreamCalls[1]?.tools?.map((item) => item.name)).toEqual(["load_skill", "manage_co_watching"]);
  });
});
