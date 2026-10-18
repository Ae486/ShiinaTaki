/**
 * INPUT:  authenticated native manifest and the installed client method inventory
 * OUTPUT: independently admitted transition primitives on the exact new compatibility build
 * POS:    Core provider capability gate — never makes W1's absent transition driver runnable
 */
import { HINDSIGHT_TRANSITION_BUILD, HINDSIGHT_TRANSITION_VERSION, HINDSIGHT_CONFIGURATION_BUILD, HINDSIGHT_TEMPLATE_BUILD, HINDSIGHT_TEMPLATE_BACKUP_BUILD } from "@taki/shared";
import type { HindsightClient } from "./hindsight-client.ts";
import type { HindsightTransitionClient } from "./hindsight-transition-client.ts";
import type { HindsightCompatibilityWire } from "./hindsight-contracts.ts";
import { requireHindsightApplicationCapability } from "./hindsight-application-capability.ts";
import { hindsightError } from "./hindsight-errors.ts";

export function requireHindsightTransitionCapability(manifest: HindsightCompatibilityWire): { providerLineage: string } {
  const application = requireHindsightApplicationCapability(manifest);
  const contract = manifest.contracts.transitions;
  if (![HINDSIGHT_TRANSITION_BUILD, HINDSIGHT_CONFIGURATION_BUILD, HINDSIGHT_TEMPLATE_BUILD, HINDSIGHT_TEMPLATE_BACKUP_BUILD].includes(manifest.source_identity.compatibility_build) || contract?.version !== HINDSIGHT_TRANSITION_VERSION
    || contract.support.state !== "supported" || contract.support.reason !== "all_contracts_available") {
    throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  }
  return { providerLineage: application.providerLineage };
}
export function requireHindsightTransitionClient(client: HindsightClient): HindsightClient & HindsightTransitionClient {
  const methods: (keyof HindsightTransitionClient)[] = ["unusedTransitionScope", "acquireTransition", "transitionStatus",
    "claimTransition", "renewTransition", "fenceTransition", "verifyTransition", "resolveTransition", "applyTransitionDelta",
    "transitionDelta", "transitionEvidence", "transitionAuxiliary"];
  if (methods.some((method) => typeof client[method] !== "function")) throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  return client as HindsightClient & HindsightTransitionClient;
}
