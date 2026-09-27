/**
 * INPUT:  the drill context built by restore-drill.mjs (operators, owned pg0 instances, natives, proxy, Core data dirs)
 * OUTPUT: the AC11 drill steps: Hindsight onboarding and writes, route-b capture + admit + verify, an incomplete tracked
 *         retain (native landed, Core unconfirmed), route-c capture + verify, native restore into a fresh instance, restored
 *         Core boot, read-back, resume without a repeated native effect, recall + verify on the restored pair, and the
 *         behind-native negative
 * POS:    09-25-hindsight-backup-restore W6 drill — step bodies only; lifecycle, evidence and teardown live in restore-drill.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as shared from "../../../../../packages/shared/src/index.ts";
import { coreCensus, fileSha256, nativeDelta, prepareCoreCopy, readManifest } from "./drill-evidence.mjs";
import {
  activateHindsight, authority, bankView, brief, chat, check, listOperations, onboardLocal, setupHindsight, sleep, submit,
} from "./drill-journey.mjs";
import { probeNative, runAdmin } from "./smoke-native.mjs";

export const FACTS = {
  m1: "Drill fact one: the lighthouse keeper owns a red kayak.",
  m2: "Drill fact two: the lighthouse keeper grows basil on the balcony.",
  m3: "Drill fact three: the lighthouse keeper plays the cello on Sundays.",
};
const ROLLBACK = "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED";
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** The memory tool result is wrapped in an untrusted-observation block; capabilities are dropped as noise. */
function lastToolResult(ctx) {
  const text = ctx.provider.log.filter((entry) => entry.kind === "main-after-tool").at(-1)?.toolResult ?? null;
  const json = text?.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return { raw: text };
  try {
    const { capabilities: _capabilities, ...rest } = JSON.parse(json);
    return rest;
  } catch {
    return { raw: text.slice(0, 2_000) };
  }
}

async function syncAll(operator) {
  const { replica } = await authority(operator);
  const operations = [];
  for (const { bankId } of replica ?? []) operations.push(brief(await submit(operator, { kind: "replica.sync", bankId, syncKind: "incremental" })));
  return operations;
}

/**
 * Pending recovery runs inside replica.sync (the scheduler runner): sync every Bank until each sync completes and no
 * Pending or parent write remains. Returns every attempt so a refusal (HINDSIGHT_PENDING_REMAINS) stays visible.
 */
async function settle(operator, budget = 180_000) {
  const attempts = [];
  for (const deadline = Date.now() + budget; Date.now() < deadline; await sleep(2_000)) {
    const sync = await syncAll(operator);
    const { pending } = await authority(operator);
    attempts.push(sync.map(({ kind, state, errorCode }) => ({ kind, state, errorCode })));
    const drained = pending?.every((bank) => bank.summary.pendingCount === 0 && bank.parentWritesPending === 0);
    if (drained && sync.every((operation) => operation.state === "completed")) return { attempts, sync, pending };
  }
  throw Object.assign(new Error("pending writes did not settle through replica.sync"), { detail: attempts.slice(-3) });
}

async function retainAndSettle(ctx, observed, fact) {
  const run = await chat(ctx.operator, "taki", `[retain] ${fact}`);
  observed.chat = run;
  observed.toolResult = lastToolResult(ctx);
  check(run.outcome === shared.CHAT_METHODS.complete, "retaining Run failed", run);
  check(observed.toolResult.ok === true, "the retain tool result is not ok", observed.toolResult);
  const settled = await settle(ctx.operator);
  observed.syncAttempts = settled.attempts;
  observed.pendingAfter = settled.pending;
}

export async function stepOnboard(ctx, observed) {
  const legacy = await authority(ctx.operator);
  observed.initial = legacy.authority;
  check(legacy.authority.mode === "legacy-markdown", "not Legacy at first boot", legacy.authority);
  await onboardLocal(ctx.operator, observed);
  await setupHindsight(ctx, observed);
  await activateHindsight(ctx, observed);
}

export const stepWriteOne = (ctx, observed) => retainAndSettle(ctx, observed, FACTS.m1);
export const stepWriteTwo = (ctx, observed) => retainAndSettle(ctx, observed, FACTS.m2);

export async function stepRouteB(ctx, observed) {
  const { operator } = ctx;
  const capture = await submit(operator, { kind: "backup.capture", expectedEpochId: ctx.epochId, route: "operator-artifact" });
  observed.capture = brief(capture);
  check(capture.state === "completed", "route-b backup.capture did not complete", observed.capture);
  const { backupId } = capture.result;
  const staged = join(ctx.dirs.coreA, "backups", `${backupId}.staged`);
  observed.stagedFiles = readdirSync(staged).sort();
  const fileName = "taki-drill-b1.zip";
  const zip = join(ctx.root, fileName);
  const cli = runAdmin({ root: ctx.root, pgPort: ctx.pgs.A.port, apiKey: ctx.apiKey, label: "backup-route-b",
    args: ["backup", zip, "--schema", "public", "--taki-request", join(staged, "native-request.json")] });
  observed.cli = { args: ["backup", fileName, "--schema", "public", "--taki-request", "native-request.json"], status: cli.status, ms: cli.ms };
  check(cli.status === 0, "hindsight-admin backup failed", observed.cli);
  mkdirSync(join(ctx.dirs.coreA, "backups", "inbox"), { recursive: true });
  copyFileSync(zip, join(ctx.dirs.coreA, "backups", "inbox", fileName));
  const admit = await submit(operator, { kind: "backup.admit", expectedEpochId: ctx.epochId, backupId, fileName });
  observed.admit = brief(admit);
  check(admit.state === "completed" && admit.result?.verifiedAt, "backup.admit did not seal a verified pair", observed.admit);
  const verify = await submit(operator, { kind: "backup.verify", backupId });
  observed.verify = brief(verify);
  check(verify.state === "completed" && verify.result?.verifiedAt && verify.result.mismatch === null, "route-b backup.verify failed", observed.verify);
  const manifest = readManifest(ctx.dirs.coreA, backupId);
  observed.manifest = manifestView(manifest);
  ctx.backup1 = { backupId, zip, manifest };
}

function manifestView(manifest) {
  return manifest && { backupId: manifest.backupId, route: manifest.route, native: { location: manifest.native.location, file: manifest.native.file,
    zipSha256: manifest.native.proof.zipSha256, receipts: manifest.native.proof.receipts, banks: manifest.native.proof.banks },
  authority: { epochId: manifest.authority.epochId, providerLineageId: manifest.authority.providerLineageId },
  banks: manifest.banks, terminalOperations: manifest.terminalOperations, core: manifest.core, verifiedAt: manifest.verifiedAt };
}

/** A tracked retain whose native effect lands while every later request for its Bank is reset: Core cannot confirm it. */
export async function stepIncomplete(ctx, observed) {
  const before = probeNative({ pgPort: ctx.pgs.A.port });
  ctx.proxy.armRetainBlock();
  const run = await chat(ctx.operator, "taki", `[retain] ${FACTS.m3}`);
  observed.chat = run;
  observed.toolResult = lastToolResult(ctx);
  observed.blockedBank = ctx.proxy.blockedBank();
  check(observed.blockedBank, "the tracked retain never reached native through the proxy");
  let after;
  for (const deadline = Date.now() + 240_000; Date.now() < deadline; await sleep(2_000)) {
    after = probeNative({ pgPort: ctx.pgs.A.port });
    const landed = nativeDelta(before, after).newReceiptIds.length > 0;
    if (landed && after.asyncOperations.every((row) => !["pending", "processing"].includes(row.status))) break;
  }
  observed.nativeDelta = nativeDelta(before, after);
  observed.asyncOperations = after.asyncOperations;
  const receipt = after.nativeReceipts.find((row) => observed.nativeDelta.newReceiptIds.includes(`${row.bank_id}:${row.operation_kind}:${row.operation_id}`));
  observed.receipt = receipt ?? null;
  check(receipt, "no native receipt for the blocked retain", observed.nativeDelta);
  check(after.asyncOperations.every((row) => row.status === "completed"), "the native retain did not finish", after.asyncOperations);
  const pending = coreCensus(ctx.dirs.coreA).pending.find((row) => row.remote === receipt.operation_id);
  observed.corePending = pending ?? null;
  check(pending && pending.phase !== "completed", "Core already settled the blocked retain", pending);
  ctx.m3 = { remote: receipt.operation_id, bankId: receipt.bank_id, pendingOperationId: pending.operation_id };
}

export async function stepRouteC(ctx, observed) {
  const { operator } = ctx;
  const status = await authority(operator);
  const pre = { authority: status.authority, banks: bankView(status), replica: status.replica, pending: status.pending,
    core: coreCensus(ctx.dirs.coreA), native: probeNative({ pgPort: ctx.pgs.A.port }) };
  const capture = await submit(operator, { kind: "backup.capture", expectedEpochId: ctx.epochId });
  observed.capture = brief(capture);
  check(capture.state === "completed" && capture.result?.mismatch === null, "route-c backup.capture failed", observed.capture);
  const { backupId } = capture.result;
  const verify = await submit(operator, { kind: "backup.verify", backupId });
  observed.verify = brief(verify);
  check(verify.state === "completed" && verify.result?.verifiedAt && verify.result.mismatch === null, "route-c backup.verify failed", observed.verify);
  const manifest = readManifest(ctx.dirs.coreA, backupId);
  observed.manifest = manifestView(manifest);
  const zip = join(ctx.natives.A.backupDir, manifest.native.file);
  observed.nativeHostZip = { file: manifest.native.file, exists: existsSync(zip), sha256Matches: existsSync(zip) && fileSha256(zip) === manifest.native.proof.zipSha256 };
  check(observed.nativeHostZip.sha256Matches, "the native-host ZIP does not match the manifest digest", observed.nativeHostZip);
  const post = probeNative({ pgPort: ctx.pgs.A.port });
  observed.nativeChangedAcrossCapture = nativeDelta(pre.native, post);
  observed.m3Listed = manifest.terminalOperations.count;
  observed.backupStatus = (await authority(operator)).hindsight?.backup ?? null;
  ctx.backup2 = { backupId, zip, manifest, operationId: capture.operationId };
  ctx.record = { ...pre, nativeAfterCapture: post };
  observed.record = { authority: pre.authority, banks: pre.banks, checkpoints: pre.core.checkpoints, corePending: pre.core.pending,
    nativeBankState: pre.native.bankState, nativeApplicationBanks: pre.native.applicationBanks, nativeReceipts: pre.native.nativeReceipts,
    documents: pre.native.documents, memoryUnits: pre.native.memoryUnits };
}

export async function stepStopOriginal(ctx, observed) {
  ctx.operator.close();
  ctx.operator = null;
  observed.coreExit = await ctx.stopCore("A");
  observed.corePendingAfterStop = coreCensus(ctx.dirs.coreA).pending;
  observed.nativeExit = await ctx.stopNative("A");
  ctx.proxy.disarm();
}

/** Fresh instance -> migrate -> native restore -> per-Bank vector index repair -> release claimed tasks. */
async function restoreInto(ctx, label, zip) {
  const pg = ctx.startPg(label);
  const runs = [["migrate", ["run-db-migration"]], ["restore", ["restore", zip, "--yes"]], ["repair", ["repair-bank", "--all"]],
    ["decommission", ["decommission-workers", "--yes"]]].map(([name, args]) => {
    const run = runAdmin({ root: ctx.root, pgPort: pg.port, apiKey: ctx.apiKey, label: `${name}-${label}`, args });
    return { name, args: args.map((arg) => (arg === zip ? `<${label === "R" ? "route-c" : "route-b"} ZIP>` : arg)), status: run.status, ms: run.ms };
  });
  return { pg, runs };
}

export async function stepRestore(ctx, observed) {
  const { pg, runs } = await restoreInto(ctx, "R", ctx.backup2.zip);
  observed.pg0 = { name: pg.name, port: pg.port };
  observed.admin = runs;
  check(runs.every((run) => run.status === 0), "a native restore command failed", runs);
  const census = probeNative({ pgPort: pg.port });
  ctx.restoredCensus = census;
  const keys = ["lineage", "banks", "bankState", "applicationBanks", "documents", "memoryUnits", "memoryUnitTexts", "nativeReceipts",
    "mutationReceipts", "applicationOperations", "changesPerBank"];
  observed.restoredEqualsCapture = Object.fromEntries(keys.map((key) => [key, same(census[key], ctx.record.native[key])]));
  observed.asyncOperations = { captured: ctx.record.native.asyncOperations, restored: census.asyncOperations };
  check(Object.values(observed.restoredEqualsCapture).every(Boolean), "the restored native rows differ from the capture-time rows", observed.restoredEqualsCapture);
  const native = await ctx.startNative("R", { pg, workerId: "taki-drill-restored" });
  copyFileSync(ctx.backup2.zip, join(native.backupDir, ctx.backup2.manifest.native.file));
  observed.nativeBootMs = native.bootMs;
  ctx.proxy.retarget(native.port);
  const copy = prepareCoreCopy({ source: ctx.dirs.coreA, target: ctx.dirs.coreR, backupId: ctx.backup2.backupId });
  observed.coreCopy = { sha256Matches: copy.coreSha256 === ctx.backup2.manifest.core.sha256 };
  check(observed.coreCopy.sha256Matches, "core.sqlite does not match its manifest digest");
  ctx.proxyOffset = ctx.proxy.log.length;
  await ctx.bootCore("R");
}

export async function stepReadBack(ctx, observed) {
  let status;
  for (const deadline = Date.now() + 90_000; Date.now() < deadline; await sleep(500)) {
    status = await authority(ctx.operator);
    if (status.runtime.available) break;
  }
  observed.authority = status.authority;
  observed.runtime = status.runtime;
  observed.banks = bankView(status);
  observed.authorityMatches = same(status.authority, ctx.record.authority);
  observed.banksMatch = same(observed.banks, ctx.record.banks);
  const core = coreCensus(ctx.dirs.coreR);
  const identity = (rows) => rows.map(({ bank_id, provider_lineage_id, bank_generation, authority_epoch_id }) => ({ bank_id, provider_lineage_id, bank_generation, authority_epoch_id }));
  observed.checkpoints = { captured: ctx.record.core.checkpoints, restored: core.checkpoints };
  observed.checkpointIdentityMatches = same(identity(core.checkpoints), identity(ctx.record.core.checkpoints));
  observed.cursorsNotBehind = core.checkpoints.every((row) => row.end_cursor >= (ctx.record.core.checkpoints.find((old) => old.bank_id === row.bank_id)?.end_cursor ?? 0));
  observed.replicaRecordsMatch = same(core.records, ctx.record.core.records);
  observed.memoryTextsMatch = same(core.memoryUnitTexts, ctx.record.core.memoryUnitTexts);
  observed.manifestBanksVsNative = ctx.backup2.manifest.banks.map((bank) => {
    const native = ctx.restoredCensus.bankState.find((row) => row.bank_id === bank.nativeBankId);
    return { bankId: bank.bankId, nativeBankId: bank.nativeBankId, generationMatches: native?.generation === bank.bankGeneration,
      replicaCursor: bank.core.replicaCursor, nativeCurrentCursor: native?.current_cursor ?? null };
  });
  observed.rollbackInLog = ctx.cores.R.log().includes(ROLLBACK);
  const operations = await listOperations(ctx.operator);
  observed.captureOperationOnRestoredCopy = brief(operations.find((row) => row.operationId === ctx.backup2.operationId) ?? {});
  check(status.runtime.available, "restored runtime is not available", status.runtime);
  check(observed.authorityMatches && observed.banksMatch, "authority or Bank identity differs after restore", { authority: status.authority, banks: observed.banks });
  check(observed.checkpointIdentityMatches && observed.cursorsNotBehind, "replica checkpoints differ after restore", observed.checkpoints);
  check(observed.manifestBanksVsNative.every((bank) => bank.generationMatches), "native generation differs from the manifest", observed.manifestBanksVsNative);
  check(!observed.rollbackInLog, "rollback detection fired on the matched pair");
}

export async function stepResume(ctx, observed) {
  observed.pendingBeforeResume = (await authority(ctx.operator)).pending;
  const settled = await settle(ctx.operator);
  observed.syncAttempts = settled.attempts;
  const core = coreCensus(ctx.dirs.coreR);
  observed.m3 = core.pending.find((row) => row.remote === ctx.m3.remote) ?? null;
  const after = probeNative({ pgPort: ctx.pgs.R.port });
  observed.nativeDelta = nativeDelta(ctx.restoredCensus, after);
  observed.asyncOperations = after.asyncOperations;
  const calls = ctx.proxy.log.slice(ctx.proxyOffset);
  observed.m3Calls = calls.filter((entry) => entry.path.includes(ctx.m3.remote)).map(({ method, path, status }) => ({ method, path, status }));
  observed.retainPosts = calls.filter((entry) => entry.method === "POST" && entry.path.endsWith("/retains")).length;
  observed.rollbackInLog = ctx.cores.R.log().includes(ROLLBACK);
  check(observed.m3?.phase === "completed", "the unconfirmed retain did not complete after restore", observed.m3);
  const delta = observed.nativeDelta;
  check(delta.nativeReceipts === 0 && delta.asyncOperations === 0 && delta.documents === 0 && delta.memoryUnits === 0,
    "the native side shows a repeated effect", delta);
  check(!observed.rollbackInLog, "rollback detection fired while resuming");
}

export async function stepRestoredUse(ctx, observed) {
  const run = await chat(ctx.operator, "taki", "[recall] What does the lighthouse keeper do?");
  observed.recall = run;
  observed.toolResult = lastToolResult(ctx);
  const text = JSON.stringify(observed.toolResult);
  observed.recalled = Object.fromEntries(Object.entries(FACTS).map(([key, fact]) => [key, text.includes(fact.split(": ")[1].slice(0, 30))]));
  const verify = await submit(ctx.operator, { kind: "backup.verify", backupId: ctx.backup2.backupId });
  observed.verifyOnRestored = brief(verify);
  observed.backupStatus = (await authority(ctx.operator)).hindsight?.backup ?? null;
  check(run.outcome === shared.CHAT_METHODS.complete && observed.toolResult.ok === true, "recall on the restored pair failed", observed.toolResult);
  check(verify.state === "completed" && verify.result?.verifiedAt, "backup.verify on the restored host failed", observed.verifyOnRestored);
}

export async function stepNegative(ctx, observed) {
  ctx.operator.close();
  ctx.operator = null;
  observed.restoredCoreExit = await ctx.stopCore("R");
  observed.restoredNativeExit = await ctx.stopNative("R");
  const { pg, runs } = await restoreInto(ctx, "O", ctx.backup1.zip);
  observed.admin = runs;
  check(runs.every((run) => run.status === 0), "a native restore command failed", runs);
  const census = probeNative({ pgPort: pg.port });
  observed.olderNative = census.bankState;
  const native = await ctx.startNative("O", { pg, workerId: "taki-drill-older" });
  ctx.proxy.retarget(native.port);
  prepareCoreCopy({ source: ctx.dirs.coreA, target: ctx.dirs.coreO, backupId: ctx.backup2.backupId });
  const checkpoints = coreCensus(ctx.dirs.coreO).checkpoints;
  observed.coreAhead = checkpoints.map((row) => ({ bankId: row.bank_id, coreCursor: row.end_cursor,
    nativeCursor: census.bankState.find((bank) => bank.bank_id === row.bank_id)?.current_cursor ?? null }));
  const offset = ctx.proxy.log.length;
  await ctx.bootCore("O");
  await sleep(10_000);
  const status = await authority(ctx.operator);
  observed.runtime = status.runtime;
  observed.banks = bankView(status);
  observed.replica = status.replica;
  observed.sync = [];
  for (const { bankId } of observed.coreAhead) observed.sync.push(brief(await submit(ctx.operator, { kind: "replica.sync", bankId, syncKind: "incremental" })));
  const calls = ctx.proxy.log.slice(offset);
  observed.snapshotCalls = calls.filter((entry) => entry.path.includes("/snapshots")).length;
  observed.changesCalls = calls.filter((entry) => entry.path.endsWith("/changes")).map(({ method, path, status: code }) => ({ method, path, status: code }));
  observed.checkpointsUnchanged = same(coreCensus(ctx.dirs.coreO).checkpoints, checkpoints);
  observed.rollbackInLog = ctx.cores.O.log().includes(ROLLBACK);
  const ahead = observed.coreAhead.filter((bank) => bank.nativeCursor !== null && bank.coreCursor > bank.nativeCursor).map((bank) => bank.bankId);
  observed.aheadBanks = ahead;
  check(ahead.length > 0, "the older native is not behind Core; the negative is not set up", observed.coreAhead);
  check(observed.sync.some((operation) => operation.errorCode === ROLLBACK) || observed.rollbackInLog, "rollback detection did not fire", observed.sync);
  check(observed.snapshotCalls === 0 && observed.checkpointsUnchanged, "a replica rebuild ran against the older native", observed);
}
