import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { coWatchingFixture } from "../testing/co-watching-fixture.ts";

const fixtures: Awaited<ReturnType<typeof coWatchingFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); });
async function fixture() { const f = await coWatchingFixture(); fixtures.push(f); return f; }
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("explicit Co-Watching runtime", () => {
  it("prepares once, publishes real Timeline rows at two anchors and never replays after rewind", async () => {
    const f = await fixture();
    expect(f.start()).toMatchObject({ accepted: true });
    expect(f.start()).toMatchObject({ accepted: true });
    expect(f.runtime.start({ ...f.input, requestId: randomUUID() }, f.interactive)).toEqual({ accepted: false, reason: "already_active" });
    await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    expect(f.readNative).toHaveBeenCalledTimes(1); expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(0);
    f.playback.sample.positionSeconds = 12; f.runtime.playbackChanged(); await flush();
    expect(f.send).not.toHaveBeenCalled();
    f.playback.sample.state = "playing"; f.runtime.playbackChanged();
    await vi.waitFor(() => expect(f.session().sentCount).toBe(1));
    f.playback.sample.positionSeconds = 32; f.runtime.playbackChanged();
    await vi.waitFor(() => expect(f.session().sentCount).toBe(2));
    f.playback.sample.positionSeconds = 12; f.runtime.playbackChanged(); await flush();
    expect(f.send).toHaveBeenCalledTimes(2); expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.timeline.latestAscending("taki", 10).map((row) => row.content)).toEqual(["First response", "Second response"]);
    expect(f.runtime.stop("taki", f.session().sessionId)).toMatchObject({ accepted: true, session: { status: "stopped" } });
  });

  it.each(["source", "native", "skill"] as const)("closes accepted output on %s authority loss", async (kind) => {
    const f = await fixture(); f.start(); await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    f.flags[kind] = false; f.runtime.playbackChanged();
    await vi.waitFor(() => expect(["stopped", "failed"]).toContain(f.session().status));
    f.flags[kind] = true; f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = 12;
    f.runtime.playbackChanged(); await flush(); expect(f.send).not.toHaveBeenCalled();
  });

  it("closes publication before revision acknowledgement and waits for foreground release", async () => {
    const f = await fixture(); f.start(); await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    const foreground = f.queue.reservePrimary("taki"); const release = await foreground.acquire();
    f.plans[0]!.text = "Revised response";
    expect(f.runtime.revise({ characterId: "taki", sessionId: f.session().sessionId, instruction: "Be brief" })).toMatchObject({ accepted: true });
    f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = 12; f.runtime.playbackChanged(); await flush();
    expect(f.send).not.toHaveBeenCalled(); expect(f.generate).toHaveBeenCalledTimes(1);
    release(); f.runtime.released();
    await vi.waitFor(() => expect(f.session().sentCount).toBe(1));
    expect(f.timeline.latestAscending("taki", 10)[0]?.content).toBe("Revised response");
    expect(f.readNative).toHaveBeenCalledTimes(1);
  });

  it("rejects a renamed committed moment after unknown transport instead of replaying it", async () => {
    const f = await fixture(); f.start(); await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    // The fixture's real coordinator closes output on unknown transport, without confirming a sent count.
    f.send.mockResolvedValue("unknown"); f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = 12;
    f.runtime.playbackChanged(); await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    expect(f.session().sentCount).toBe(0); f.plans[0]!.candidateRef = "renamed";
    f.runtime.revise({ characterId: "taki", sessionId: f.session().sessionId, instruction: "Rewrite" });
    await vi.waitFor(() => expect(f.session()).toMatchObject({ status: "failed", reason: "plan_invalid" }));
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("retires a delayed proposal after Stop and settles its root", async () => {
    const f = await fixture(); let release!: () => void;
    const original = f.generate.getMockImplementation()!;
    f.generate.mockImplementationOnce(async (control) => { await new Promise<void>((resolve) => { release = resolve; }); await original(control); });
    f.start(); await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(1));
    f.runtime.stop("taki", f.session().sessionId); release(); await f.runtime.close();
    expect(f.session().status).toBe("stopped"); expect(f.send).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT state FROM runs WHERE trigger_request_id = $requestId").get({ requestId: f.input.requestId })?.state).toBe("cancelled");
  });

  it("never reopens an elapsed timing window after rewind and a renamed revision", async () => {
    const f = await fixture(); f.start(); await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    f.playback.sample.positionSeconds = 25; f.runtime.playbackChanged(); await flush();
    f.playback.sample.positionSeconds = 12; f.playback.sample.state = "playing"; f.runtime.playbackChanged();
    f.plans[0]!.candidateRef = "new-first";
    f.runtime.revise({ characterId: "taki", sessionId: f.session().sessionId, instruction: "Rephrase upcoming reactions" });
    await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(f.session().status).toBe("ready")); await flush();
    expect(f.send).not.toHaveBeenCalled();
    f.playback.sample.positionSeconds = 32; f.runtime.playbackChanged();
    await vi.waitFor(() => expect(f.session().sentCount).toBe(1));
    expect(f.timeline.latestAscending("taki", 10).map((row) => row.content)).toEqual(["Second response"]);
  });

  it("discards a completed but superseded proposal before preparing the latest requested revision", async () => {
    const f = await fixture(); let release!: () => void;
    const original = f.generate.getMockImplementation()!;
    f.generate.mockImplementationOnce(async (control) => {
      await original(control);
      await new Promise<void>((resolve) => { release = resolve; });
    });
    f.start(); await vi.waitFor(() => expect(release).toBeDefined());
    const sessionId = f.session().sessionId;
    f.runtime.revise({ characterId: "taki", sessionId, instruction: "Be brief" });
    f.runtime.revise({ characterId: "taki", sessionId, instruction: "Be brief and avoid questions" });
    f.plans[0]!.text = "Latest requested response";
    release();
    await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.generate.mock.calls[1]?.[0]).toContain("Be brief and avoid questions");
    f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = 12; f.runtime.playbackChanged();
    await vi.waitFor(() => expect(f.session().sentCount).toBe(1));
    expect(f.timeline.latestAscending("taki", 10)[0]?.content).toBe("Latest requested response");
  });

  it("classifies a missing completed proposal as plan-invalid and settles accepted work", async () => {
    const f = await fixture(); f.generate.mockResolvedValue(undefined);
    f.start(); await vi.waitFor(() => expect(f.session()).toMatchObject({ status: "failed", reason: "plan_invalid" }));
    expect(f.send).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT state FROM runs WHERE trigger_request_id = $requestId").get({ requestId: f.input.requestId })?.state).toBe("cancelled");
  });

  it("settles a root admitted after Stop without reading or invoking a model", async () => {
    const f = await fixture(); const original = f.capture.getMockImplementation()!;
    let release!: () => void;
    f.capture.mockImplementationOnce(async (request) => { await new Promise<void>((resolve) => { release = resolve; }); return original(request); });
    f.start(); await flush(); f.runtime.stop("taki", f.session().sessionId); release(); await f.runtime.close();
    expect(f.generate).not.toHaveBeenCalled(); expect(f.readNative).not.toHaveBeenCalled();
    // Admission may refuse the now-retired binding before insertion; either way no active work survives.
    const row = f.db.prepare("SELECT state FROM runs WHERE trigger_request_id = $requestId").get({ requestId: f.input.requestId });
    expect(row?.state === undefined || row.state === "cancelled").toBe(true);
  });
});
