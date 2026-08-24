/**
 * INPUT:  deterministic Bank/template targets and an authenticated Hindsight client
 * OUTPUT: bounded dry-run requests used before any remote Bank mutation
 * POS:    core/memory/hindsight — setup preflight stage; no persistence or authority changes
 */
import type { HindsightConnectionProjection } from "@taki/shared";
import type { HindsightClient, HindsightCallContext } from "./hindsight-client.ts";
import { hindsightBankBindings } from "./hindsight-bank-identity.ts";
import type { HindsightBankSetupTarget } from "./hindsight-bank-setup.ts";
import { loadTakiBankTemplate, takiBankTemplateDigest } from "./taki-bank-template-v1.ts";

export function setupTargets(revision: string, characterId: string): HindsightBankSetupTarget[] {
  return hindsightBankBindings(characterId).map((binding) => {
    const template = loadTakiBankTemplate(revision, binding.scope);
    return { binding, template, digest: takiBankTemplateDigest(template) };
  });
}

export async function dryRunTemplates(input: {
  targets: HindsightBankSetupTarget[];
  client: HindsightClient;
  connection: HindsightConnectionProjection;
  signal: AbortSignal;
  attemptId: string | null;
}): Promise<Array<{ dry_run?: boolean }>> {
  return Promise.all(input.targets.map(({ binding, template }) => {
    const context: HindsightCallContext = {
      timeoutMs: input.connection.requestTimeoutMs,
      signal: input.signal,
      attemptId: input.attemptId ?? undefined,
    };
    return input.client.importTemplate({ bankId: binding.externalBankId, template: template.manifest, dryRun: true, context });
  }));
}
