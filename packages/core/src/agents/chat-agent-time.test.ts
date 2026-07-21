import { afterEach, describe, expect, it } from "vitest";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { streamingMockModel } from "../testing/mock-language-model.ts";
import { BASE_SYSTEM_PROMPT } from "./base-prompt.ts";
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

function systemText(model: { doStreamCalls: Array<{ prompt?: Array<{ role: string; content: unknown }> }> }, call: number): string {
  const system = model.doStreamCalls[call]?.prompt?.[0];
  expect(system?.role).toBe("system");
  return String(system?.content);
}

describe("chat-agent time injection (hybrid date/time)", () => {
  it("puts the day-date line immediately after the base prompt and the current-time line last", async () => {
    const f = fresh();
    const model = streamingMockModel(["ok"]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, instructionsExtra: () => "SKILLS" });

    await drain(agent.stream({ characterId: "taki", message: "hi" }));
    const text = systemText(model, 0);

    // Date line sits directly after the base prompt (one blank-line join), before any memory/extra section.
    expect(text).toContain(`${BASE_SYSTEM_PROMPT}\n\nToday is `);
    expect(text).toMatch(/\n\nToday is [A-Z][a-z]+, \d{4}-\d{2}-\d{2}\.\n\n/);

    // Current-time line is the very last section (the volatile tail).
    expect(text).toMatch(/\n\nCurrent local time: \d{2}:\d{2}\.$/);

    // Ordering: base < date < skills(extra) < time.
    expect(text.indexOf("Today is ")).toBeLessThan(text.indexOf("SKILLS"));
    expect(text.indexOf("SKILLS")).toBeLessThan(text.indexOf("Current local time:"));
  });

  it("keeps the day-date line byte-identical across a same-day recomposition (cache-shape)", async () => {
    const f = fresh();
    const model = streamingMockModel(["a", "b"]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory });

    await drain(agent.stream({ characterId: "taki", message: "one" }));
    await drain(agent.stream({ characterId: "taki", message: "two" }));

    const dateLine = (text: string) => text.split("\n\n").find((s) => s.startsWith("Today is "));
    expect(dateLine(systemText(model, 0))).toBe(dateLine(systemText(model, 1)));
  });
});
