import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { coWatchingFixture, coWatchingInput } from "../testing/co-watching-fixture.ts";
import { verifyCoWatchingNative } from "./native-result.ts";

const fixtures: Awaited<ReturnType<typeof coWatchingFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); });
async function fixture() { const f = await coWatchingFixture(); fixtures.push(f); return f; }

it("accepts an explicitly unknown native end without rewriting source data, but still bounds the start", () => {
  const f = coWatchingInput(); const moment = f.raw.structuredContent.result.analysis.moments[0]!;
  moment.end_seconds = null;
  const verified = verifyCoWatchingNative(f.raw, f.analysis);
  expect(verified.native.analysis.moments[0]?.end_seconds).toBeNull();
  expect(verified.complete).toEqual(f.raw.structuredContent.result);
  moment.at_seconds = 301;
  expect(() => verifyCoWatchingNative(f.raw, f.analysis)).toThrow("CO_WATCHING_ANALYSIS_MISMATCH");
});

it("keeps all analysis for conversation while only bounded moments can publish", async () => {
  const f = await fixture(); f.raw.structuredContent.result.analysis.moments[0]!.end_seconds = null;
  f.plans.splice(0, 1);
  f.start(); await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  const input = JSON.parse(await readFile(join(f.workspaceRoot, "co-watching-inputs", f.session().sessionId, "analysis.json"), "utf8"));
  expect(input.analysis.moments[0].end_seconds).toBeNull();
  expect(input.boundedMomentIds).toEqual(["second"]);
  expect(f.runtime.context("taki")).toContain("/analysis.json");
  expect(f.generate.mock.calls[0]?.[0]).toContain("Only boundedMomentIds");
  f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = 12;
  f.runtime.playbackChanged(); await new Promise((resolve) => setImmediate(resolve));
  expect(f.send).not.toHaveBeenCalled();
  f.playback.sample.positionSeconds = 32; f.runtime.playbackChanged();
  await vi.waitFor(() => expect(f.session().sentCount).toBe(1));
  expect(f.timeline.latestAscending("taki", 10).map((row) => row.content)).toEqual(["Second response"]);
});

it("retains usable conversation material with no model preparation or automatic output when all ends are unknown", async () => {
  const f = await fixture(); for (const moment of f.raw.structuredContent.result.analysis.moments) moment.end_seconds = null;
  f.start(); await vi.waitFor(() => expect(f.session()).toMatchObject({ status: "ready", preparedCount: 0, sentCount: 0 }));
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.runtime.context("taki")).toContain("/analysis.json");
  f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = 32; f.runtime.playbackChanged();
  await new Promise((resolve) => setImmediate(resolve));
  expect(f.send).not.toHaveBeenCalled();
  const current = JSON.parse(await readFile(join(f.workspaceRoot, "co-watching-inputs", f.session().sessionId, "current-plan.json"), "utf8"));
  expect(current.expiredMomentIds).toEqual([]); expect(current.plan.candidates).toEqual([]);
});

it("rejects a proposal that tries to use an unknown end as an automatic publication window", async () => {
  const f = await fixture(); f.raw.structuredContent.result.analysis.moments[0]!.end_seconds = null;
  f.start(); await vi.waitFor(() => expect(f.session()).toMatchObject({ status: "failed", reason: "plan_invalid" }));
  expect(f.send).not.toHaveBeenCalled();
});
