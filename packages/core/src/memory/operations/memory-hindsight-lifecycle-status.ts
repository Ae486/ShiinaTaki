/**
 * INPUT:  the selected Hindsight epoch, the live connection (state + fingerprint), the bound runtime's drift (null while
 *         unbound) and unavailable reason, the B3 setup snapshot, Characters with an open bank.provision, whether an
 *         exclusive family is open, whether the revalidate blocker refuses, replica checkpoints, the Timeline and the backup block
 * OUTPUT: readHindsightLifecycleStatus() — the memory.authority.status `hindsight` section (connection drift/admission
 *         evidence, per-scope Bank readiness, the backup block as read, Core-derived actions: revalidate on drift or a repairable unavailable runtime
 *         unless the revalidate blocker refuses, provision for every unprovisioned/failed Character while the runtime serves; none while an exclusive family is open)
 * POS:    core/memory/operations — pure local read; never probes the network, never writes, never fails on missing evidence
 */
import type {
  HindsightBackupStatusSection, HindsightBankSetupProjection, HindsightSetupSnapshot, MemoryHindsightStatusSection, MemoryRuntimeUnavailableReason,
} from "@taki/shared";
import { createHindsightRuntimeAdmissionRepo } from "../../db/hindsight-runtime-admission-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { listTimelineCharacterIds } from "../../db/timeline-repo.ts";
import { hindsightBankBindings } from "../hindsight/hindsight-bank-identity.ts";
import { hindsightReplicaBound } from "../hindsight-lifecycle/hindsight-lifecycle-reads.ts";
import type { HindsightConnectionDrift, HindsightLiveConnection } from "../hindsight/hindsight-runtime-connection.ts";
import { activeTemplateHold } from "../hindsight/template-lifecycle/template-execution-reads.ts";

export interface HindsightLifecycleStatusInput {
  db: Database;
  epochId: string;
  live: HindsightLiveConnection;
  runtimeDrift: HindsightConnectionDrift | null;
  setup: HindsightSetupSnapshot;
  /** Characters with an open bank.provision operation. */
  provisioning: readonly string[];
  /** An exclusive family (setup / local-onboarding / hindsight-activation / hindsight-lifecycle) has an open operation. */
  busy: boolean;
  unavailableReason: MemoryRuntimeUnavailableReason | null;
  /** hindsightRevalidateBlocker refuses this live connection (a Stage 5 change): the drift still shows, no revalidate is offered. */
  revalidateBlocked: boolean;
  /** The backup block read by the caller (null when Core composes without a backup producer). */
  backup: HindsightBackupStatusSection | null;
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
  const section = connection(input);
  return { connection: section, banks, actions: actions(input, { connection: section, banks }), backup: input.backup };
}

// Stopped and authority_mismatch are not connection problems: a revalidation cannot repair either.
const REVALIDATABLE: readonly (MemoryRuntimeUnavailableReason | null)[] = ["not_installed", "connection_unavailable", "config_changed"];

function actions(input: HindsightLifecycleStatusInput, section: Pick<Section, "connection" | "banks">): Section["actions"] {
  if (input.busy || activeTemplateHold(input.db, input.epochId)) return { revalidate: false, provision: [] };
  const revalidate = section.connection.config === "ready" && !input.revalidateBlocked
    && (section.connection.drift !== "none" || REVALIDATABLE.includes(input.unavailableReason));
  const provision = input.unavailableReason !== null ? [] : section.banks.flatMap((bank) =>
    bank.characterId !== null && bank.nativeBankId !== null && (bank.readiness === "not_provisioned" || bank.readiness === "failed") ? [bank.characterId] : []);
  return { revalidate, provision };
}

function setupBank(input: HindsightLifecycleStatusInput, row: HindsightBankSetupProjection): Bank {
  const characterId = row.scope === "global" ? null : row.canonicalIdentity.slice("character:".length);
  const base = { scope: row.scope, characterId, nativeBankId: row.externalBankId };
  if (row.status === "verified") {
    return { ...base, readiness: hindsightReplicaBound(input.db, { epochId: input.epochId, bankId: row.externalBankId }) ? "ready" : "syncing", errorCode: null };
  }
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
