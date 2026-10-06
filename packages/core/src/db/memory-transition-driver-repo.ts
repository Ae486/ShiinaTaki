/**
 * INPUT:  the current W1 executor and exact authenticated native command/response identities
 * OUTPUT: immutable all-Bank ownership, dispatch-before-I/O and historical command/observation lookup
 * POS:    core/db — W5 journal under the existing operation; absence of an acknowledgement never proves no effect
 */
import { MemoryTransitionDriverBankSchema, MemoryTransitionNativeCommandSchema, MemoryTransitionNativeObservationSchema,
  type MemoryTransitionDriverBank, type MemoryTransitionNativeCommand, type HindsightTransitionStatus } from "@taki/shared";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { validateHindsightTransitionStatus, signHindsightTransitionAcquire } from "../memory/hindsight/hindsight-transition-proof.ts";
import { readTransitionIntent, requireTransitionLease, type TransitionLease } from "./memory-transition-repo.ts";
import type { Database } from "./sqlite.ts";

type Work = { lease: TransitionLease; now: string };
export function initializeTransitionDriverBanks(db: Database, input: Work): MemoryTransitionDriverBank[] {
  const result: MemoryTransitionDriverBank[] = [];
  db.transaction(() => {
    requireTransitionLease(db, input);
    const intent = readTransitionIntent(db, input.lease.transitionId); if (!intent) invalid();
    for (const bank of intent.request.expected.banks) {
      const nativeBankId = bank.nativeBankId ?? bank.targetBankId; if (!nativeBankId) invalid();
      const value = MemoryTransitionDriverBankSchema.parse({ version: 1, transitionId: intent.transitionId,
        nativeBankId, sourceBankId: bank.sourceBankId, identityHash: transitionLocalHash(intent.request.expected) });
      const prior = readTransitionDriverBank(db, intent.transitionId, nativeBankId);
      if (prior && transitionLocalHash(prior) !== transitionLocalHash(value)) invalid();
      if (!prior) db.prepare("INSERT INTO memory_transition_driver_banks VALUES(:transition,:bank,:source,:json)")
        .run({ transition: intent.transitionId, bank: nativeBankId, source: bank.sourceBankId, json: JSON.stringify(value) });
      result.push(prior ?? value);
    }
  });
  return result;
}
export function readTransitionDriverBank(db: Database, transitionId: string, bankId: string): MemoryTransitionDriverBank | undefined {
  const row = db.prepare("SELECT * FROM memory_transition_driver_banks WHERE transition_id=:transition AND bank_id=:bank")
    .get({ transition: transitionId, bank: bankId });
  if (!row) return undefined;
  const value = MemoryTransitionDriverBankSchema.parse(JSON.parse(String(row.body_json)));
  const intent = readTransitionIntent(db, transitionId);
  if (!intent || value.transitionId !== transitionId || value.nativeBankId !== bankId || value.sourceBankId !== row.source_bank_id
    || value.identityHash !== transitionLocalHash(intent.request.expected)
    || !intent.request.expected.banks.some((bank) => bank.sourceBankId === value.sourceBankId
      && (bank.nativeBankId ?? bank.targetBankId) === bankId)) invalid();
  return value;
}
export function readTransitionNativeCommand(db: Database, key: { transitionId: string; bankId: string;
  kind: MemoryTransitionNativeCommand["kind"]; slot: string }): MemoryTransitionNativeCommand | undefined {
  const row = db.prepare("SELECT * FROM memory_transition_native_commands WHERE transition_id=:transition AND bank_id=:bank AND kind=:kind AND slot=:slot")
    .get({ transition: key.transitionId, bank: key.bankId, kind: key.kind, slot: key.slot });
  if (!row) return undefined;
  const value = MemoryTransitionNativeCommandSchema.parse(JSON.parse(String(row.body_json)));
  const { commandId, ...body } = value;
  if (commandId !== row.id || value.transitionId !== key.transitionId || value.bankId !== key.bankId || value.kind !== key.kind
    || value.slot !== key.slot || commandId !== transitionLocalHash(["taki-transition-native-command.v1", body])) invalid();
  if (!readTransitionDriverBank(db, key.transitionId, key.bankId)) invalid();
  if (value.kind === "acquire" && (value.request.transition_id !== value.transitionId
    || signHindsightTransitionAcquire(value.bankId, value.request).request_hash !== value.request.request_hash)) invalid();
  if (value.kind === "decision" && value.request.executor.transition_id !== value.transitionId) invalid();
  return value;
}
type CommandInput = MemoryTransitionNativeCommand extends infer T ? T extends MemoryTransitionNativeCommand
  ? Omit<T, "version" | "commandId" | "transitionId" | "preparedAt"> : never : never;
export function prepareTransitionNativeCommand(db: Database, input: Work & { command: CommandInput }): MemoryTransitionNativeCommand {
  let command: MemoryTransitionNativeCommand | undefined;
  db.transaction(() => {
    requireTransitionLease(db, input);
    const body = { ...input.command, version: 1 as const, transitionId: input.lease.transitionId, preparedAt: input.now };
    const prior = readTransitionNativeCommand(db, body);
    if (prior) {
      if (transitionLocalHash(prior.request) !== transitionLocalHash(body.request)) invalid();
      command = prior; return;
    }
    command = MemoryTransitionNativeCommandSchema.parse({ ...body, commandId: transitionLocalHash(["taki-transition-native-command.v1", body]) });
    db.prepare("INSERT INTO memory_transition_native_commands VALUES(:id,:transition,:bank,:kind,:slot,:json)")
      .run({ id: command.commandId, transition: command.transitionId, bank: command.bankId, kind: command.kind,
        slot: command.slot, json: JSON.stringify(command) });
  });
  if (!command) invalid(); return command;
}
export function markTransitionNativeDispatched(db: Database, input: Work & { command: MemoryTransitionNativeCommand }): void {
  db.transaction(() => {
    requireTransitionLease(db, input);
    const command = readTransitionNativeCommand(db, input.command);
    if (!command || command.transitionId !== input.lease.transitionId || command.commandId !== input.command.commandId) invalid();
    if (!transitionNativeDispatched(db, command.commandId)) db.prepare("INSERT INTO memory_transition_native_dispatches VALUES(:id,:now)")
      .run({ id: command.commandId, now: input.now });
  });
}
export function transitionNativeDispatched(db: Database, commandId: string): boolean {
  return !!db.prepare("SELECT command_id FROM memory_transition_native_dispatches WHERE command_id=:id").get({ id: commandId });
}
export function recordTransitionNativeObservation(db: Database, input: Work & { status: HindsightTransitionStatus }): void {
  db.transaction(() => {
    requireTransitionLease(db, input);
    const status = input.status;
    validateHindsightTransitionStatus(status, { bankId: status.bank_id, transitionId: input.lease.transitionId });
    const original = readTransitionNativeCommand(db, { transitionId: input.lease.transitionId, bankId: status.bank_id, kind: "acquire", slot: "original" });
    if (!original || transitionLocalHash(original.request) !== transitionLocalHash(status.request)
      || !transitionNativeDispatched(db, original.commandId)) invalid();
    const body = { version: 1 as const, transitionId: input.lease.transitionId, bankId: status.bank_id, observedAt: input.now, status };
    const value = MemoryTransitionNativeObservationSchema.parse({ ...body, observationId: transitionLocalHash(["taki-transition-native-observation.v1", body]) });
    if (!db.prepare("SELECT id FROM memory_transition_native_observations WHERE id=:id").get({ id: value.observationId })) {
      db.prepare("INSERT INTO memory_transition_native_observations(id,transition_id,bank_id,body_json) VALUES(:id,:transition,:bank,:json)")
        .run({ id: value.observationId, transition: value.transitionId, bank: value.bankId, json: JSON.stringify(value) });
    }
  });
}
export function latestTransitionNativeObservation(db: Database, transitionId: string, bankId: string) {
  const row = db.prepare("SELECT * FROM memory_transition_native_observations WHERE transition_id=:transition AND bank_id=:bank ORDER BY sequence DESC LIMIT 1")
    .get({ transition: transitionId, bank: bankId });
  if (!row) return undefined;
  const value = MemoryTransitionNativeObservationSchema.parse(JSON.parse(String(row.body_json)));
  const { observationId, ...body } = value;
  const original = readTransitionNativeCommand(db, { transitionId, bankId, kind: "acquire", slot: "original" });
  if (!original || value.transitionId !== transitionId || value.bankId !== bankId || observationId !== row.id
    || observationId !== transitionLocalHash(["taki-transition-native-observation.v1", body])
    || transitionLocalHash(original.request) !== transitionLocalHash(value.status.request)) invalid();
  validateHindsightTransitionStatus(value.status, { transitionId, bankId });
  return value;
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
