/**
 * INPUT: the replay's owned Core IPC/inspector and canonical fence loader events
 * OUTPUT: a bounded chat-to-free CPU window, Core timer delays and Native client request spans
 * POS: task-only observation; never quiesces, changes deadlines or reads request/response bodies
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const MAINTENANCE_CAP_MS = 360_000;
const TICK_MS = 25;
const save = (root, value) => writeFileSync(join(root, "maintenance-observation.json"), JSON.stringify(value, null, 2), "utf8");

export function pathTemplate(path) {
  const dynamic = new Map([["banks", "bankId"], ["bodies", "bodyId"], ["parts", "part"],
    ["operations", "operationId"], ["snapshots", "snapshotId"], ["commits", "requestId"]]);
  const segments = path.split("?")[0].split("/");
  return segments.map((part, index) => dynamic.has(segments[index - 1]) ? `{${dynamic.get(segments[index - 1])}}`
    : /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part) ? "{id}" : part).join("/");
}

export function installCoreObservation() {
  let enabled = false;
  let selectedFence;
  let lastTick;
  let interval;
  let requestId = 0;
  const send = (event) => { if (process.connected) process.send({ kind: "maintenance-observation", ...event }); };
  const tick = () => {
    const now = performance.now();
    const delayMs = Math.max(0, now - lastTick - TICK_MS);
    send({ event: "loop-delay", at: performance.timeOrigin + now, startAt: performance.timeOrigin + lastTick + TICK_MS, delayMs });
    lastTick = now;
  };
  globalThis.__takiMaintenanceFence = (value) => {
    // The admitted maintenance frame identifies the actual write fence, without depending on factory line numbers.
    if (enabled && selectedFence === undefined && value.active.some((owner) => owner.frames?.some((frame) => frame.includes("runMaintenanceChain")))) {
      selectedFence = value.fenceId;
    }
    if (value.fenceId === selectedFence) {
      if (enabled) send({ event: "fence", value });
      // Preserve the existing backup probe's metadata reader after observation has stopped.
      console.error(JSON.stringify(value));
    }
  };
  globalThis.__takiMaintenanceNative = {
    start(method, path) {
      if (!enabled) return;
      const id = ++requestId;
      send({ event: "native-start", id, at: Date.now(), method, path: pathTemplate(path) });
      return { id, start: performance.now() };
    },
    end(span, status) {
      if (span) send({ event: "native-end", id: span.id, at: Date.now(), durationMs: performance.now() - span.start, status: status ?? null });
    },
  };
  process.on("message", (message) => {
    if (message === "maintenance-start") {
      enabled = true; lastTick = performance.now();
      interval = setInterval(tick, TICK_MS); interval.unref();
      send({ event: "started", at: Date.now() });
    }
    if (message === "maintenance-stop") {
      if (enabled) tick();
      enabled = false; clearInterval(interval);
      send({ event: "stopped", at: Date.now() });
    }
  });
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/hindsight-http-transport.ts")) return loaded;
    let source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
    const replace = (anchor, replacement) => {
      assert.equal(source.split(anchor).length - 1, 1, "Native observation anchor changed");
      source = source.replace(anchor, replacement);
    };
    replace("  let response: IncomingMessage | undefined;", "  const probe = globalThis.__takiMaintenanceNative?.start(prepared.method, prepared.url.pathname);\n  let response: IncomingMessage | undefined;");
    replace("    request.destroy();", "    request.destroy();\n    globalThis.__takiMaintenanceNative?.end(probe, response?.statusCode);");
    return { ...loaded, source };
  } });
  installMetadataLogFilter();
}

function installMetadataLogFilter() {
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    let pending = "";
    stream.write = (chunk, encoding, callback) => {
      pending += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      let index;
      while ((index = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        let value;
        try { value = JSON.parse(line); } catch { continue; }
        const allowed = value.diagnostic === "backup-quiescence-probe"
          ? ["diagnostic", "event", "fenceId", "at", "origin", "active"]
          : ["time", "level", "pid", "code", "characterId", "status", "assessed", "blocks", "pending", "edits", "steps"];
        const projected = Object.fromEntries(allowed.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
        if (value.msg === "Hindsight policy review settled") projected.event = "policy-review-settled";
        if (Object.keys(projected).length) write(JSON.stringify(projected) + "\n");
      }
      const done = typeof encoding === "function" ? encoding : callback;
      if (done) queueMicrotask(done);
      return true;
    };
  }
}

export async function startMaintenanceObservation({ root, core, profiler }) {
  const observed = { version: 1, status: "observing", capMs: MAINTENANCE_CAP_MS, bootProfile: "replaced",
    profile: "maintenance.cpuprofile", profileStart: profiler.started, fenceEvents: [], native: [],
    eventLoop: { intervalMs: TICK_MS, thresholdMs: 250, maxDelayMs: 0, stalls: [] } };
  const requests = new Map();
  let resolveWindow;
  let resolveStart;
  let resolveStop;
  let timer;
  const window = new Promise((resolve) => { resolveWindow = resolve; });
  const started = new Promise((resolve) => { resolveStart = resolve; });
  const stopped = new Promise((resolve) => { resolveStop = resolve; });
  const finish = (reason, endAt) => {
    if (observed.endAt !== undefined) return;
    observed.endAt = endAt; observed.status = reason; clearTimeout(timer); resolveWindow();
  };
  const checkFree = () => {
    const latest = observed.fenceEvents.at(-1);
    // This replay submits one chat. Core admission can precede parent WS receipt across the two channels.
    const postChatOwner = observed.fenceEvents.some((event) => event.active.some((owner) =>
      event.at - owner.ageMs >= observed.startAt && owner.frames?.some((frame) => frame.includes("runMaintenanceChain"))));
    if (observed.chatCompleteAt !== undefined && postChatOwner && latest?.active.length === 0) {
      finish("fence-free", Math.max(observed.chatCompleteAt, latest.at));
    }
  };
  const receive = (message) => {
    if (message?.kind !== "maintenance-observation") return;
    if (message.event === "started") { observed.loopStartedAt = message.at; resolveStart(); }
    if (message.event === "stopped") resolveStop();
    if (message.event === "fence") { observed.fenceEvents.push(message.value); checkFree(); }
    if (message.event === "native-start") requests.set(message.id, { id: message.id, method: message.method, path: message.path, startAt: message.at });
    if (message.event === "native-end" && requests.has(message.id)) Object.assign(requests.get(message.id), {
      endAt: message.at, durationMs: message.durationMs, status: message.status });
    if (message.event === "loop-delay") {
      const end = Math.min(message.at, observed.endAt ?? Infinity);
      const start = Math.max(message.startAt, observed.startAt ?? observed.loopStartedAt);
      const delayMs = Math.max(0, end - start);
      observed.eventLoop.maxDelayMs = Math.max(observed.eventLoop.maxDelayMs, delayMs);
      if (delayMs > 250) observed.eventLoop.stalls.push({ startAt: start, durationMs: delayMs });
    }
  };
  core.child.on("message", receive);
  core.child.send("maintenance-start");
  await bounded(started, "Core observation start");
  const captured = window.then(async () => {
    core.child.send("maintenance-stop");
    // The parent timer also stops capture if Core cannot deliver its own timers.
    const stopping = profiler.call("Profiler.stop").then(({ profile }) => {
      observed.rawProfileDurationMs = (profile.endTime - profile.startTime) / 1000;
      const epoch = (profiler.started.before + profiler.started.after) / 2;
      const first = Math.min(profile.endTime, Math.max(profile.startTime, profile.startTime + (observed.startAt - epoch) * 1000));
      const limit = Math.max(first, Math.min(profile.endTime, profile.startTime + (observed.endAt - epoch) * 1000));
      let time = profile.startTime;
      const samples = []; const deltas = [];
      for (let index = 0; index < (profile.timeDeltas?.length ?? 0); index++) {
        const previous = time; time += profile.timeDeltas[index];
        const duration = Math.min(time, limit) - Math.max(previous, first);
        if (duration > 0) { samples.push(profile.samples[index]); deltas.push(duration); }
        if (time >= limit) break;
      }
      observed.profileEpochMs = epoch + (first - profile.startTime) / 1000;
      observed.profileClockUncertaintyMs = (profiler.started.after - profiler.started.before) / 2;
      profile.startTime = first;
      profile.samples = samples; profile.timeDeltas = deltas;
      profile.endTime = limit;
      const counts = new Map();
      for (const id of samples) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const node of profile.nodes) { node.hitCount = counts.get(node.id) ?? 0; delete node.positionTicks; }
      writeFileSync(join(root, observed.profile), JSON.stringify(profile), "utf8");
      observed.profileDurationMs = (profile.endTime - profile.startTime) / 1000;
    }).catch(() => { observed.profileError = "INSPECTOR_STOP_OR_SAVE_FAILED"; });
    await Promise.all([stopping, bounded(stopped, "Core observation stop").catch(() => { observed.eventLoop.incomplete = true; })]);
    observed.native = [...requests.values()];
    core.child.off("message", receive); profiler.close(); save(root, observed);
    return observed;
  });
  return {
    observed,
    submit() {
      observed.startAt = Date.now();
      timer = setTimeout(() => finish("cap-reached", observed.startAt + MAINTENANCE_CAP_MS), MAINTENANCE_CAP_MS);
      save(root, observed);
    },
    chatComplete(at) { observed.chatCompleteAt = at; checkFree(); },
    async finish() {
      if (observed.startAt === undefined) { observed.startAt = Date.now(); finish("not-submitted", observed.startAt); }
      return captured;
    },
  };
}

async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 15_000); })]); }
  finally { clearTimeout(timer); }
}
