// Leader-only: per-component CPU rate (cores) between samples, plus the memory series around a given component's peak.
const fs = require("fs");
const [path, peakKey = "native"] = process.argv.slice(2);
const samples = fs.readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l.replace(/^﻿/, "")));
const HARNESS = /native-smoke|post-reentry|real-model-memory/;
const classify = (p, byPid) => {
  const c = p.cmd || "";
  if (p.name === "postgres.exe") return "pg";
  if (p.name === "headless_shell.exe") return "home-browser";
  if (p.name === "python.exe") return /native_launcher|native-launcher/.test(c) ? "native" : "python-other";
  if (/--core-child/.test(c)) return "core";
  if (HARNESS.test(c)) return HARNESS.test(byPid.get(p.ppid)?.cmd || "") ? "core" : "harness";
  return "node-other";
};
const rates = {}; const prev = new Map(); const series = [];
for (const s of samples) {
  const procs = [s.procs || []].flat(); const byPid = new Map(procs.map((p) => [p.pid, p]));
  const t = Date.parse(s.t); const inc = {}; const row = { t: s.t, freeMB: Math.round(s.freeKB / 1024) };
  for (const p of procs) {
    const k = classify(p, byPid); const was = prev.get(p.pid);
    if (was && t > was.t) inc[k] = (inc[k] ?? 0) + (p.cpu - was.cpu) / 1e7 / ((t - was.t) / 1000);
    prev.set(p.pid, { t, cpu: p.cpu });
    row[k] = (row[k] ?? 0) + Math.round(p.ws / 1048576);
  }
  for (const [k, v] of Object.entries(inc)) (rates[k] ??= []).push(v);
  row.cores = Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, +v.toFixed(2)]));
  series.push(row);
}
const q = (v, f) => { const s = [...v].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(2); };
console.log(JSON.stringify(Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, { p50: q(v, .5), p95: q(v, .95), max: +Math.max(...v).toFixed(2) }]))));
const peak = series.reduce((a, r, i) => ((r[peakKey] ?? 0) > (series[a][peakKey] ?? 0) ? i : a), 0);
for (const r of series.slice(Math.max(0, peak - 8), peak + 6)) console.log(r.t.slice(11, 19), peakKey, r[peakKey], "core", r.core, "pg", r.pg, "free", r.freeMB, JSON.stringify(r.cores));
const disks = samples.filter((s) => s.disk && s.disk["pg-data"]);
console.log("disk first/last", JSON.stringify(disks[0]?.disk), JSON.stringify(disks.at(-1)?.disk));
const pgArgs = [...new Set(samples.flatMap((s) => [s.procs || []].flat()).filter((p) => p.name === "postgres.exe" && / -D /.test(p.cmd || "")).map((p) => p.cmd))];
console.log("pg", pgArgs[0]);
