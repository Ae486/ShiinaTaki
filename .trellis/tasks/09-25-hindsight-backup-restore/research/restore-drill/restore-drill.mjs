/**
 * INPUT:  the current checkout, the read-only patched native checkout (H:/hindsight), a fresh temp root; no network, no
 *         real model, no owner data
 * OUTPUT: the Stage 3 AC11 restore drill over the real WS RPC surface and the real native admin CLI: capture (route b and
 *         route c) -> isolated native restore into a fresh pg0 instance -> restored Core on a copy of the captured Core data
 *         -> read-back -> resume without a repeated native effect -> behind-native negative; evidence/ (result.json + scrubbed
 *         logs) next to this script; full teardown with isolation proof
 * POS:    09-25-hindsight-backup-restore W6 drill — rerun with `node restore-drill.mjs` from any cwd
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as shared from "../../../../../packages/shared/src/index.ts";
import { startProxy } from "./drill-proxy.mjs";
import { sleep } from "./drill-journey.mjs";
import {
  stepIncomplete, stepNegative, stepOnboard, stepReadBack, stepRestore, stepRestoredUse, stepResume, stepRouteB, stepRouteC,
  stepStopOriginal, stepWriteOne, stepWriteTwo,
} from "./drill-steps.mjs";
import { bootCore, openOperator, runCoreChild, stopCore } from "./smoke-core.mjs";
import { startFakeProvider } from "./smoke-fake-provider.mjs";
import {
  awaitNativeHealth, descendants, freePort, listOwnerTaki, listPg0Registry, listeners, nativeEgress, portPolicy, processSnapshot,
  removePg0, running, spawnNative, startPg0, stopNative,
} from "./smoke-native.mjs";

const script = fileURLToPath(import.meta.url);
const evidenceDir = fileURLToPath(new URL("./evidence/", import.meta.url));
const LABELS = ["A", "R", "O"];

async function allocatePorts(provider) {
  const taken = [provider.port];
  const ports = {};
  for (const name of ["proxy", ...LABELS.flatMap((label) => [`native${label}`, `core${label}`, `pg${label}`])]) {
    ports[name] = await freePort(taken);
    taken.push(ports[name]);
  }
  return ports;
}

function lifecycle(ctx) {
  ctx.startPg = (label) => {
    const dir = join(ctx.root, `pg-${label}`);
    mkdirSync(dir, { recursive: true });
    ctx.pgs[label] = startPg0(dir, ctx.ports[`pg${label}`]);
    return ctx.pgs[label];
  };
  ctx.startNative = async (label, { pg, workerId }) => {
    const backupDir = join(ctx.root, `native-backups-${label}`);
    mkdirSync(backupDir, { recursive: true });
    const started = Date.now();
    const native = spawnNative({ root: ctx.root, name: `native-${label}`, pgPort: pg.port, port: ctx.ports[`native${label}`], apiKey: ctx.apiKey,
      backupDir, workerId });
    ctx.natives[label] = Object.assign(native, { backupDir });
    native.bootMs = await awaitNativeHealth(native) - started;
    ctx.spawned.push(native.pid, ...descendants(native.pid).map((entry) => entry.pid));
    return native;
  };
  ctx.stopNative = async (label) => {
    const exit = await stopNative(ctx.natives[label]);
    ctx.natives[label].stopped = exit;
    return exit;
  };
  ctx.bootCore = async (label) => {
    const core = await bootCore({ script, dataDir: ctx.dirs[`core${label}`], credentialsDir: ctx.credentialsDir, port: ctx.ports[`core${label}`],
      providerPort: ctx.provider.port, nativePort: ctx.proxy.port, logFile: join(ctx.root, `core-${label}.log`) });
    ctx.cores[label] = core;
    ctx.spawned.push(core.pid);
    ctx.operator = await openOperator(ctx.ports[`core${label}`], `restore drill ${label}`);
    await ctx.operator.call(shared.MEMORY_OPERATION_METHODS.subscribe);
    return core;
  };
  ctx.stopCore = async (label) => {
    const exit = await stopCore(ctx.cores[label]);
    ctx.coreExits.push({ label, ...exit });
    ctx.cores[label] = null;
    return { code: exit.code, signal: exit.signal, forced: exit.forced, egress: exit.egress };
  };
}

function createJourney(ctx) {
  const steps = [];
  const step = async (id, title, body) => {
    const offset = ctx.proxy.log.length;
    const providerStart = ctx.provider.log.length;
    const started = Date.now();
    const entry = { id, title, status: "passed", observed: {}, error: null };
    steps.push(entry);
    console.log(`[drill] step ${id}: ${title}`);
    try {
      await body(ctx, entry.observed);
    } catch (error) {
      entry.status = "failed";
      entry.error = { message: error.message, detail: error.detail ?? error.rpc ?? null };
      console.log(`[drill] step ${id} FAILED: ${error.message}`);
    }
    entry.durationMs = Date.now() - started;
    entry.nativeCalls = summarize(ctx.proxy.log.slice(offset));
    entry.providerRequests = ctx.provider.log.slice(providerStart).map(({ kind, model, tools }) => ({ kind, model, tools }));
    return entry.status === "passed";
  };
  return { steps, step };
}

/** Native calls seen by the proxy, grouped by target, method, path shape and status. */
function summarize(calls) {
  const counts = {};
  for (const call of calls) {
    const shape = call.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>");
    const key = `${call.target} ${call.method} ${shape} ${call.blocked ? "reset" : call.status}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function journey(ctx) {
  const { step } = ctx.journey;
  const plan = [
    [1, "Legacy -> Local onboarding -> Hindsight setup + activation (native A, backup flag on)", stepOnboard],
    [2, "Write M1 through the retain tool; drain; replica.sync", stepWriteOne],
    [3, "Backup #1 route b: capture operator-artifact -> hindsight-admin backup --taki-request -> inbox -> admit -> verify", stepRouteB],
    [4, "Write M2; drain; replica.sync (Core moves past backup #1)", stepWriteTwo],
    [5, "Incomplete work: tracked retain M3 lands natively while Core cannot confirm it", stepIncomplete],
    [6, "Backup #2 route c: capture native-endpoint -> verify; record the pre-capture state", stepRouteC],
    [7, "Stop Core A and native A", stepStopOriginal],
    [8, "Isolated restore: fresh pg0 -> run-db-migration -> restore -> repair-bank --all -> decommission-workers; native R; Core R on the captured core.sqlite", stepRestore],
    [9, "Read back: authority, lineage, Banks, generations, cursors, memory content; no rollback detection", stepReadBack],
    [10, "Resume: M3 completes; no repeated native effect", stepResume],
    [11, "Use the restored pair: recall + backup.verify on the restored host", stepRestoredUse],
    [12, "Negative: Core from backup #2 against native restored from backup #1", stepNegative],
  ];
  for (const [id, title, body] of plan) {
    if (!await step(id, title, body)) return;
  }
}

function copyEvidence(ctx, result) {
  rmSync(evidenceDir, { recursive: true, force: true });
  mkdirSync(evidenceDir, { recursive: true });
  const scrub = (text) => text.replaceAll(ctx.apiKey, "<throwaway-key-redacted>");
  for (const name of readdirSync(ctx.root)) {
    if (/\.(log|jsonl)$/.test(name)) writeFileSync(join(evidenceDir, name), scrub(readFileSync(join(ctx.root, name), "utf8")), "utf8");
  }
  for (const label of LABELS) {
    const dir = join(ctx.root, `pg-${label}`);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".log"))) {
      writeFileSync(join(evidenceDir, `pg-${label}-${name}`), scrub(readFileSync(join(dir, name), "utf8")), "utf8");
    }
  }
  writeFileSync(join(evidenceDir, "provider-requests.json"), scrub(JSON.stringify(ctx.provider.log, null, 2)), "utf8");
  writeFileSync(join(evidenceDir, "proxy-log.json"), JSON.stringify(ctx.proxy.log, null, 2), "utf8");
  writeFileSync(join(evidenceDir, "result.json"), scrub(JSON.stringify(result, null, 2)) + "\n", "utf8");
}

async function teardown(ctx) {
  const record = {};
  const attempt = async (label, action) => {
    try { record[label] = await action(); } catch (error) { record[label] = { error: error.message }; }
  };
  ctx.operator?.close();
  for (const label of LABELS) {
    if (ctx.cores[label]) await attempt(`core${label}Stop`, () => ctx.stopCore(label));
  }
  for (const label of LABELS) {
    if (ctx.natives[label] && !ctx.natives[label].stopped) await attempt(`native${label}Stop`, () => ctx.stopNative(label));
  }
  for (const label of LABELS) {
    if (ctx.pgs[label]?.started) await attempt(`pg0${label}Removal`, () => removePg0(ctx.pgs[label]));
  }
  await attempt("proxyClose", () => ctx.proxy?.close().then(() => "closed"));
  await attempt("providerClose", () => ctx.provider.close().then(() => "closed"));
  await sleep(1_500);
  record.listenersOnOurPorts = listeners([...Object.values(ctx.ports), ctx.provider.port]);
  return record;
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "taki-restore-drill-"));
  const before = { pg0Registry: listPg0Registry(), ownerTaki: listOwnerTaki(), processes: processSnapshot() };
  const apiKey = randomBytes(32).toString("base64url");
  const credentialsDir = join(root, "credentials");
  const dirs = { coreA: join(root, "core-A"), coreR: join(root, "core-R"), coreO: join(root, "core-O") };
  mkdirSync(credentialsDir);
  mkdirSync(dirs.coreA);
  writeFileSync(join(credentialsDir, "taki-secret-catalog-master-key"), randomBytes(32));
  const provider = await startFakeProvider();
  const ports = await allocatePorts(provider);
  const ctx = { root, apiKey, provider, ports, dirs, credentialsDir, pgs: {}, natives: {}, cores: {}, coreExits: [], spawned: [], endpointPort: ports.proxy };
  lifecycle(ctx);
  console.log(`[drill] temp root ${root}`);
  let fatal = null;
  try {
    ctx.proxy = await startProxy(ports.nativeA, ports.proxy);
    ctx.journey = createJourney(ctx);
    const pg = ctx.startPg("A");
    await ctx.startNative("A", { pg });
    await ctx.bootCore("A");
    await journey(ctx);
  } catch (error) {
    fatal = { message: error.message, stack: error.stack };
    console.log(`[drill] FATAL ${error.message}`);
  } finally {
    const egress = Object.fromEntries(Object.entries(ctx.natives).map(([label, native]) => [label, nativeEgress(native)]));
    const adminEgress = existsSync(join(root, "admin-egress.jsonl")) ? readFileSync(join(root, "admin-egress.jsonl"), "utf8").split(/\r?\n/).filter(Boolean) : [];
    const teardownRecord = await teardown(ctx);
    const after = { pg0Registry: listPg0Registry(), ownerTaki: listOwnerTaki(), processes: processSnapshot() };
    const beforePids = new Set(before.processes.map((entry) => entry.pid));
    const newPids = after.processes.filter((entry) => !beforePids.has(entry.pid) && entry.pid !== process.pid);
    await sleep(5_000);
    const steps = ctx.journey?.steps ?? [];
    const result = {
      status: fatal ? "fatal" : steps.length === 12 && steps.every((entry) => entry.status === "passed") ? "passed" : "failed",
      fatal, steps,
      nativeBootMs: Object.fromEntries(Object.entries(ctx.natives).map(([label, native]) => [label, native.bootMs ?? null])),
      isolation: {
        pg0: Object.fromEntries(Object.entries(ctx.pgs).map(([label, pg]) => [label, { name: pg.name, dataDirUnderTemp: pg.dataDir.startsWith(root), port: pg.port }])),
        ports: { ...ports, provider: provider.port, policy: portPolicy(Object.values(ports)) },
        pg0RegistryBefore: before.pg0Registry, pg0RegistryAfter: after.pg0Registry,
        pg0RegistryUnchanged: JSON.stringify(before.pg0Registry) === JSON.stringify(after.pg0Registry),
        ownerTakiUnchanged: JSON.stringify(before.ownerTaki) === JSON.stringify(after.ownerTaki), ownerTakiBefore: before.ownerTaki,
      },
      network: { nativeRefused: egress, adminRefused: adminEgress, coreEgress: ctx.coreExits.map(({ label, egress: counters }) => ({ label, counters })),
        providerRequests: provider.log.length, providerUnexpectedPaths: provider.log.filter((entry) => entry.kind === "unexpected-path").length },
      teardown: { ...teardownRecord, coreExits: ctx.coreExits.map(({ label, code, signal, forced }) => ({ label, code, signal, forced })),
        spawnedPids: ctx.spawned, spawnedStillRunning: running(ctx.spawned),
        newProcessesAfter: newPids, newProcessesStillRunningAfter5s: running(newPids.map((entry) => entry.pid)) },
    };
    copyEvidence(ctx, result);
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 1_000 });
    result.teardown.tempRootRemoved = !existsSync(root);
    writeFileSync(join(evidenceDir, "result.json"), JSON.stringify(result, null, 2).replaceAll(apiKey, "<throwaway-key-redacted>") + "\n", "utf8");
    console.log(`[drill] result ${result.status}; evidence ${evidenceDir}`);
    for (const entry of steps) console.log(`[drill]   ${entry.id} ${entry.status} ${entry.error?.message ?? ""}`);
  }
}

if (process.argv.includes("--core-child")) await runCoreChild(); else await main();
