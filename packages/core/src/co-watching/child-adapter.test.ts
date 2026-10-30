import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { coWatchingFixture } from "../testing/co-watching-fixture.ts";
import { createConversationStore } from "../agents/conversation-store.ts";

const fixtures: Awaited<ReturnType<typeof coWatchingFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); });
it("retains a committed shared-child plan before publishing from the accepted root", async () => {
  const f = await coWatchingFixture(); fixtures.push(f); f.start();
  await vi.waitFor(() => expect(f.session().status).not.toBe("starting"));
  await vi.waitFor(() => expect(["ready", "failed"]).toContain(f.session().status));
  expect(f.errors).toEqual([]);
  expect(f.session().status).toBe("ready");
  const view = f.session(); expect(view.subagentId).toBeDefined(); expect(view.workInputId).toBeDefined();
  const current = f.subagents.summary(view.subagentId!);
  const result = f.subagents.result({ characterId: "taki", completionId: current.latestCompletionId! }).result;
  expect(result.child).toMatchObject({ outcome: "completed", outputKind: "validated", workInputId: view.workInputId });
  expect(result.completionState).toBe("not_requested");
  expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
  expect(f.messages.history({ subagentId: view.subagentId! }).length).toBeGreaterThan(0);
  f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = 12; f.runtime.playbackChanged();
  await vi.waitFor(() => expect(f.session().sentCount).toBe(1));
  const speech = f.timeline.latestAscending("taki", 10)[0]!;
  expect(speech.sourceContext).toMatchObject({ generatedBy: { runId: result.child.runId, attemptId: result.child.attemptId },
    materials: [{ label: "Fixture video", time: "10-20 seconds; moment first" }] });
  const root = f.db.prepare("SELECT run_id FROM runs WHERE trigger_request_id=:request").get({ request: f.input.requestId })!;
  const delivery = f.db.prepare("SELECT r.parent_run_id FROM run_deliveries d JOIN runs r ON r.run_id=d.run_id WHERE d.timeline_seq=:seq").get({ seq: speech.seq });
  expect(delivery?.parent_run_id).toBe(root.run_id); expect(root.run_id).not.toBe(result.child.runId);
  f.runtime.stop("taki", view.sessionId);
  await rename(join(f.workspaceRoot, "co-watching-inputs"), join(f.workspaceRoot, "retired-inputs"));
  await rename(join(f.workspaceRoot, "co-watching"), join(f.workspaceRoot, "retired-artifacts"));
  const replay = createConversationStore({ repo: f.timeline }).history("taki");
  expect(JSON.stringify(replay)).toContain("Fixture video"); expect(JSON.stringify(replay)).toContain("moment first");
  expect(replay[0]?.role).toBe("assistant");
});

it("keeps a user-stopped child paused through owner revisions until exact user continuation", async () => {
  const f = await coWatchingFixture(); fixtures.push(f); f.start();
  await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  const view = f.session(); const current = f.subagents.summary(view.subagentId!);
  f.subagents.stop({ characterId: "taki", target: { subagentId: view.subagentId!, workInputId: view.workInputId!,
    expectedRunId: current.activeRunId, expectedControlVersion: current.controlVersion } }, "user");
  await vi.waitFor(() => expect(f.session().status).toBe("paused_child"));
  f.runtime.revise({ characterId: "taki", sessionId: view.sessionId, instruction: "Keep it brief" });
  f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = 12; f.runtime.playbackChanged(); f.runtime.released();
  await new Promise((resolve) => setImmediate(resolve));
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.send).not.toHaveBeenCalled();
  const stopped = f.subagents.summary(view.subagentId!); expect(stopped.stopOrigin).toBe("user");
  f.subagents.continue({ characterId: "taki", target: { subagentId: view.subagentId!, workInputId: view.workInputId!,
    expectedRunId: stopped.activeRunId, expectedControlVersion: stopped.controlVersion },
    operationKey: randomUUID(), direction: "Continue this accepted plan", materials: [] }, { kind: "user" });
  await vi.waitFor(() => expect(f.session().sentCount).toBe(1));
  expect(f.generate).toHaveBeenCalledTimes(2);
  const artifacts = f.executions!.list({ subagentId: view.subagentId! }).map((execution) => execution.result?.artifact?.reference);
  expect(new Set(artifacts).size).toBe(2); expect(f.errors).toEqual([]);
});

it("yields shared child execution to foreground and resumes with a fresh Run artifact", async () => {
  const f = await coWatchingFixture(); fixtures.push(f);
  const original = f.generate.getMockImplementation()!; let finish!: () => void;
  f.generate.mockImplementationOnce(async (control, signal) => {
    await new Promise<void>((resolve) => { finish = resolve; }); await original(control, signal);
  });
  f.start(); await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(1));
  const reservation = f.queue.reservePrimary("taki"); finish();
  const release = await reservation.acquire();
  const view = f.session(); const child = f.subagents.summary(view.subagentId!);
  expect(child.stopOrigin).toBeNull(); expect(f.generate).toHaveBeenCalledTimes(1);
  release(); f.runtime.released();
  await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  expect(f.generate).toHaveBeenCalledTimes(2);
  const revisions = f.generate.mock.calls.map(([control]) => /with revision ([0-9a-f-]+)/.exec(control)?.[1]);
  expect(new Set(revisions).size).toBe(2);
  expect(f.executions!.list({ subagentId: view.subagentId! }).map((execution) => execution.result?.outcome).sort()).toEqual(["cancelled", "completed"]);
});
