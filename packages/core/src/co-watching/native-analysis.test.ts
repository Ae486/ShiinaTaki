import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { coWatchingFixture } from "../testing/co-watching-fixture.ts";
import { createCoWatchingCatalog } from "./analysis-catalog.ts";

const fixtures: Awaited<ReturnType<typeof coWatchingFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); });
async function fixture() { vi.useFakeTimers(); const f = await coWatchingFixture({ fresh: true }); fixtures.push(f); return f; }
function invite(f: Awaited<ReturnType<typeof fixture>>, reanalyze = false) {
  return f.runtime.invite({ characterId: "taki", sourceRef: f.playback.sourceRef, requestId: randomUUID(), lifetimeMinutes: 5, reanalyze }, f.interactive);
}

it("submits once through captured tools, releases the lane while waiting, and reuses the verified result", async () => {
  const f = await fixture(); expect(invite(f).accepted).toBe(true);
  await vi.waitFor(() => expect(f.submitNative).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(f.queue.isBusy("taki")).toBe(false));
  expect(f.generate).not.toHaveBeenCalled();
  const persisted = createCoWatchingCatalog(join(f.workspaceRoot, "catalog.json"));
  expect(persisted.request(f.session().analysisId)?.requestId).toBe(f.raw.structuredContent.identity.request_id);
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.catalog.list()).toHaveLength(1);
  f.runtime.stop("taki", f.session().sessionId);
  expect(invite(f).accepted).toBe(true);
  await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(f.submitNative).toHaveBeenCalledTimes(1);
});

it("reconciles a lost submit response using the retained request, without another POST", async () => {
  const f = await fixture(); const submit = f.submitNative.getMockImplementation()!;
  f.submitNative.mockImplementationOnce(async (input) => {
    await submit(input);
    return { isError: true, structuredContent: { ok: false, error: { code: "submission_outcome_unknown" } } };
  });
  invite(f); await vi.waitFor(() => expect(f.submitNative).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.lookupNative).toHaveBeenCalledTimes(1));
  expect(f.lookupNative.mock.calls[0]?.[0]).toMatchObject({ client_request_id: f.raw.structuredContent.identity.request_id });
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  expect(f.submitNative).toHaveBeenCalledTimes(1);
});

it("Stop retires waiting work; a new explicit acceptance reconciles the same native job", async () => {
  const f = await fixture(); invite(f);
  await vi.waitFor(() => expect(f.submitNative).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(f.queue.isBusy("taki")).toBe(false));
  const first = f.session(); f.runtime.stop("taki", first.sessionId);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(f.generate).not.toHaveBeenCalled(); expect(f.statusNative).not.toHaveBeenCalled();
  invite(f); await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  expect(f.session().analysisId).toBe(first.analysisId);
  expect(f.submitNative).toHaveBeenCalledTimes(1);
});

it("does not publish or catalog a result for a different media identity", async () => {
  const f = await fixture(); f.raw.structuredContent.result.source.resolved = { ...f.analysis.media, cid: "12345" };
  invite(f); await vi.waitFor(() => expect(f.submitNative).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.session().status).toBe("failed"));
  expect(f.session().reason).toBe("analysis_mismatch");
  expect(f.catalog.list()).toHaveLength(0); expect(f.generate).not.toHaveBeenCalled();
});

it("resubmits the same key only after definitive absence within the original acceptance", async () => {
  const f = await fixture();
  f.submitNative.mockResolvedValueOnce({ isError: true, structuredContent: { ok: false, error: { code: "submission_outcome_unknown" } } });
  f.lookupNative.mockImplementationOnce(async () => { throw new Error("request_not_found"); });
  invite(f); await vi.waitFor(() => expect(f.submitNative).toHaveBeenCalledTimes(1));
  const original = f.submitNative.mock.calls[0]?.[0];
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.lookupNative).toHaveBeenCalledTimes(1));
  expect(f.submitNative).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(6_000);
  await vi.waitFor(() => expect(f.submitNative).toHaveBeenCalledTimes(2));
  expect(f.submitNative.mock.calls[1]?.[0]).toEqual(original);
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.session().status).toBe("ready"));
});

it.each([false, true])("does not replay an unknown old request in a new acceptance (restart=%s)", async (restart) => {
  const f = await fixture();
  f.submitNative.mockResolvedValue({ isError: true, structuredContent: { ok: false, error: { code: "submission_outcome_unknown" } } });
  f.lookupNative.mockImplementation(async () => { throw new Error("request_not_found"); });
  invite(f); await vi.waitFor(() => expect(f.submitNative).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(f.queue.isBusy("taki")).toBe(false));
  const original = f.catalog.request(f.session().analysisId)!;
  if (restart) await f.restart();
  else f.runtime.stop("taki", f.session().sessionId);
  invite(f);
  await vi.waitFor(() => expect(f.lookupNative).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(40_000);
  await vi.waitFor(() => expect(f.session().reason).toBe("analysis_unknown"));
  expect(f.submitNative).toHaveBeenCalledTimes(1);
  expect(f.lookupNative.mock.calls.every(([args]) => (args as { client_request_id: string }).client_request_id === original.requestId)).toBe(true);
  expect(invite(f, true)).toEqual({ accepted: false, reason: "not_ready" });
  expect(f.generate).not.toHaveBeenCalled();
});

it("retires uncertain native work when its captured service generation is lost", async () => {
  const f = await fixture();
  f.submitNative.mockResolvedValue({ isError: true, structuredContent: { ok: false, error: { code: "submission_outcome_unknown" } } });
  invite(f); await vi.waitFor(() => expect(f.submitNative).toHaveBeenCalledTimes(1));
  f.flags.native = false;
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.session().status).toBe("failed"));
  expect(f.lookupNative).not.toHaveBeenCalled(); expect(f.submitNative).toHaveBeenCalledTimes(1);
});

it("requires an explicit reanalysis of a confirmed failed same-video request and retains old identities", async () => {
  const f = await fixture();
  expect(invite(f, true)).toEqual({ accepted: false, reason: "not_ready" });
  const status = f.statusNative.getMockImplementation()!;
  f.statusNative.mockImplementationOnce(async () => ({ structuredContent: { ...(await status()).structuredContent, state: "failed" } }));
  invite(f); await vi.waitFor(() => expect(f.submitNative).toHaveBeenCalledTimes(1));
  expect(invite(f, true)).toEqual({ accepted: false, reason: "already_active" });
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.session().reason).toBe("analysis_failed"));
  const old = f.catalog.request(f.session().analysisId)!;
  const media = { ...f.playback.source.media };
  f.playback.source.media.cid = "999";
  expect(invite(f, true)).toEqual({ accepted: false, reason: "not_ready" });
  f.playback.source.media = media;
  expect(invite(f, true).accepted).toBe(true);
  await vi.waitFor(() => expect(f.submitNative).toHaveBeenCalledTimes(2));
  const next = f.catalog.request(f.session().analysisId)!;
  expect(next.requestId).not.toBe(old.requestId); expect(next.analysisId).not.toBe(old.analysisId);
  expect(f.catalog.request(old.analysisId)).toEqual(old);
  expect(createCoWatchingCatalog(join(f.workspaceRoot, "catalog.json")).reserve({ media, serverId: old.serverId })).toEqual({ request: next, created: false });
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  f.runtime.stop("taki", f.session().sessionId);
  expect(invite(f, true)).toEqual({ accepted: false, reason: "not_ready" });
});
