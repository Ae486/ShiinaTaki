/** Lightweight offline checks only: no Core, Native, PG, provider, Vitest or replay startup. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { profileAnalysis } from "./maintenance-profile-analysis.mjs";
import { metadataReplay } from "./maintenance-observation-adapters.mjs";
import { MAINTENANCE_CAP_MS, pathTemplate, startMaintenanceObservation } from "./maintenance-observation.mjs";
import { analyzeMaintenance } from "./analyze-maintenance.mjs";

const node = (id, name, children = []) => ({ id, callFrame: { functionName: name, url: "fixture.ts", lineNumber: 0 }, children });
const profile = { startTime: 0, endTime: 10_000, nodes: [node(1, "root", [2, 4]), node(2, "caller", [3]), node(3, "leaf"), node(4, "(idle)")],
  samples: [3, 3, 4, 2, 3], timeDeltas: [1000, 2000, 1000, 2000, 4000] };
const summary = profileAnalysis(profile, { startMs: 1.5, endMs: 8, epochMs: 0 });
assert.equal(summary.sampledMs, 6.5);
assert.equal(summary.topSelf.find((row) => row.frame.startsWith("leaf ")).ms, 3.5);
assert.equal(summary.topTotal.find((row) => row.frame.startsWith("caller ")).ms, 5.5);
assert.deepEqual(summary.longestBusy.map((row) => [row.startMs, row.durationMs]), [[4, 4], [1.5, 1.5]]);
assert.equal(profileAnalysis({ ...profile, timeDeltas: [] }).status, "UNKNOWN");
assert.equal(pathTemplate("/banks/abc/application-state/bodies/def/parts/1?secret=x"), "/banks/{bankId}/application-state/bodies/{bodyId}/parts/{part}");
const projected = JSON.stringify(metadataReplay({ chat: { reply: "DO_NOT_LOG", toolResult: "DO_NOT_LOG", run: { state: "completed", output: "DO_NOT_LOG" } },
  provider: [{ id: 1, kind: "policy", lastUser: "DO_NOT_LOG", toolResult: "DO_NOT_LOG", answer: { text: "DO_NOT_LOG" } }],
  failure: "DO_NOT_LOG", teardown: { core: { error: "DO_NOT_LOG" } } }));
assert(!projected.includes("DO_NOT_LOG"));

async function collector(cap) {
  const root = mkdtempSync(join(process.env.TEMP, cap ? "observation-cap-" : "observation-free-"));
  const child = new EventEmitter();
  const emit = (value) => child.emit("message", { kind: "maintenance-observation", ...value });
  child.send = (message) => emit({ event: message === "maintenance-start" ? "started" : "stopped", at: Date.now() });
  let stops = 0;
  const before = Date.now();
  const profiler = { started: { before, after: before }, close() {}, call: async () => { stops++; return { profile: structuredClone(profile) }; } };
  const observation = await startMaintenanceObservation({ root, core: { child }, profiler });
  observation.submit();
  const at = Date.now();
  if (!cap) {
    emit({ event: "fence", value: { fenceId: 7, at, event: "admitted", active: [{ id: 1, ageMs: 0, frames: ["at runMaintenanceChain (fixture.ts:1)"] }] } });
    observation.chatComplete(at + 1);
    await Promise.resolve(); assert.equal(stops, 0, "chat completion must not stop an active holder");
    emit({ event: "fence", value: { fenceId: 7, at: at + 2, event: "settled", active: [] } });
  }
  const result = await observation.finish();
  assert.equal(result.status, cap ? "cap-reached" : "fence-free");
  assert.equal(stops, 1);
  assert.equal((await observation.finish()).status, result.status);
  assert.equal(stops, 1, "cleanup cannot stop/sample twice");
  assert.equal(JSON.parse(readFileSync(join(root, "maintenance-observation.json"))).status, result.status);
  assert.equal(child.listenerCount("message"), 0);
  return root;
}

const free = await collector(false);
const observed = JSON.parse(readFileSync(join(free, "maintenance-observation.json")));
writeFileSync(join(free, "replay-result.json"), JSON.stringify({ chat: { startedAt: new Date(observed.startAt).toISOString() } }));
const span = (id, at) => ({ event: "native-request-start", id, startAt: at, method: "GET", path: "/banks/fixture/heads" });
writeFileSync(join(free, "native.log"), [span(1, observed.startAt),
  { event: "native-request-end", id: 1, endAt: observed.endAt, durationMs: 2 },
  span(2, observed.startAt), { event: "native-request-end", id: 2, endAt: observed.endAt + 1, durationMs: 3 },
  span(3, observed.startAt), span(4, observed.endAt + 10)].map((row) => JSON.stringify(row)).join("\n"));
const analysis = analyzeMaintenance(free);
assert.equal(analysis.journal.status, "FAILED", "missing journal is not an empty successful read");
assert.deepEqual(analysis.native.rows.map(({ count, completed, incomplete, crossingEnd, totalMs, maxMs }) =>
  ({ count, completed, incomplete, crossingEnd, totalMs, maxMs })),
[{ count: 3, completed: 2, incomplete: 1, crossingEnd: 1, totalMs: 5, maxMs: 3 }]);
const realTimeout = globalThis.setTimeout;
let capped;
try {
  globalThis.setTimeout = (callback, ms, ...args) => realTimeout(callback, ms === MAINTENANCE_CAP_MS ? 5 : ms, ...args);
  capped = await collector(true);
} finally { globalThis.setTimeout = realTimeout; }
console.log(JSON.stringify({ status: "passed", checks: ["weighted samples", "window clipping", "busy stretches", "missing profile timing", "path templates", "privacy projection", "cross-channel holder gating", "parent cap", "single cleanup", "Native window histogram", "failed journal is not empty"], artifacts: [free, capped] }));
