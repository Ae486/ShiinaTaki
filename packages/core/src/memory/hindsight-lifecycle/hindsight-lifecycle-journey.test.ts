import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryAuthorityStatusSchema, type MemoryOperation } from "@taki/shared";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../db/hindsight-connection-repo.ts";
import { createHindsightIngestionSourceRepo } from "../../db/hindsight-ingestion-source-repo.ts";
import { createHindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { scriptedGenerateModel } from "../../testing/mock-language-model.ts";
import {
  JOURNEY_CHARACTER, TOOL_OPTIONS, configureHindsight, createHindsightActivationJourney, onboardLocal, type HindsightActivationJourney, type JourneySession,
} from "../hindsight-activation/hindsight-activation-journey-fixture.ts";
import { hindsightBankBindings } from "../hindsight/hindsight-bank-identity.ts";
import * as hindsightSubsystem from "../hindsight/hindsight-memory-subsystem.ts";
import type { HindsightSubsystem } from "../hindsight-runtime-binding.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";

const journeys: HindsightActivationJourney[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const journey of journeys.splice(0)) await journey.close(); });
function journey(...args: Parameters<typeof createHindsightActivationJourney>) { const value = createHindsightActivationJourney(...args); journeys.push(value); return value; }

const MIKA = "mika";
const [GLOBAL_BANK, MIKA_BANK] = hindsightBankBindings(MIKA).map((binding) => binding.externalBankId) as [string, string];
const TAKI_BANK = hindsightBankBindings(JOURNEY_CHARACTER)[1].externalBankId;
const keepSpan = (fromSeq: number, throughSeq: number) => ({ kind: "text" as const, deltas: [JSON.stringify({ decision: "keep", route: "both", fromSeq, throughSeq })] });

/** Every Hindsight subsystem the composition constructs, so a test can drive its flush port and scheduler. */
function observeHindsightSubsystems(): HindsightSubsystem[] {
  const built: HindsightSubsystem[] = []; const construct = hindsightSubsystem.createHindsightMemorySubsystem;
  vi.spyOn(hindsightSubsystem, "createHindsightMemorySubsystem").mockImplementation((input) => { const value = construct(input); built.push(value); return value; });
  return built;
}

/** Legacy -> Local -> configured B3 (Global + taki) -> Hindsight authority through the registered kinds. */
async function activatedInstance(j: HindsightActivationJourney): Promise<{ session: JourneySession; epochId: string }> {
  const session = j.session;
  const localEpochId = await onboardLocal(session);
  const run = await session.runtime.captureRun(JOURNEY_CHARACTER);
  expect(await run.tools.retain!.execute!({ content: "用户最近在准备一场演讲。", layer: "episodes", context: null }, TOOL_OPTIONS)).toMatchObject({ ok: true });
  await configureHindsight(session);
  const activated = await session.settled({ kind: "hindsight.activate", source: { mode: "new", setupRevision: session.setup.status().revision, expectedEpochId: localEpochId } });
  expect(activated).toMatchObject({ state: "completed", result: { outcome: "activated" } });
  return { session, epochId: readMemoryAuthoritySelection(session.db).epochId! };
}

const bank = (session: JourneySession, characterId: string) => session.authorityStatus().hindsight?.banks.find((entry) => entry.characterId === characterId);
const nativeCalls = (j: HindsightActivationJourney) => (["common", "bank-put", "bank-stats", "template-import", "template-export"] as const)
  .reduce((total, route) => total + j.transport.calls(route), 0) + j.application.calls.length;
const bankRows = (session: JourneySession) => JSON.stringify(createHindsightBankSetupRepo(session.db).list());
/** The provider answers /health as down (first common route of every admission). */
const UNHEALTHY = { status: 503, body: JSON.stringify({ status: "unhealthy", database: "disconnected" }) };
const revalidate = (session: JourneySession, epochId: string) => session.settled({ kind: "connection.revalidate", expectedEpochId: epochId });

function expectStatusValid(session: JourneySession) {
  const status = session.authorityStatus();
  expect(MemoryAuthorityStatusSchema.parse(status)).toEqual(status);
  return status;
}

/** Makes every automatic Bank fail one catch-up run on an unreachable provider, parking it in availability backoff. */
async function parkBanks(j: HindsightActivationJourney, subsystem: HindsightSubsystem) {
  const repo = createHindsightReplicaSchedulerRepo(j.session.db);
  j.application.control.offline = true;
  for (const bankId of [GLOBAL_BANK, TAKI_BANK]) repo.requestCatchUp(bankId);
  subsystem.scheduler.verifiedReconnect();
  await subsystem.scheduler.tick();
  j.application.control.offline = false;
}

describe("Stage 2c — new-Character Bank provisioning", () => {
  it.each(["bank.provision", "connection.revalidate"] as const)("retirement detaches a hung %s and prevents its late export from publishing or dispatching again", async (kind) => {
    const j = journey({ characters: [MIKA] }); const { session, epochId } = await activatedInstance(j);
    const exportTemplate = j.client.exportTemplate.bind(j.client); let release!: () => void;
    vi.spyOn(j.client, "exportTemplate").mockImplementationOnce(async (...args) => {
      const value = await exportTemplate(...args); return new Promise((resolve) => { release = () => resolve(value); });
    });
    session.operations.submit(kind === "bank.provision" ? { kind, characterId: MIKA } : { kind, expectedEpochId: epochId });
    await vi.waitFor(() => expect(release).toBeDefined());
    session.lifecycle.retireEpoch?.(epochId); await session.lifecycle.stop();
    const before = { banks: bankRows(session), reviewed: createHindsightConnectionRepo(session.db).reviewed(), calls: nativeCalls(j) };
    release(); await session.operations.stop(); await new Promise<void>((resolve) => setImmediate(resolve));
    expect({ banks: bankRows(session), reviewed: createHindsightConnectionRepo(session.db).reviewed(), calls: nativeCalls(j) }).toEqual(before);
  });

  it("degrades a new Character, provisions a fresh Bank that binds, recalls Global + Character and ingests the degraded turn once", async () => {
    const j = journey({ characters: [MIKA], model: scriptedGenerateModel([keepSpan(1, 2)]) });
    const subsystems = observeHindsightSubsystems();
    const { session, epochId } = await activatedInstance(j);
    const degraded = await session.runtime.captureRun(MIKA);
    expect(degraded.snapshot.capabilities.recall).toBe(false);
    const entries = session.chat("我叫美嘉，喜欢猫", "记住了，你喜欢猫", MIKA);
    const witnesses = createHindsightIngestionSourceRepo(session.db); const scope = { epochId, characterId: MIKA };
    expect(witnesses.unprocessedCount(scope)).toBe(2);
    const before = expectStatusValid(session);
    expect(bank(session, MIKA)).toMatchObject({ readiness: "not_provisioned", nativeBankId: MIKA_BANK });
    expect(before.hindsight?.actions).toEqual({ revalidate: false, provision: [MIKA] });

    const puts = j.transport.calls("bank-put");
    const provisioned = await session.settled({ kind: "bank.provision", characterId: MIKA });
    expect(provisioned).toMatchObject({ state: "completed", reason: null, errorCode: null,
      result: { kind: "bank", characterId: MIKA, nativeBankId: MIKA_BANK, readiness: "ready" },
      producer: { kind: "bank", origin: "operator", phase: "completed", admittedEpochId: epochId, templateRevision: "taki-bank-v1" } });
    expect(j.transport.calls("bank-stats")).toBe(1);
    expect(j.transport.calls("bank-put")).toBe(puts + 1);
    expect(bank(session, MIKA)).toMatchObject({ readiness: "ready", errorCode: null });
    expect(expectStatusValid(session).hindsight?.actions).toEqual({ revalidate: false, provision: [] });
    expect(() => session.operations.submit({ kind: "bank.provision", characterId: MIKA })).toThrow("MEMORY_OPERATION_UNSUPPORTED");

    const calls = j.application.calls.length;
    const run = await session.runtime.captureRun(MIKA);
    expect(run.snapshot).toMatchObject({ providerId: "hindsight", authorityEpochId: epochId, capabilities: { recall: true } });
    expect(new Set(j.application.calls.slice(calls).filter((call) => call.operation === "changes").map((call) => call.bankId))).toEqual(new Set([GLOBAL_BANK, MIKA_BANK]));

    j.application.control.offline = true;
    const range = { characterId: MIKA, fromSeq: entries[0]!.seq, throughSeq: entries[1]!.seq };
    expect(await subsystems.at(-1)!.memoryFlush.prepareRetirement({ ...range, operationId: "mika-flush" })).toMatchObject({ status: "success", writes: 2 });
    expect(witnesses.unprocessedCount(scope)).toBe(0);
    expect(await subsystems.at(-1)!.memoryFlush.prepareRetirement({ ...range, operationId: "mika-flush-again" })).toMatchObject({ status: "success", writes: 0 });
    expect(j.model.doGenerateCalls).toHaveLength(1);
  });

  it("refuses at admission under a Local marker, a drifted connection and an already ready Bank, with no row", async () => {
    const j = journey({ characters: [MIKA] });
    const session = j.session;
    await onboardLocal(session);
    expect(() => session.operations.submit({ kind: "bank.provision", characterId: MIKA })).toThrow("MEMORY_OPERATION_UNSUPPORTED");
    await configureHindsight(session);
    const activated = await session.settled({ kind: "hindsight.activate", source: { mode: "new", setupRevision: session.setup.status().revision,
      expectedEpochId: readMemoryAuthoritySelection(session.db).epochId! } });
    expect(activated.state).toBe("completed");
    // The first Run binds the activated replicas; a ready Bank is never provisioned again.
    expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(true);
    expect(() => session.operations.submit({ kind: "bank.provision", characterId: JOURNEY_CHARACTER })).toThrow("MEMORY_OPERATION_UNSUPPORTED");
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    expect(() => session.operations.submit({ kind: "bank.provision", characterId: MIKA })).toThrow("MEMORY_OPERATION_UNSUPPORTED");
    expect(session.operations.list({ includeTerminal: true, limit: 20 }).filter((operation) => operation.kind === "bank.provision")).toEqual([]);
  });

  it("refuses an occupied Bank with no PUT and no row, and a template conflict with zero native calls", async () => {
    const j = journey({ characters: [MIKA] });
    const { session } = await activatedInstance(j);
    session.chat("你好", "你好，美嘉", MIKA);
    j.transport.occupy(MIKA_BANK);
    const puts = j.transport.calls("bank-put");
    const occupied = await session.settled({ kind: "bank.provision", characterId: MIKA });
    expect(occupied).toMatchObject({ state: "failed", reason: "producer_refused", errorCode: "HINDSIGHT_BANK_OCCUPIED", result: null, producer: { phase: "probing" } });
    expect(j.transport.calls("bank-put")).toBe(puts);
    expect(createHindsightBankSetupRepo(session.db).get(`character:${MIKA}`)).toBeNull();
    expect(bank(session, MIKA)).toMatchObject({ readiness: "not_provisioned" });

    const calls = nativeCalls(j);
    const admitted = session.operations.submit({ kind: "bank.provision", characterId: MIKA });
    // Changed between admission and the deferred claim: the producer's local guard refuses before any native call.
    session.config.upsert("TAKI_HINDSIGHT_TEMPLATE_REVISION", "taki-bank-v2");
    await session.operations.stop();
    expect(session.operations.status(admitted.operationId)).toMatchObject({ state: "failed", reason: "producer_refused", errorCode: "HINDSIGHT_TEMPLATE_CONFLICT" });
    expect(nativeCalls(j)).toBe(calls);
    expect(createHindsightBankSetupRepo(session.db).get(`character:${MIKA}`)).toBeNull();
  });

  it("leaves a failed row on a rejected dry-run while the other Banks keep serving, then provisions idempotently after a first-sync failure", async () => {
    const j = journey({ characters: [MIKA] });
    const { session } = await activatedInstance(j);
    j.transport.fail("template-import", { response: { status: 422, body: JSON.stringify({ detail: "template rejected" }) } });
    const rejected = await session.settled({ kind: "bank.provision", characterId: MIKA });
    expect(rejected).toMatchObject({ state: "failed", reason: "producer_failed", result: { readiness: "failed" } });
    expect(createHindsightBankSetupRepo(session.db).get(`character:${MIKA}`)).toMatchObject({ status: "failed" });
    expect(bank(session, MIKA)).toMatchObject({ readiness: "failed" });
    expect(expectStatusValid(session).hindsight?.actions.provision).toEqual([MIKA]);
    expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(true);

    j.application.control.offline = true;
    const unsynced = await session.settled({ kind: "bank.provision", characterId: MIKA });
    expect(unsynced).toMatchObject({ state: "failed", reason: "producer_failed", result: { readiness: "syncing" }, producer: { phase: "syncing" } });
    // The replica run's own code: the provider was unreachable for the first full sync.
    expect(unsynced.errorCode).toBe("HINDSIGHT_UNREACHABLE");
    expect(bank(session, MIKA)).toMatchObject({ readiness: "syncing" });
    const puts = j.transport.calls("bank-put");
    j.application.control.offline = false;
    const retried = await session.settled({ kind: "bank.provision", characterId: MIKA });
    expect(retried).toMatchObject({ state: "completed", result: { readiness: "ready" } });
    expect(j.transport.calls("bank-put")).toBe(puts);
    expect(bank(session, MIKA)).toMatchObject({ readiness: "ready" });
  });
});

describe("Stage 2c — connection revalidation and rebind", () => {
  it("degrades on a changed timeout, revalidates without touching Bank rows, stops the old scheduler once and ingests the witnessed turn once", async () => {
    const j = journey({ model: scriptedGenerateModel([keepSpan(1, 2)]) });
    const subsystems = observeHindsightSubsystems();
    const { session, epochId } = await activatedInstance(j);
    const rows = bankRows(session);
    const oldStop = vi.spyOn(subsystems[0]!.scheduler, "stop");
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    const drifted = expectStatusValid(session);
    expect(drifted).toMatchObject({ runtime: { available: false, unavailableReason: "config_changed" }, hindsight: { actions: { revalidate: true } } });
    expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(false);
    const entries = session.chat("连接改了之后的对话", "我还记得", JOURNEY_CHARACTER);
    const witnesses = createHindsightIngestionSourceRepo(session.db); const scope = { epochId, characterId: JOURNEY_CHARACTER };
    expect(witnesses.unprocessedCount(scope)).toBe(2);

    const operation = await revalidate(session, epochId);
    const live = session.runtime.operations()!;
    expect(operation).toMatchObject({ state: "completed", result: { kind: "connection", outcome: "rebound", fingerprint: live.configFingerprint },
      producer: { origin: "operator", epochId, phase: "completed", fingerprintAfter: live.configFingerprint } });
    expect((operation.producer as { fingerprintBefore: string }).fingerprintBefore).not.toBe(live.configFingerprint);
    expect(subsystems).toHaveLength(2);
    expect(oldStop).toHaveBeenCalledTimes(1);
    expect(bankRows(session)).toBe(rows);
    expect(expectStatusValid(session)).toMatchObject({ runtime: { available: true, unavailableReason: null }, hindsight: { actions: { revalidate: false } } });
    expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(true);

    j.application.control.offline = true;
    const range = { characterId: JOURNEY_CHARACTER, fromSeq: entries[0]!.seq, throughSeq: entries[1]!.seq };
    expect(await subsystems[1]!.memoryFlush.prepareRetirement({ ...range, operationId: "drift-flush" })).toMatchObject({ status: "success", writes: 2 });
    expect(witnesses.unprocessedCount(scope)).toBe(0);
    expect(await subsystems[1]!.memoryFlush.prepareRetirement({ ...range, operationId: "drift-flush-again" })).toMatchObject({ status: "success", writes: 0 });
    expect(j.model.doGenerateCalls).toHaveLength(1);
  });

  it("replaces the binding under an in-flight Run: the old Run's memory calls fail structured, the next Run is served", async () => {
    const j = journey();
    const subsystems = observeHindsightSubsystems();
    const { session, epochId } = await activatedInstance(j);
    const inflight = await session.runtime.captureRun(JOURNEY_CHARACTER);
    expect(inflight.snapshot.capabilities.recall).toBe(true);
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    expect(await revalidate(session, epochId)).toMatchObject({ state: "completed", result: { outcome: "rebound" } });
    expect(subsystems).toHaveLength(2);
    const query = { query: "演讲", scope: "both", limit: 8, maxTokens: 1024 };
    // The retired subsystem's consumer drain refuses with the closed code only, exactly as at shutdown; nothing reaches the
    // provider through the replaced connection.
    const calls = j.application.calls.length;
    await expect(Promise.resolve(inflight.tools.recall!.execute!(query, TOOL_OPTIONS))).rejects.toThrow(/^MEMORY_OPERATION_CANCELLED$/);
    await expect(Promise.resolve(inflight.tools.retain!.execute!({ content: "旧 Run 的写入", layer: "episodes", context: null }, TOOL_OPTIONS)))
      .resolves.toMatchObject({ ok: false, code: "MEMORY_AUTHORITY_FENCED" });
    expect(j.application.calls.length).toBe(calls);
    const next = await session.runtime.captureRun(JOURNEY_CHARACTER);
    expect(await next.tools.recall!.execute!(query, TOOL_OPTIONS)).toMatchObject({ ok: true });
  });

  it("settles a replacement that fails to build as failed runtime_unavailable, leaves the binding unavailable and offers recoverBinding", async () => {
    const j = journey();
    const { session, epochId } = await activatedInstance(j);
    const construct = vi.spyOn(hindsightSubsystem, "createHindsightMemorySubsystem").mockImplementationOnce(() => { throw new Error("MEMORY_INTEGRITY_ERROR: draft"); });
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    const operation = await revalidate(session, epochId);
    expect(operation).toMatchObject({ state: "failed", reason: "runtime_unavailable", result: { kind: "connection", outcome: "binding_unavailable" },
      producer: { phase: "rebinding" } });
    expect(session.runtime.operations()).toBeNull();
    expect(session.runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "unavailable", epochId, code: "MEMORY_INTEGRITY_ERROR" });
    await expect(session.runtime.captureRun(JOURNEY_CHARACTER)).rejects.toThrow("MEMORY_RUNTIME_UNAVAILABLE");
    expect(readMemoryAuthoritySelection(session.db)).toMatchObject({ mode: "hindsight", epochId });
    expect(session.activationStatus().actions.recoverBinding).toBe(true);
    construct.mockRestore();
    expect(await session.settled({ kind: "hindsight.activate", source: { mode: "recover", epochId } })).toMatchObject({ state: "completed" });
    expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(true);
  });

  it("refuses a disabled connection, a deployment-mode change and a template change with the authority and binding kept", async () => {
    const j = journey();
    const subsystems = observeHindsightSubsystems();
    const { session, epochId } = await activatedInstance(j);
    const selection = readMemoryAuthoritySelection(session.db);
    session.config.upsert("TAKI_HINDSIGHT_ENABLED", false);
    expect(expectStatusValid(session).runtime).toMatchObject({ available: false, unavailableReason: "connection_disabled" });
    expect(await revalidate(session, epochId)).toMatchObject({ state: "failed", reason: "producer_refused", errorCode: "HINDSIGHT_CONNECTION_DISABLED" });
    session.config.upsert("TAKI_HINDSIGHT_ENABLED", true);

    const calls = nativeCalls(j);
    session.config.upsert("TAKI_HINDSIGHT_DEPLOYMENT_MODE", "managed-helper");
    expect(expectStatusValid(session).hindsight).toMatchObject({ connection: { drift: "config_changed" }, actions: { revalidate: false } });
    expect(await revalidate(session, epochId)).toMatchObject({ state: "failed", reason: "producer_refused", errorCode: "HINDSIGHT_STATE_CONFLICT" });
    session.config.upsert("TAKI_HINDSIGHT_DEPLOYMENT_MODE", "existing-instance");
    session.config.upsert("TAKI_HINDSIGHT_TEMPLATE_REVISION", "taki-bank-v2");
    expect(await revalidate(session, epochId)).toMatchObject({ state: "failed", reason: "producer_refused", errorCode: "HINDSIGHT_TEMPLATE_CONFLICT" });
    expect(nativeCalls(j)).toBe(calls);
    expect(subsystems).toHaveLength(1);
    expect(readMemoryAuthoritySelection(session.db)).toEqual(selection);
    expect(session.runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "published", epochId });
  });

  it("refuses a deployment-mode change made across a restart, where the runtime was built on the unreviewed settings", async () => {
    const j = journey();
    const { session, epochId } = await activatedInstance(j);
    const reviewed = session.setup.status().configFingerprint;
    session.config.upsert("TAKI_HINDSIGHT_DEPLOYMENT_MODE", "managed-helper");
    const next = await j.restart("boot-b");
    // Boot binds on the live settings; only the lifecycle section flags them as unreviewed, and a Stage 5 change is never offered.
    expect(expectStatusValid(next).hindsight).toMatchObject({ connection: { drift: "unreviewed" }, actions: { revalidate: false } });
    const exports = j.transport.calls("template-export");
    // Refused before the validating phase, so nothing reached the provider on this operation's behalf.
    expect(await revalidate(next, epochId)).toMatchObject({ state: "failed", reason: "producer_refused", errorCode: "HINDSIGHT_STATE_CONFLICT",
      producer: { phase: "reserved" } });
    expect(j.transport.calls("template-export")).toBe(exports);
    expect(next.setup.status().configFingerprint).toBe(reviewed);
    expect(createHindsightConnectionRepo(next.db).reviewed()).toEqual({ configFingerprint: reviewed, deploymentMode: "existing-instance" });
  });

  it("revalidates a benign change made across a restart, advancing the reviewed fingerprint and mode, then a later key rotation", async () => {
    const j = journey();
    const subsystems = observeHindsightSubsystems();
    const { session, epochId } = await activatedInstance(j);
    const reviewed = session.setup.status().configFingerprint;
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    const next = await j.restart("boot-b");
    expect(expectStatusValid(next).hindsight).toMatchObject({ connection: { drift: "unreviewed" }, actions: { revalidate: true } });
    const booted = next.runtime.operations()!.configFingerprint;
    expect(booted).not.toBe(reviewed);
    expect(await revalidate(next, epochId)).toMatchObject({ state: "completed", result: { outcome: "unchanged", fingerprint: booted } });
    expect(createHindsightConnectionRepo(next.db).reviewed()).toEqual({ configFingerprint: booted, deploymentMode: "existing-instance" });
    expect(expectStatusValid(next).hindsight).toMatchObject({ connection: { drift: "none" }, actions: { revalidate: false } });

    j.secrets.state.version += 1;
    expect(expectStatusValid(next).hindsight).toMatchObject({ connection: { drift: "config_changed" }, actions: { revalidate: true } });
    const rotated = await revalidate(next, epochId);
    expect(rotated).toMatchObject({ state: "completed", result: { outcome: "rebound" } });
    const live = next.runtime.operations()!.configFingerprint;
    expect(live).not.toBe(booted);
    expect(createHindsightConnectionRepo(next.db).reviewed()).toEqual({ configFingerprint: live, deploymentMode: "existing-instance" });
    expect(subsystems).toHaveLength(3);
    expect((await next.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(true);
  });

  it("keeps a pre-050 row with no reviewed mode fail-closed for a change made across a restart", async () => {
    const j = journey();
    const { session, epochId } = await activatedInstance(j);
    session.db.exec("UPDATE hindsight_connection_state SET reviewed_deployment_mode=NULL WHERE singleton=1");
    const reviewed = session.setup.status().configFingerprint;
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    const next = await j.restart("boot-b");
    expect(expectStatusValid(next).hindsight).toMatchObject({ connection: { drift: "unreviewed" }, actions: { revalidate: false } });
    expect(await revalidate(next, epochId)).toMatchObject({ state: "failed", reason: "producer_refused", errorCode: "HINDSIGHT_STATE_CONFLICT",
      producer: { phase: "reserved" } });
    expect(createHindsightConnectionRepo(next.db).reviewed()).toEqual({ configFingerprint: reviewed, deploymentMode: null });
  });

  it("refuses a different provider lineage after admission, keeping the old binding and the reviewed fingerprint", async () => {
    const j = journey();
    const subsystems = observeHindsightSubsystems();
    const { session, epochId } = await activatedInstance(j);
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    const compatibility = j.client.compatibility.bind(j.client);
    vi.spyOn(j.client, "compatibility").mockImplementation(async (context) => {
      const manifest = await compatibility(context);
      return { ...manifest, provider: { ...manifest.provider, lineage: "99999999-9999-4999-8999-999999999999" } };
    });
    const reviewed = session.setup.status().configFingerprint;
    expect(await revalidate(session, epochId)).toMatchObject({ state: "failed", reason: "producer_refused", errorCode: "HINDSIGHT_REPLICA_LINEAGE_MISMATCH",
      producer: { phase: "validating" } });
    expect(session.setup.status().configFingerprint).toBe(reviewed);
    expect(subsystems).toHaveLength(1);
    expect(session.runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "published", epochId });
    expect(expectStatusValid(session).runtime).toMatchObject({ unavailableReason: "config_changed" });
  });

  it("settles a health check the provider fails (503) or an unsupported version as failed with its closed code, writing no reviewed state and no Bank row", async () => {
    const j = journey();
    const subsystems = observeHindsightSubsystems();
    const { session, epochId } = await activatedInstance(j);
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    const connection = createHindsightConnectionRepo(session.db);
    const before = { reviewed: connection.reviewed(), fingerprint: session.setup.status().configFingerprint, rows: bankRows(session) };
    const version = j.client.version.bind(j.client);
    j.transport.fail("common", { response: UNHEALTHY });
    expect(await revalidate(session, epochId)).toMatchObject({ state: "failed", reason: "producer_failed", errorCode: "HINDSIGHT_UNREACHABLE",
      result: null, producer: { phase: "validating" } });
    vi.spyOn(j.client, "version").mockImplementation(async (context) => ({ ...await version(context), apiVersion: "0.0.0" }));
    expect(await revalidate(session, epochId)).toMatchObject({ state: "failed", reason: "producer_failed", errorCode: "HINDSIGHT_VERSION_UNSUPPORTED",
      result: null, producer: { phase: "validating" } });
    expect({ reviewed: connection.reviewed(), fingerprint: session.setup.status().configFingerprint, rows: bankRows(session) }).toEqual(before);
    expect(subsystems).toHaveLength(1);
    expect(session.runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "published", epochId });
    expect(expectStatusValid(session)).toMatchObject({ runtime: { unavailableReason: "config_changed" }, hindsight: { actions: { revalidate: true } } });
  });

  it("calls verifiedReconnect once after a foreground success following an outage, never from scheduled runs, and on an unchanged revalidate", async () => {
    const j = journey();
    const subsystems = observeHindsightSubsystems();
    const { session, epochId } = await activatedInstance(j);
    const subsystem = subsystems[0]!;
    expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(true);
    await parkBanks(j, subsystem);
    expect(subsystem.scheduler.status().some((entry) => entry.automatic && entry.retryDueAt !== null)).toBe(true);
    const reconnect = vi.spyOn(subsystem.scheduler, "verifiedReconnect");
    j.application.control.offline = true;
    await session.runtime.captureRun(JOURNEY_CHARACTER);
    expect(reconnect).not.toHaveBeenCalled();
    j.application.control.offline = false;
    expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(true);
    expect(reconnect).toHaveBeenCalledTimes(1);
    await subsystem.scheduler.tick();
    expect(reconnect).toHaveBeenCalledTimes(1);
    await session.runtime.captureRun(JOURNEY_CHARACTER);
    expect(reconnect).toHaveBeenCalledTimes(1);

    expect(await revalidate(session, epochId)).toMatchObject({ state: "completed", result: { outcome: "unchanged" } });
    expect(reconnect).toHaveBeenCalledTimes(2);
    expect(subsystems).toHaveLength(1);
  });
});

describe("Stage 2c — automatic lifecycle triggers", () => {
  it("submits one automatic bank.provision per Character and fingerprint, held across restart, and never retries a failed attempt", async () => {
    const j = journey({ characters: [MIKA], automatic: true });
    const { session } = await activatedInstance(j);
    j.transport.occupy(MIKA_BANK);
    await session.runtime.captureRun(MIKA);
    await session.operations.stop();
    const automatic = (s: JourneySession) => s.operations.list({ includeTerminal: true, limit: 20 }).filter((operation) => operation.kind === "bank.provision");
    expect(automatic(session)).toHaveLength(1);
    expect(automatic(session)[0]).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_BANK_OCCUPIED", producer: { origin: "automatic" } });
    await session.runtime.captureRun(MIKA);
    await session.operations.stop();
    expect(automatic(session)).toHaveLength(1);

    const next = await j.restart("boot-b");
    await next.runtime.captureRun(MIKA);
    await next.operations.stop();
    expect(automatic(next)).toHaveLength(1);
    expect(j.transport.calls("bank-stats")).toBe(1);
  });

  it("automatically revalidates a changed connection once and the next Run is served with memory", async () => {
    const j = journey({ automatic: true });
    const subsystems = observeHindsightSubsystems();
    const { session } = await activatedInstance(j);
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(false);
    await session.operations.stop();
    const revalidations = session.operations.list({ includeTerminal: true, limit: 20 }).filter((operation) => operation.kind === "connection.revalidate");
    expect(revalidations).toEqual([expect.objectContaining({ state: "completed", producer: expect.objectContaining({ origin: "automatic" }),
      result: expect.objectContaining({ outcome: "rebound" }) })]);
    expect(subsystems).toHaveLength(2);
    expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(true);
    await session.operations.stop();
    expect(session.operations.list({ includeTerminal: true, limit: 20 }).filter((operation) => operation.kind === "connection.revalidate")).toHaveLength(1);
  });

  it("settles an automatic revalidation against a different lineage as one failed attempt, keeps the binding and never retries it", async () => {
    const j = journey({ automatic: true });
    const subsystems = observeHindsightSubsystems();
    const { session, epochId } = await activatedInstance(j);
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    const compatibility = j.client.compatibility.bind(j.client);
    vi.spyOn(j.client, "compatibility").mockImplementation(async (context) => {
      const manifest = await compatibility(context);
      return { ...manifest, provider: { ...manifest.provider, lineage: "99999999-9999-4999-8999-999999999999" } };
    });
    const revalidations = () => session.operations.list({ includeTerminal: true, limit: 20 }).filter((operation) => operation.kind === "connection.revalidate");
    for (let turn = 0; turn < 2; turn++) {
      expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(false);
      await session.operations.stop();
      expect(revalidations()).toEqual([expect.objectContaining({ state: "failed", errorCode: "HINDSIGHT_REPLICA_LINEAGE_MISMATCH",
        producer: expect.objectContaining({ origin: "automatic", phase: "validating" }) })]);
    }
    expect(subsystems).toHaveLength(1);
    expect(session.runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "published", epochId });
  });

  it("settles an automatic revalidation whose health check the provider fails once and never retries it for the same fingerprint", async () => {
    const j = journey({ automatic: true });
    const { session, epochId } = await activatedInstance(j);
    session.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 12_000);
    j.transport.fail("common", { response: UNHEALTHY, persistent: true });
    const probed = vi.spyOn(j.client, "health");
    const revalidations = () => session.operations.list({ includeTerminal: true, limit: 20 }).filter((operation) => operation.kind === "connection.revalidate");
    for (let turn = 0; turn < 2; turn++) {
      expect((await session.runtime.captureRun(JOURNEY_CHARACTER)).snapshot.capabilities.recall).toBe(false);
      await session.operations.stop();
      expect(revalidations()).toEqual([expect.objectContaining({ state: "failed", errorCode: "HINDSIGHT_UNREACHABLE",
        producer: expect.objectContaining({ origin: "automatic", phase: "validating" }) })]);
    }
    expect(probed).toHaveBeenCalledTimes(1);
    expect(session.runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "published", epochId });
  });

  it("refuses an automatic submit while another memory family is busy, leaving the Run degraded and nothing queued", async () => {
    const j = journey({ characters: [MIKA], automatic: true });
    const { session, epochId } = await activatedInstance(j);
    let submitted: MemoryOperation | undefined;
    j.transport.before(async ({ route }) => {
      if (route !== "common" || submitted) return;
      submitted = session.operations.list({ includeTerminal: false, limit: 5 })[0];
      expect((await session.runtime.captureRun(MIKA)).snapshot.capabilities.recall).toBe(false);
    });
    const busy = await revalidate(session, epochId);
    expect(busy).toMatchObject({ state: "completed", result: { outcome: "unchanged" } });
    expect(submitted?.kind).toBe("connection.revalidate");
    expect(session.operations.list({ includeTerminal: true, limit: 20 }).filter((operation) => operation.kind === "bank.provision")).toEqual([]);
    expect(j.logs.some((entry) => entry.msg === "automatic Hindsight lifecycle operation not submitted")).toBe(true);
  });
});

describe("Stage 2c — D87 activation-interval Character", () => {
  it("carries a new Character's exact primary witnesses through the fence and provisions its Bank after activation", async () => {
    const j = journey({ characters: [MIKA], model: scriptedGenerateModel([keepSpan(1, 2)]) });
    const subsystems = observeHindsightSubsystems();
    const session = j.session;
    const localEpochId = await onboardLocal(session);
    await configureHindsight(session);
    let seen = false;
    j.transport.before(async ({ route }) => {
      if (route !== "verification-verify" || seen) return;
      seen = true;
      expect((await session.runtime.captureRun(MIKA)).snapshot).toMatchObject({ providerId: "local", capabilities: { recall: false } });
      expect(session.db.prepare("SELECT count(*) AS n FROM canonical_memory_banks WHERE character_id=:id").get({ id: MIKA })?.n).toBe(0);
      // A read-only Run capture no longer materializes a Bank. Persist the actual first conversation instead.
      session.chat("New Character during activation", "Owned response", MIKA);
    });
    const first = await session.settled({ kind: "hindsight.activate", source: { mode: "new", setupRevision: session.setup.status().revision, expectedEpochId: localEpochId } });
    expect(seen).toBe(true); expect(first).toMatchObject({ state: "completed", result: { outcome: "activated", runtimeAvailable: true } });
    const epochId = readMemoryAuthoritySelection(session.db).epochId!;
    const witnesses = createHindsightIngestionSourceRepo(session.db); const scope = { epochId, characterId: MIKA };
    expect(witnesses.unprocessedCount(scope)).toBe(2);
    expect((await session.runtime.captureRun(MIKA)).snapshot.capabilities.recall).toBe(false);
    expect(await session.settled({ kind: "bank.provision", characterId: MIKA })).toMatchObject({ state: "completed", result: { readiness: "ready" } });
    const run = await session.runtime.captureRun(MIKA);
    expect(run.snapshot).toMatchObject({ providerId: "hindsight", capabilities: { recall: true } });
    j.application.control.offline = true;
    const range = { characterId: MIKA, fromSeq: 1, throughSeq: 2 };
    expect(await subsystems.at(-1)!.memoryFlush.prepareRetirement({ ...range, operationId: "interval-flush" })).toMatchObject({ status: "success", writes: 2 });
    expect(witnesses.unprocessedCount(scope)).toBe(0);
    expect(await subsystems.at(-1)!.memoryFlush.prepareRetirement({ ...range, operationId: "interval-flush-again" })).toMatchObject({ status: "success", writes: 0 });
    expect(j.model.doGenerateCalls).toHaveLength(1);
  });
});
