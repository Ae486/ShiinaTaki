import { describe, expect, it } from "vitest";
import { realProviderEnv } from "./fixture/paths.ts";
import { withStack } from "./fixture/with-stack.ts";

const hasKey = realProviderEnv() !== null;

// The flagship post-R6 scenario (batch 5 design §5): the user's name exists ONLY in the memory store — the visible
// timeline never contained it (the faithful equivalent of "200 turns pushed it out"). With per-turn retrieval gone
// (R6), the only road to the right answer is the agent's own memory_search. RED protocol executed 2026-07-31: the
// pre-overhaul run came back GREEN (3 consecutive runs — the tool description + the question's direct match on the
// disclosure vocabulary already carried it), so this flagship documents RETENTION of the recall path across the 5b
// prompt overhaul, not a delta; it guards the post-R6 world where losing the search means losing the answer.
const SEEDED_NAME = "洛雨棠";

// FACT vocabulary in the content, QUESTION vocabulary in the disclosure — the T5-R12(b) bridge the index rides.
const NAME_MEMORY = {
  characterId: "taki",
  layer: "episodes",
  id: "0001-用户的名字",
  content: `用户告诉过我他叫${SEEDED_NAME}。`,
  importance: 6,
  disclosure: "当用户问自己是谁或叫什么名字时",
  created: "2026-07-20T10:00:00.000Z",
};

// ~10 filler turns with ZERO mention of the name: real history rides the live call (cost-conscious), and none of it
// can answer the question — so a correct reply cannot come from the transcript.
const FILLER_TIMELINE = [
  { role: "user" as const, content: "今天下午有点困，代码写不动了。" },
  { role: "assistant" as const, content: "那就先起来活动一下，泡杯咖啡再回来。" },
  { role: "user" as const, content: "晚饭想吃拉面还是咖喱?" },
  { role: "assistant" as const, content: "拉面吧，天热的时候来一碗豚骨也不错。" },
  { role: "user" as const, content: "周末打算去公园走走。" },
  { role: "assistant" as const, content: "好主意，记得带水。" },
  { role: "user" as const, content: "最近在听一张新专辑，还挺好听的。" },
  { role: "assistant" as const, content: "听起来不错，写代码的时候放着正合适。" },
  { role: "user" as const, content: "显示器有点闪，可能要换了。" },
  { role: "assistant" as const, content: "先检查一下线材，说不定不用花钱。" },
];

describe("L2 — flagship name recall (post-R6: memory_search is the only road to the answer)", () => {
  it.skipIf(!hasKey)("recalls the user's name from memory via memory_search, not the transcript", async () => {
    await withStack(
      { provider: "real", seedTimeline: FILLER_TIMELINE, seedMemory: [NAME_MEMORY] },
      async (stack) => {
        // The live turn gives zero hint to search — the prompt's own triggers must fire.
        const turn = await stack.agentSay("我叫什么名字?", 150_000);

        const persisted = await stack.timeline();
        const toolNames = persisted
          .filter((entry) => entry.role === "tool")
          .flatMap((entry) => (entry.parts ?? []).map((part) => ("toolName" in part ? part.toolName : "")));
        // Booleans/counts/roles only — never conversation content (no-content-in-logs invariant).
        const evidence = {
          turnStatus: turn.status,
          turnError: turn.errorMessage,
          replyContainsSeededName: turn.text.includes(SEEDED_NAME),
          memorySearchToolRows: toolNames.filter((name) => name === "memory_search").length,
          persistedRoles: persisted.map((entry) => entry.role),
        };
        console.log("[L2 name-recall evidence]", JSON.stringify(evidence, null, 2));

        expect(turn.status).toBe("complete");
        // The retrieval proof: the persisted turn carries a memory_search tool row (retrieval-driven, not luck).
        expect(evidence.memorySearchToolRows).toBeGreaterThanOrEqual(1);
        // The recall proof: the reply states the seeded name, which never appeared in the timeline.
        expect(evidence.replyContainsSeededName).toBe(true);
      },
    );
  }, 180_000);
});
