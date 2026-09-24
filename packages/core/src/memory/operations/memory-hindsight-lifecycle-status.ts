/**
 * INPUT:  the selected Hindsight epoch, the live connection (state + fingerprint), the bound runtime's drift (null while
 *         unbound), the B3 setup snapshot, Characters with an open lifecycle operation, replica checkpoints and the Timeline
 * OUTPUT: readHindsightLifecycleStatus() — the memory.authority.status `hindsight` section (connection drift/admission
 *         evidence, per-scope Bank readiness, Core-derived actions)
 * POS:    core/memory/operations — pure local read; never probes the network, never writes, never fails on missing evidence
 */
import type { HindsightBankSetupProjection, HindsightSetupSnapshot, MemoryHindsightStatusSection } from "@taki/shared";
import { readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { createHindsightRuntimeAdmissionRepo } from "../../db/hindsight-runtime-admission-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { listTimelineCharacterIds } from "../../db/timeline-repo.ts";
import { hindsightBankBindings } from "../hindsight/hindsight-bank-identity.ts";
import type { HindsightConnectionDrift, HindsightLiveConnection } from "../hindsight/hindsight-runtime-connection.ts";

export interface HindsightLifecycleStatusInput {
  db: Database;
  epochId: string;
  live: HindsightLiveConnection;
  runtimeDrift: HindsightConnectionDrift | null;
  setup: HindsightSetupSnapshot;
  /** Characters with an open lifecycle operation; empty until the provisioning producer exists. */
  provisioning: readonly string[];
}

type Section = MemoryHindsightStatusSection;
type Bank = Section["banks"][number];
const MAX_BANKS = 256;

export function readHindsightLifecycleStatus(input: HindsightLifecycleStatusInput): Section {
  const banks = input.setup.banks.slice(0, MAX_BANKS).map((row) => setupBank(input, row));
  const listed = new Set(banks.map((bank) => bank.characterId));
  for (const characterId of listTimelineCharacterIds(input.db, MAX_BANKS)) {
    if (banks.length >= MAX_BANKS) break;
    if (!listed.has(characterId)) banks.push(timelineBank(input, characterId));
  }
  return { connection: connection(input), banks, actions: { revalidate: false, provision: [] } };
}

function setupBank(input: HindsightLifecycleStatusInput, row: HindsightBankSetupProjection): Bank {
  const characterId = row.scope === "global" ? null : row.canonicalIdentity.slice("character:".length);
  const base = { scope: row.scope, characterId, nativeBankId: row.externalBankId };
  if (row.status === "verified") return { ...base, readiness: replicaBound(input, row.externalBankId) ? "ready" : "syncing", errorCode: null };
  if (characterId !== null && input.provisioning.includes(characterId)) return { ...base, readiness: "provisioning", errorCode: null };
  return { ...base, readiness: row.status === "failed" ? "failed" : "not_provisioned", errorCode: row.lastError?.code ?? null };
}

function timelineBank(input: HindsightLifecycleStatusInput, characterId: string): Bank {
  let nativeBankId: string | null = null;
  try { nativeBankId = hindsightBankBindings(characterId)[1].externalBankId; }
  catch { /* an id outside the Bank identity bounds can never be provisioned; it is shown without a native id */ }
  const readiness = input.provisioning.includes(characterId) && nativeBankId !== null ? "provisioning" : "not_provisioned";
  return { scope: "character", characterId, nativeBankId, readiness, errorCode: null };
}

function replicaBound(input: HindsightLifecycleStatusInput, bankId: string): boolean {
  // An unreadable checkpoint is not a bound replica; the replica section and the scheduler own its error code.
  try {
    const checkpoint = readApplicationCheckpoint(input.db, bankId);
    return checkpoint !== undefined && checkpoint.authorityEpochId === input.epochId && !checkpoint.bankDeleted;
  } catch { return false; }
}

function connection(input: HindsightLifecycleStatusInput): Section["connection"] {
  if (input.live.state !== "ready") return { config: input.live.state, drift: "none", admittedAt: null };
  return { config: "ready", drift: drift(input, input.live.fingerprint), admittedAt: admittedAt(input, input.live.fingerprint) };
}

function drift(input: HindsightLifecycleStatusInput, fingerprint: string): Section["connection"]["drift"] {
  if (input.runtimeDrift === "config_changed") return "config_changed";
  const reviewed = input.setup.configFingerprint;
  if (reviewed === null || reviewed === fingerprint) return "none";
  // A runtime bound to the live config vouches for it; B3 simply never reviewed it (boot after an edit).
  return input.runtimeDrift === "none" ? "unreviewed" : "config_changed";
}

function admittedAt(input: HindsightLifecycleStatusInput, configFingerprint: string): string | null {
  // Invalid or foreign evidence is no admission evidence; the capture path refuses it on its own.
  try { return createHindsightRuntimeAdmissionRepo(input.db).read({ authorityEpochId: input.epochId, configFingerprint })?.admittedAt ?? null; }
  catch { return null; }
}
