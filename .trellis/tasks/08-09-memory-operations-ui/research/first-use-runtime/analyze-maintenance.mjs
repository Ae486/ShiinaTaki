/**
 * INPUT: one stopped replay root (new observation or legacy boot-profile artifacts)
 * OUTPUT: metadata-only timeline, sample-weighted frame/stacks and Native request histogram on stdout
 * POS: offline task analysis; no services, providers, mutable DB opens or content-bearing artifact copies
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { profileAnalysis } from "./maintenance-profile-analysis.mjs";
import { pathTemplate } from "./maintenance-observation.mjs";
import { readMaintenanceJournal } from "./maintenance-journal.mjs";

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const iso = (at) => Number.isFinite(at) ? new Date(at).toISOString() : "UNKNOWN";

export function analyzeMaintenance(root) {
  const result = json(join(root, "replay-result.json"));
  const observed = existsSync(join(root, "maintenance-observation.json")) ? json(join(root, "maintenance-observation.json")) : null;
  const start = observed?.startAt ?? Date.parse(result.chat.startedAt);
  const complete = observed?.chatCompleteAt ?? Date.parse(result.chat.startedAt) + result.chat.notificationMs;
  const events = observed?.fenceEvents ?? result.backup?.fenceEvents ?? [];
  const holder = events.find((event) => event.active.some((owner) => owner.frames?.some((line) => line.includes("runMaintenanceChain"))));
  const maintenance = holder?.active.find((owner) => owner.frames?.some((line) => line.includes("runMaintenanceChain")));
  const free = events.find((event) => event.fenceId === holder?.fenceId && event.at >= complete && event.active.length === 0);
  const end = observed?.endAt ?? free?.at;
  const timeline = [];
  const add = (boundary, at, evidence, detail = {}) => timeline.push({ boundary, at: iso(at), evidence, ...detail });
  add("chat-submitted", start, observed ? "maintenance-observation.json" : "replay-result.json chat.startedAt");
  add("chat-complete", complete, observed ? "operator notification timestamp" : "startedAt + notificationMs (parent observation)");
  add("maintenance-admitted", holder && maintenance ? holder.at - maintenance.ageMs : NaN, "write-fence owner admission timestamp", { fenceId: holder?.fenceId ?? "UNKNOWN" });
  for (const boundary of ["curator-entry", "utility-slot-entry", "tool-calls-done"]) {
    add(boundary, NaN, "UNKNOWN: existing sources do not persist this exact boundary; CPU frames are samples, not entry events");
  }
  for (const entry of result.provider ?? []) {
    if (!String(entry.kind).includes("policy")) continue;
    add("curator-model-request-sent", NaN, "UNKNOWN: provider-side receipt is not Core dispatch", { requestId: entry.id });
    add("curator-model-request-received", entry.receivedAt ?? Date.parse(entry.at), "fake provider log; legacy at is after classification", { requestId: entry.id });
    add("curator-model-answer-finished", entry.answeredAt ?? NaN, entry.answeredAt ? "fake provider response finish; not Core consumption" : "UNKNOWN: legacy provider has no response timestamp", { requestId: entry.id });
  }
  const journal = readMaintenanceJournal(root, iso(start));
  const inWindow = (at) => Number.isFinite(at) && at >= start && (!Number.isFinite(end) || at <= end);
  for (const row of journal.rows ?? []) {
    const ids = { workId: row.work_id, requestId: row.command_request_id, bankId: row.bank_id };
    for (const [boundary, key] of [["policy-work-created", "created_at"], ["publication-command-prepared", "prepared_at"], ["publication-command-dispatched", "dispatched_at"]]) {
      const at = Date.parse(row[key]); if (inWindow(at)) add(boundary, at, `DB ${key}`, ids);
    }
    if (row.prepared_at && !row.dispatched_at) add("publication-command-not-dispatched", NaN, "DB dispatched_at is null", ids);
    const completed = Date.parse(row.command_updated_at);
    if (row.command_state === "completed" && inWindow(completed)) add("publication-command-completed", completed, "DB completed state + updated_at", ids);
    if (row.command_request_id && row.command_state !== "completed" && row.dispatched_at) {
      add("publication-command-completed", NaN, `UNKNOWN: final command state ${row.command_state}`, ids);
    }
    const finished = Date.parse(row.finished_at);
    if (row.state === "completed" && row.work_kind === "policy" && inWindow(finished)) {
      add("local-refresh-complete-upper-bound", finished, "DB work finished after refresh + applied verification; not refresh return time", ids);
    }
  }
  add("local-refresh-complete", NaN, "UNKNOWN: no exact refresh return timestamp; work completion bounds successful application");
  const coreLog = existsSync(join(root, "core.log")) ? readFileSync(join(root, "core.log"), "utf8") : "";
  for (const line of coreLog.split(/\r?\n/)) {
    let value; try { value = JSON.parse(line); } catch { continue; }
    if (value.msg === "Hindsight policy review settled" || value.event === "policy-review-settled") {
      add("policy-review-settled", Number(value.time), "Core existing policy-review log", Object.fromEntries(["status", "assessed", "pending", "steps"].map((key) => [key, value[key]])));
    }
  }
  add("fence-free", free?.at, "write-fence zero-holder event");
  const nativeEvents = [];
  if (observed && existsSync(join(root, "native.log"))) {
    for (const line of readFileSync(join(root, "native.log"), "utf8").split(/\r?\n/)) {
      let value; try { value = JSON.parse(line); } catch { continue; }
      nativeEvents.push(value);
      if (value.event === "native-consolidation-completed" && inWindow(value.at)) add(value.event, value.at, "Native existing log projection; not a Core wait boundary");
    }
  }
  if (observed?.status === "cap-reached") add("observation-cap", end, "parent six-minute deadline; fence-free remains unproven");
  timeline.sort((a, b) => a.at === "UNKNOWN" ? 1 : b.at === "UNKNOWN" ? -1 : a.at.localeCompare(b.at));
  let profile;
  const profilePath = join(root, observed?.profile ?? "recall.cpuprofile");
  if (existsSync(profilePath)) {
    const epoch = observed ? observed.profileEpochMs ?? (observed.profileStart.before + observed.profileStart.after) / 2 : undefined;
    profile = profileAnalysis(json(profilePath), observed ? { epochMs: epoch, startMs: start - epoch, endMs: end - epoch } : undefined);
    profile.scope = observed ? "chat-to-free/cap window" : "ENTIRE legacy boot profile; absolute start UNKNOWN; NOT maintenance-window rankings";
    profile.alignmentUncertaintyMs = observed ? (observed.profileStart.after - observed.profileStart.before) / 2 : "UNKNOWN";
    if (!observed) profile.latestPossibleEnd = iso(start + profile.profileDurationMs);
  } else profile = { status: "UNKNOWN", reason: "CPU profile artifact absent" };
  return { root, observation: observed?.status ?? "legacy-partial", window: { start: iso(start), end: iso(end) }, timeline,
    profile, eventLoop: observed?.eventLoop ?? { status: "UNKNOWN", reason: "No in-Core event-loop observation in legacy run" },
    journal: { status: journal.status, rows: journal.rows?.length ?? null, reason: journal.reason },
    native: nativeHistogram(root, observed, start, end, nativeEvents), backup: result.backup?.attempts?.map(({ operationId, state, errorCode, totalMs }) => ({ operationId, state, errorCode, totalMs })) ?? "NOT RUN" };
}

function nativeHistogram(root, observed, start, end, nativeEvents) {
  const groups = new Map();
  const add = (method, path, span) => {
    const key = `${method} ${pathTemplate(path)}`;
    if (!groups.has(key)) groups.set(key, { method, path: pathTemplate(path), count: 0, completed: 0, incomplete: 0, crossingEnd: 0, totalMs: 0, maxMs: 0, windowMs: 0 });
    const row = groups.get(key); row.count++;
    if (span?.endAt !== undefined) {
      row.completed++; row.totalMs += span.durationMs; row.maxMs = Math.max(row.maxMs, span.durationMs);
      row.windowMs += Math.max(0, Math.min(span.endAt, end) - span.startAt);
      if (span.endAt > end) row.crossingEnd++;
    } else row.incomplete++;
  };
  if (observed) {
    const spans = new Map();
    for (const event of nativeEvents) {
      if (event.event === "native-request-start") spans.set(event.id, { ...event });
      if (event.event === "native-request-end" && spans.has(event.id)) Object.assign(spans.get(event.id), event);
    }
    for (const span of spans.values()) { if (span.startAt >= start && span.startAt <= end) add(span.method, span.path, span); }
  }
  else {
    const log = readFileSync(join(root, "native.log"), "utf8");
    for (const [, method, path] of log.matchAll(/"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) ([^ ?"]+)(?:\?[^ "]*)? HTTP\/1\.1" \d{3}/g)) add(method, path);
  }
  return { scope: observed ? "Native ASGI requests started inside window; total/max are measured full request durations, windowMs is clipped overlap; crossing-end and still-incomplete requests counted separately"
    : "UNKNOWN in-window; legacy access log has neither timestamps nor durations; counts below are WHOLE RUN only",
    status: observed && !nativeEvents.some((event) => event.event === "native-request-start") ? "UNKNOWN: Native request observation absent" : "observed",
    coreClientSpans: observed?.native.filter((span) => span.startAt >= start && span.startAt <= end) ?? "UNKNOWN",
    rows: [...groups.values()].sort((a, b) => b.count - a.count).map((row) => ({ ...row,
      totalMs: row.completed ? row.totalMs : "UNKNOWN", maxMs: row.completed ? row.maxMs : "UNKNOWN", windowMs: row.completed ? row.windowMs : "UNKNOWN" })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: node analyze-maintenance.mjs <stopped-run-root>");
  console.log(JSON.stringify(analyzeMaintenance(resolve(process.argv[2])), null, 2));
}
