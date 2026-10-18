/**
 * INPUT:  authenticated complete Native compatibility manifest
 * OUTPUT: exact optional lifecycle admission after every existing transition prerequisite
 * POS:    core/memory/hindsight — B1 negotiation only; B2 owns operation/runtime wiring
 */
import { HINDSIGHT_TEMPLATE_BUILD, HINDSIGHT_TEMPLATE_VERSION, HINDSIGHT_TEMPLATE_BACKUP_BUILD } from "@taki/shared";
import type { HindsightCompatibilityWire } from "./hindsight-contracts.ts";
import { hindsightError } from "./hindsight-errors.ts";
import { requireHindsightTransitionCapability } from "./hindsight-transition-capability.ts";

export function requireHindsightTemplateCapability(manifest: HindsightCompatibilityWire): { providerLineage: string } {
  const transition = requireHindsightTransitionCapability(manifest);
  const contract = manifest.contracts.template_lifecycle;
  if (![HINDSIGHT_TEMPLATE_BUILD, HINDSIGHT_TEMPLATE_BACKUP_BUILD].includes(manifest.source_identity.compatibility_build) || contract?.version !== HINDSIGHT_TEMPLATE_VERSION
    || contract.support.state !== "supported" || contract.support.reason !== "all_contracts_available") {
    throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  }
  return transition;
}
