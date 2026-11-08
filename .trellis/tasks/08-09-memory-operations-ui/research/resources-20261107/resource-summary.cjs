// Leader-only summary of resource-sampler JSONL against a journey result.json: per-component memory/CPU, per-step peaks, disk.
const fs = require("fs");
const [samplesPath, resultPath] = process.argv.slice(2);
const samples = fs.readFileSync(samplesPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line.replace(/^﻿/, "")));
const result = resultPath ? JSON.parse(fs.readFileSync(resultPath, "utf8")) : null;
// The sampler truncates command lines at 220 chars, which can cut "--core-child" off; Core is the harness script re-run as its own child.
const HARNESS = /native-smoke|post-reentry|real-model-memory/;
const classify = (p, byPid) => {
  const c = p.cmd || "";
  if (p.name === "postgres.exe") return "pg";
  if (p.name === "headless_shell.exe") return "home-browser";
  if (p.name === "python.exe") return /native_launcher|native-launcher/.test(c) ? "native" : /home-check/.test(c) ? "home-driver" : "python-other";
  if (/--core-child/.test(c)) return "core";
  if (/vite/.test(c)) return "home-dev-server";
  if (HARNESS.test(c)) return HARNESS.test(byPid.get(p.ppid)?.cmd || "") ? "core" : "harness";
  return "node-other";
};
const mb = (b) => Math.round(b / 1048576);
const quantile = (values, q) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const series = {}; const cpu = {}; const procMax = {};
for (const s of samples) {
  const sums = {};
  const procs = [s.procs || []].flat();
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  for (const p of procs) {
    const k = classify(p, byPid);
    sums[k] ??= { ws: 0, priv: 0, n: 0 }; sums[k].ws += p.ws; sums[k].priv += p.priv; sums[k].n++;
    cpu[k] ??= {}; cpu[k][p.pid] = Math.max(cpu[k][p.pid] ?? 0, p.cpu);
    procMax[k] = Math.max(procMax[k] ?? 0, p.ws);
  }
  for (const [k, v] of Object.entries(sums)) (series[k] ??= []).push({ t: s.t, ...v });
}
const components = Object.fromEntries(Object.entries(series).map(([k, v]) => [k, {
  samples: v.length, maxProcesses: Math.max(...v.map((x) => x.n)),
  wsMB: { p50: mb(quantile(v.map((x) => x.ws), 0.5)), p95: mb(quantile(v.map((x) => x.ws), 0.95)), max: mb(Math.max(...v.map((x) => x.ws))) },
  privateMB: { p50: mb(quantile(v.map((x) => x.priv), 0.5)), max: mb(Math.max(...v.map((x) => x.priv))) },
  largestProcessWsMB: mb(procMax[k]),
  cpuSeconds: Math.round(Object.values(cpu[k] || {}).reduce((a, b) => a + b, 0) / 1e7),
}]));
const steps = result ? result.steps.map((step) => {
  const from = Date.parse(step.startedAt); const to = Date.parse(step.finishedAt ?? step.startedAt);
  const peak = (k) => mb(Math.max(0, ...(series[k] || []).filter((x) => Date.parse(x.t) >= from && Date.parse(x.t) <= to).map((x) => x.ws)));
  return { id: step.id, status: step.status, seconds: Math.round(step.durationMs / 100) / 10, coreMB: peak("core"), nativeMB: peak("native"), pgMB: peak("pg") };
}) : [];
const first = samples[0]; const disks = samples.filter((s) => s.disk);
const span = (Date.parse(samples.at(-1).t) - Date.parse(first.t)) / 1000;
console.log(JSON.stringify({
  samples: samples.length, spanSeconds: Math.round(span),
  system: { totalMB: Math.round(first.totalKB / 1024), freeAtStartMB: Math.round(first.freeKB / 1024),
    minFreeMB: Math.round(Math.min(...samples.map((s) => s.freeKB)) / 1024), maxCommitMB: Math.round(Math.max(...samples.map((s) => s.commitKB)) / 1024) },
  components, steps,
  disk: disks.length ? { last: Object.fromEntries(Object.entries(disks.at(-1).disk).map(([k, v]) => [k, typeof v === "number" ? mb(v) : v])),
    maxMB: Object.fromEntries(["pg-data", "core-data", "native-backups"].map((d) => [d, mb(Math.max(0, ...disks.map((s) => s.disk[d] ?? 0)))])) } : null,
}, null, 1));
