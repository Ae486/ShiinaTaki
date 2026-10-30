import { afterEach, describe, expect, it, vi } from "vitest";
import { createUserTimezoneRepo } from "../db/user-timezone-repo.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { streamingMockModel } from "../testing/mock-language-model.ts";
import { createUserTimezoneService } from "../time/user-timezone-service.ts";
import { BASE_SYSTEM_PROMPT } from "./base-prompt.ts";
import { createChatAgent } from "./chat-agent.ts";

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) f.cleanup();
});

function userTimezone(fixture: CompanionFixture) {
  return createUserTimezoneService({
    db: fixture.db,
    repo: createUserTimezoneRepo(fixture.db),
    schedules: { recomputeUserTimezone: () => undefined },
    isOperatorDevice: () => true,
    logger: { warn: vi.fn() },
  });
}

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const delta of stream) text += delta;
  return text;
}

type PromptMessage = { role: string; content: unknown };
type MockWithCalls = { doStreamCalls: Array<{ prompt?: PromptMessage[] }> };

function systemText(model: MockWithCalls, call: number): string {
  const system = model.doStreamCalls[call]?.prompt?.[0];
  expect(system?.role).toBe("system");
  return String(system?.content);
}

// The raw text of the LAST user message the model saw (provider-level user content is text parts; join them).
function lastUserText(model: MockWithCalls, call: number): string {
  const prompt = model.doStreamCalls[call]?.prompt ?? [];
  const last = [...prompt].reverse().find((m) => m.role === "user");
  const content = last?.content;
  if (typeof content === "string") return content;
  const parts = (Array.isArray(content) ? content : []) as Array<{ type?: string; text?: unknown }>;
  return parts.map((part) => (part.type === "text" ? String(part.text) : "")).join("");
}

describe("chat-agent time injection (Q4: day line in instructions, time line in the tail)", () => {
  it("uses persisted User Timezone for the provider's day and time instead of the Core host zone", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-28T10:40:45.678Z"));
    const f = fresh();
    const timezone = userTimezone(f);
    expect(timezone.timezone()).toBe("UTC");
    const readTimezone = vi.fn(timezone.timezone);
    const model = streamingMockModel(["ok"]);
    const deps = { model, store: f.conversation, memory: f.memory, userTimezone: readTimezone };
    const agent = createChatAgent(deps);

    await drain(agent.stream({ characterId: "taki", message: "What time is it?" }));

    expect(systemText(model, 0)).toContain("Today is Monday, 2026-09-28.");
    expect(lastUserText(model, 0)).toContain("Current local time: 10:40.");
    expect(systemText(model, 0)).toContain("User timezone: UTC.");
    expect(readTimezone).toHaveBeenCalledOnce();
  });

  it("captures one zone across awaited recall and reads a committed zone change on the next turn", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-28T00:30:00.000Z"));
    const f = fresh();
    const timezone = userTimezone(f);
    const operator = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(timezone.update({ expectedRevision: 1, mode: "fixed", timezone: "America/New_York" }, operator).status).toBe("accepted");
    const readTimezone = vi.fn(timezone.timezone);
    const model = streamingMockModel(["ok"]);
    const recall = vi.fn(async () => {
      if (timezone.timezone() !== "UTC") {
        expect(timezone.update({ expectedRevision: 2, mode: "fixed", timezone: "UTC" }, operator).status).toBe("accepted");
      }
      return "";
    });
    const deps = { model, store: f.conversation, memory: f.memory, userTimezone: readTimezone,
      runContext: () => ({ automaticMemoryRecall: recall }) };
    const agent = createChatAgent(deps);

    await drain(agent.stream({ characterId: "taki", message: "first" }));
    expect(systemText(model, 0)).toContain("Today is Sunday, 2026-09-27.");
    expect(systemText(model, 0)).toContain("User timezone: America/New_York.");
    expect(lastUserText(model, 0)).toContain("Current local time: 20:30.");
    expect(readTimezone).toHaveBeenCalledOnce();

    await drain(agent.stream({ characterId: "taki", message: "second" }));
    expect(systemText(model, 1)).toContain("Today is Monday, 2026-09-28.");
    expect(systemText(model, 1)).toContain("User timezone: UTC.");
    expect(lastUserText(model, 1)).toContain("Current local time: 00:30.");
    expect(readTimezone).toHaveBeenCalledTimes(2);
  });

  it("keeps the day-date line after the base prompt and moves the time line into the turn-context tail", async () => {
    const f = fresh();
    const model = streamingMockModel(["ok"]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, instructionsExtra: () => "SKILLS" });

    await drain(agent.stream({ characterId: "taki", message: "hi" }));
    const text = systemText(model, 0);

    // Date line sits directly after the base prompt (one blank-line join), before any memory/extra section.
    expect(text).toContain(`${BASE_SYSTEM_PROMPT}\n\nToday is `);
    expect(text).toMatch(/\n\nToday is [A-Z][a-z]+, \d{4}-\d{2}-\d{2}\.\n\n/);
    expect(text.search(/\n\nToday is [A-Z][a-z]+, \d{4}-\d{2}-\d{2}\.\n\n/)).toBeLessThan(text.indexOf("SKILLS"));

    // No RENDERED time line anywhere in the instructions (the base prompt still QUOTES the "Current local time: ..."
    // prefix to teach where it arrives, so the assertion pins the rendered form, not the phrase).
    expect(text).not.toMatch(/Current local time: \d{2}:\d{2}\./);

    // The time line now rides the outgoing user message — the first line inside the turn-context tail (Q4).
    expect(lastUserText(model, 0)).toMatch(/\n\n<turn-context>\nCurrent local time: \d{2}:\d{2}\.\n<\/turn-context>$/);
  });

  it("keeps the ENTIRE instructions byte-identical across a same-day recomposition (Q4 cache shape)", async () => {
    const f = fresh();
    const model = streamingMockModel(["a", "b"]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory });

    await drain(agent.stream({ characterId: "taki", message: "one" }));
    await drain(agent.stream({ characterId: "taki", message: "two" }));

    // Strengthened from the day-line-only pin (pre-Q4): with the volatile set gone the whole instructions string is
    // the stable prefix — byte-identity across same-day turns IS the acceptance property (no memory writes between).
    expect(systemText(model, 1)).toBe(systemText(model, 0));
  });
});
