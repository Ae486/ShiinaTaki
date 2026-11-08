/**
 * INPUT:  original template executor guards, the published runtime and the ordinary authenticated sync implementation
 * OUTPUT: complete old-runtime retirement and private Bank synchronization while the durable hold is active
 * POS:    rollout-only runtime seam — no scheduler start, Pending replay, provider model work or early runtime admission
 */
import type { ConfigSource } from "../../../config/config-source.ts";
import type { MemoryConfig } from "../../../config/memory-config.ts";
import type { Database } from "../../../db/sqlite.ts";
import type { SecretCatalogService } from "../../../secrets/secret-catalog-service.ts";
import type { HindsightRuntimeBinding } from "../../hindsight-runtime-binding.ts";
import type { HindsightClient } from "../hindsight-client.ts";
import { createHindsightRuntimeConnection } from "../hindsight-runtime-connection.ts";
import { createHindsightRuntimeState } from "../hindsight-runtime-state.ts";
import { readTemplateBankReceipt } from "./template-native-evidence-store.ts";
import type { TemplateRuntimeCall, TemplateRuntimeControl } from "./template-rollout.ts";
import { templateProjectionLabelGroup } from "./template-runtime-selection.ts";
import { templateEqual } from "./template-integrity.ts";

interface Dependencies {
  db: Database; config: MemoryConfig; binding: HindsightRuntimeBinding; alive(): void; settle(): Promise<void>;
  replaceBinding(epochId: string): Promise<void>;
  verifySelectedAuthority?: TemplateRuntimeControl["verifySelectedAuthority"];
  connection?: { source: ConfigSource; secrets: SecretCatalogService; client?: HindsightClient };
}

export function createTemplateRuntimeControl(deps: Dependencies): TemplateRuntimeControl {
  return {
    verifySelectedAuthority: deps.verifySelectedAuthority,
    quiesce: async (input) => {
      deps.alive(); input.assertCurrent();
      // Retirement closes every old read/write owner and scheduler synchronously. A hung completion
      // keeps this plan held; W6 can still quarantine that epoch without joining its remote reply.
      await deps.binding.retire();
      await deps.settle();
      deps.alive(); input.assertCurrent();
    },
    synchronize: (input) => synchronize(deps, input),
    replaceBinding: deps.replaceBinding,
    boundSelectionIdentity: () => {
      const runtime = deps.binding.current()?.state.runtime;
      if (!runtime) return null;
      try { runtime.assertConnection(); return runtime.templateSelectionIdentity; }
      catch { return null; }
    },
  };
}

async function synchronize(deps: Dependencies, input: Parameters<TemplateRuntimeControl["synchronize"]>[0]): Promise<void> {
  deps.alive(); input.assertCurrent();
  if (!deps.connection) throw new Error("MEMORY_TEMPLATE_BINDING_UNAVAILABLE");
  const runtime = createHindsightRuntimeConnection({ db: deps.db, epochId: input.plan.guard.epochId,
    config: deps.connection.source, secrets: deps.connection.secrets, client: deps.connection.client,
    templateExecution: { planId: input.plan.planId, provisionBankId: input.plan.guard.provisionBankId, assertCurrent: () => assertCurrent(deps, input),
      labelGroup: (scope) => {
        assertCurrent(deps, input);
        if (scope.bankId !== input.bank.identity.target.bank_id || !templateEqual(scope.namespace, input.bank.namespace)
          || !readTemplateBankReceipt(deps.db, { planId: input.plan.planId, bank: input.bank })) throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
        return templateProjectionLabelGroup(input.bank.preview.projection);
      } } });
  const state = createHindsightRuntimeState({ db: deps.db, runtime, config: deps.config });
  try {
    await state.service.synchronize({ bankId: input.bank.identity.target.bank_id,
      context: { timeoutMs: runtime.connection.setupTimeoutMs, signal: input.signal } });
    assertCurrent(deps, input);
  } finally {
    runtime.stop(); state.sync.stop();
    await Promise.allSettled([state.service.stop(), state.writer.stop(), state.writes.stop(), state.provider.stop(), state.sync.settle()]);
  }
}

function assertCurrent(deps: Dependencies, input: TemplateRuntimeCall): void {
  input.signal.throwIfAborted(); deps.alive(); input.assertCurrent();
}
