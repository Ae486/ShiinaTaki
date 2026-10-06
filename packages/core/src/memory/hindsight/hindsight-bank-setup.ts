/**
 * INPUT:  one Hindsight Bank target, setup dependencies, and a bounded cancellation signal
 * OUTPUT: idempotent Bank/template application with operation polling and verified durable projection; bankProjection()
 *         (the B3 row a target maps to, also used for a lifecycle dry-run failure)
 * POS:    core/memory/hindsight — extracted setup stage; never changes Memory Authority
 */
import type { HindsightBankSetupProjection, HindsightConnectionProjection } from "@taki/shared";
import type { HindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import type { HindsightClient } from "./hindsight-client.ts";
import { hindsightError } from "./hindsight-errors.ts";
import type { HindsightBankBinding } from "./hindsight-bank-identity.ts";
import { normalizeError } from "./hindsight-setup-errors.ts";
import { verifyTakiBankTemplate, type TakiHindsightBankTemplate } from "./taki-bank-template-v1.ts";

export interface HindsightBankSetupDeps {
  bankRepo: HindsightBankSetupRepo;
  client: HindsightClient;
  connection: HindsightConnectionProjection;
  wait: (ms: number) => Promise<void>;
  now: () => string;
}

export interface HindsightBankSetupTarget {
  binding: HindsightBankBinding;
  template: TakiHindsightBankTemplate;
  digest: string;
}

export async function applyHindsightBank(input: HindsightBankApplyInput): Promise<void> {
  const { deps, target, signal } = input;
  const { binding, template, digest } = target;
  const existing = deps.bankRepo.get(binding.canonicalIdentity);
  const context = { timeoutMs: deps.connection.requestTimeoutMs, signal };
  signal.throwIfAborted();
  if (isVerified(existing, target)) {
    verifyTakiBankTemplate(await deps.client.exportTemplate(binding.externalBankId, context), template);
    signal.throwIfAborted();
    return;
  }
  try {
    let operationIds = existing?.status === "applied" && existing.templateDigest === digest ? existing.operationIds : null;
    if (operationIds === null) {
      await deps.client.createOrUpdateBank(binding.externalBankId, context);
      signal.throwIfAborted();
      const applied = await deps.client.importTemplate({ bankId: binding.externalBankId, template: template.manifest, dryRun: false, context });
      signal.throwIfAborted();
      operationIds = applied.operation_ids ?? [];
      deps.bankRepo.upsert(bankProjection(target, { status: "applied", operationIds, lastVerifiedAt: null, lastError: null }));
    }
    await waitForOperations({ ...input, operationIds });
    verifyTakiBankTemplate(await deps.client.exportTemplate(binding.externalBankId, context), template);
    signal.throwIfAborted();
    deps.bankRepo.upsert(bankProjection(target, { status: "verified", operationIds, lastVerifiedAt: deps.now(), lastError: null }));
  } catch (error) {
    if (signal.aborted) throw error;
    deps.bankRepo.upsert(bankProjection(target, {
      status: "failed", operationIds: [], lastVerifiedAt: null, lastError: normalizeError(error).projection(),
    }));
    throw error;
  }
}

export interface HindsightBankApplyInput {
  deps: HindsightBankSetupDeps;
  target: HindsightBankSetupTarget;
  signal: AbortSignal;
  operationIds?: string[];
}

function isVerified(
  existing: HindsightBankSetupProjection | null,
  target: HindsightBankSetupTarget,
): boolean {
  return existing?.status === "verified" && existing.externalBankId === target.binding.externalBankId &&
    existing.templateRevision === target.template.takiTemplateRevision && existing.templateDigest === target.digest;
}

async function waitForOperations(input: HindsightBankApplyInput): Promise<void> {
  const { deps, target, signal, operationIds = [] } = input;
  for (const operationId of operationIds) {
    while (true) {
      signal.throwIfAborted();
      const result = await deps.client.operationStatus(target.binding.externalBankId, operationId, {
        timeoutMs: deps.connection.requestTimeoutMs, signal,
      });
      signal.throwIfAborted();
      if (result.status === "completed") break;
      if (["failed", "cancelled", "not_found"].includes(result.status)) throw hindsightError("HINDSIGHT_TEMPLATE_INVALID");
      await deps.wait(100);
    }
  }
}

export interface BankProjectionState {
  status: HindsightBankSetupProjection["status"];
  operationIds: string[];
  lastVerifiedAt: string | null;
  lastError: HindsightBankSetupProjection["lastError"];
}

export function bankProjection(target: HindsightBankSetupTarget, state: BankProjectionState): HindsightBankSetupProjection {
  return {
    ...target.binding,
    templateRevision: target.template.takiTemplateRevision,
    templateDigest: target.digest,
    status: state.status,
    operationIds: state.operationIds.slice(0, 32),
    lastVerifiedAt: state.lastVerifiedAt,
    lastError: state.lastError,
  };
}
