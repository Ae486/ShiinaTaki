/**
 * INPUT:  an owned unused-Bank fence, immutable snapshot commands and authenticated application reads
 * OUTPUT: complete paired inventory with bounded, durable renewal only after a factual snapshot expiry
 * POS:    core/memory/transitions — read-only materialization; never replaces transition/delta effect identities
 */
import { randomUUID } from "node:crypto";
import type { HindsightTransitionStatus, MemoryTransitionIntent, MemoryTransitionNativeCommand,
  MemoryTransitionUnusedInventory } from "@taki/shared";
import { prepareTransitionNativeCommand, readTransitionNativeCommand, markTransitionNativeDispatched } from "../../db/memory-transition-driver-repo.ts";
import { requireTransitionPreparation, type TransitionCaptureInput } from "../../db/memory-transition-local-capture.ts";
import type { Database } from "../../db/sqlite.ts";
import { requireHindsightApplicationClient } from "../hindsight/hindsight-application-capability.ts";
import { HindsightApplicationRefusal } from "../hindsight/hindsight-application-client.ts";
import { loadBodies } from "../hindsight/hindsight-application-bundle-loader.ts";
import type { HindsightCallContext } from "../hindsight/hindsight-client.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import type { TransitionNativeSession } from "./transition-native-session.ts";

interface Input { db: Database; intent: MemoryTransitionIntent; native: TransitionNativeSession;
  work(): TransitionCaptureInput; request(): HindsightCallContext; changed(): void }
type SnapshotCommand = Extract<MemoryTransitionNativeCommand, { kind: "application-snapshot" }>;

export async function loadTransitionUnusedInventory(input: Input, original: HindsightTransitionStatus): Promise<MemoryTransitionUnusedInventory> {
  const status = await unusedFence(input, original);
  let command = currentCommand(input, status); let renewed = false;
  let application;
  for (;;) {
    try { application = await applicationPages(input, command); break; }
    catch (error) {
      // Transport loss, missing snapshots and namespace errors establish no safe replacement. Only the
      // snapshot endpoints' typed expiry permits one new read-only request per Bank in this invocation.
      if (renewed || !(error instanceof HindsightApplicationRefusal) || error.refusal.code !== "snapshot_expired") throw error;
      await unusedFence(input, status);
      command = snapshotCommand(input, status, successorSlot(command)); renewed = true;
      input.changed();
    }
  }
  const client = requireHindsightApplicationClient(input.native.client);
  if (!client.createCurrentSnapshot || !client.currentSnapshotPage) invalid();
  const bankId = status.bank_id; const namespace = command.request.namespace;
  const nativeSnapshot = await client.createCurrentSnapshot({ bankId, ttlSeconds: 600, context: input.request() });
  const nativePages = [];
  for (let pageNumber = 0; pageNumber < nativeSnapshot.manifest.total_pages; pageNumber++) {
    nativePages.push(await client.currentSnapshotPage({ bankId, snapshotId: nativeSnapshot.snapshot_id, pageNumber, context: input.request() }));
  }
  const bodies = await loadBodies({ bankId, namespace, client, context: input.request(), request: input.request }, application.applicationPages);
  await unusedFence(input, status);
  return { nativeSnapshot, nativePages, ...application,
    bodies: [...bodies.values()].map(({ ref, bytes }) => ({ ref, base64: Buffer.from(bytes).toString("base64") })) };
}

async function unusedFence(input: Input, expected: HindsightTransitionStatus): Promise<HindsightTransitionStatus> {
  const status = await input.native.fence(expected.bank_id);
  input.db.transaction(() => {
    const intent = requireTransitionPreparation(input.db, input.work());
    const bank = intent.request.expected.banks.find((row) => row.targetBankId === status.bank_id);
    const acquire = readTransitionNativeCommand(input.db, { transitionId: intent.transitionId, bankId: status.bank_id,
      kind: "acquire", slot: "original" });
    if (intent.transitionId !== input.intent.transitionId || intent.request.expected.sourceProvider !== "local"
      || !bank || bank.nativeBankId !== null || status.request.provider_lineage !== intent.request.expected.targetLineageId
      || !acquire || acquire.kind !== "acquire" || transitionLocalHash(acquire.request) !== transitionLocalHash(status.request)
      || transitionLocalHash(expected.request) !== transitionLocalHash(status.request) || !status.request.unused_scope
      || status.phase !== "fenced" || !status.executor_live || status.outcome || status.proof
      || status.active_writers !== 0 || status.accepted_operations !== 0
      || input.db.prepare("SELECT id FROM memory_transition_preparations WHERE transition_id=:id AND slot=:bank")
        .get({ id: intent.transitionId, bank: bank.sourceBankId })) invalid();
  });
  return status;
}

function currentCommand(input: Input, status: HindsightTransitionStatus): SnapshotCommand {
  let command = snapshotCommand(input, status, "unused-inventory");
  for (;;) {
    const next = readTransitionNativeCommand(input.db, { transitionId: input.intent.transitionId, bankId: status.bank_id,
      kind: "application-snapshot", slot: successorSlot(command) });
    if (!next) return command;
    command = checkedCommand(next, status);
  }
}
function successorSlot(command: SnapshotCommand): string { return `unused-inventory:expired:${command.commandId}`; }
function snapshotCommand(input: Input, status: HindsightTransitionStatus, slot: string): SnapshotCommand {
  const key = { transitionId: input.intent.transitionId, bankId: status.bank_id, kind: "application-snapshot" as const, slot };
  const namespace = { application_id: "taki" as const, provider_lineage: status.request.provider_lineage,
    bank_generation: status.request.bank_generation };
  const command = readTransitionNativeCommand(input.db, key) ?? prepareTransitionNativeCommand(input.db, { ...input.work(),
    command: { ...key, request: { namespace, request_id: randomUUID(), ttl_seconds: 600 } } });
  return checkedCommand(command, status);
}
function checkedCommand(command: MemoryTransitionNativeCommand, status: HindsightTransitionStatus): SnapshotCommand {
  if (command.kind !== "application-snapshot" || command.bankId !== status.bank_id
    || command.transitionId !== status.request.transition_id || command.request.namespace.application_id !== "taki"
    || command.request.namespace.provider_lineage !== status.request.provider_lineage
    || command.request.namespace.bank_generation !== status.request.bank_generation) invalid();
  return command;
}
async function applicationPages(input: Input, command: SnapshotCommand) {
  const client = requireHindsightApplicationClient(input.native.client); const bankId = command.bankId;
  // The leaf is committed before dispatch, including a renewal whose response might be lost. Reopen follows
  // that durable chain directly rather than first replaying an expired ancestor or minting another request.
  markTransitionNativeDispatched(input.db, { ...input.work(), command });
  const applicationManifest = await client.createApplicationSnapshot({ bankId, request: command.request, context: input.request() });
  if (!applicationManifest.snapshot_id) invalid();
  const applicationPages = [];
  for (let pageNumber = 0; pageNumber < applicationManifest.total_pages; pageNumber++) {
    applicationPages.push(await client.applicationSnapshotPage({ bankId, namespace: command.request.namespace,
      snapshotId: applicationManifest.snapshot_id, pageNumber, context: input.request() }));
  }
  return { applicationManifest, applicationPages };
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
