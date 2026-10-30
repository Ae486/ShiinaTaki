import { afterEach, expect, it, vi } from "vitest";
import { coWatchingFixture } from "../testing/co-watching-fixture.ts";
import { createChatAgent } from "../agents/chat-agent.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";

const fixtures: Awaited<ReturnType<typeof coWatchingFixture>>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.cleanup(); });
async function fixture() { const result = await coWatchingFixture(); fixtures.push(result); return result; }

it("provides exact task references to ordinary chat without copying private analysis into its history", async () => {
  const f = await fixture(); f.start(); await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  const context = f.runtime.context("taki");
  expect(context).toContain(`co-watching-inputs/${f.session().sessionId}/analysis.json`);
  expect(context).not.toContain("Grounded test analysis");
  expect(f.runtime.context("other")).not.toContain(f.session().sessionId);
  const model = scriptedModel([{ kind: "text", deltas: ["Reply"] }]);
  const agent = createChatAgent({ model, store: f.store, memory: f.memory, instructionsExtra: f.runtime.context });
  for await (const _ of agent.stream({ characterId: "taki", message: "What is this video about?" })) { void _; }
  expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("Current Co-Watching task");
  expect(JSON.stringify(f.store.history("taki"))).not.toContain("Current Co-Watching task");
});

it("makes button Stop and source retirement visible before another model request without resurrecting files", async () => {
  const f = await fixture(); f.start(); await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  f.runtime.stop("taki", f.session().sessionId);
  expect(f.runtime.context("taki")).toContain('"reason":"stopped"');
  expect(f.runtime.context("taki")).toContain("Do not continue its pending reactions");
  expect(f.runtime.context("taki")).not.toContain("/analysis.json");
  expect(f.store.history("taki")).toHaveLength(0);
});

it("yields only owned preparation to a primary reservation and resumes after the conversation releases", async () => {
  const f = await fixture();
  f.generate.mockImplementationOnce(async (_control, signal) => {
    await new Promise<void>((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("interrupted")), { once: true }));
  });
  f.start(); await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(1));
  const reservation = f.queue.reservePrimary("taki"); const release = await reservation.acquire();
  expect(f.session().status).not.toBe("failed");
  expect(f.generate).toHaveBeenCalledTimes(1);
  release(); f.runtime.released();
  await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.readNative).toHaveBeenCalledTimes(1);
});
