/**
 * INPUT:  the complete authenticated compatibility manifest already admitted for the exact Core connection
 * OUTPUT: optional template-backup-v1 capability admission with unchanged lifecycle/transition prerequisites
 * POS:    Core backup negotiation; absent capability is a legacy branch, never a retry downgrade after refusal
 */
import { HINDSIGHT_TEMPLATE_BACKUP_BUILD, HINDSIGHT_TEMPLATE_BACKUP_VERSION } from "@taki/shared";
import type { HindsightCompatibilityWire } from "./hindsight-contracts.ts";
import { requireHindsightTemplateCapability } from "./hindsight-template-capability.ts";

export function hindsightTemplateBackupAvailable(manifest: HindsightCompatibilityWire): boolean {
  const contract = manifest.contracts.template_backup;
  if (manifest.source_identity.compatibility_build !== HINDSIGHT_TEMPLATE_BACKUP_BUILD
    || contract?.version !== HINDSIGHT_TEMPLATE_BACKUP_VERSION || contract.support.state !== "supported"
    || contract.support.reason !== "all_contracts_available") return false;
  requireHindsightTemplateCapability(manifest);
  return true;
}
