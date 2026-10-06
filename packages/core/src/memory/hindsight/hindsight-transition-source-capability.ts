/**
 * INPUT: actual authenticated compatibility response for the additive Source-evidence implementation
 * OUTPUT: independently admitted alias upload/delta support without changing legacy transition admission
 * POS: core/memory/hindsight — new operations must not dispatch to an old transitions-only manifest
 */
import { HINDSIGHT_TRANSITION_SOURCE_EVIDENCE_VERSION } from "@taki/shared";
import { HindsightCompatibilityWireSchema, type HindsightCompatibilityWire } from "./hindsight-contracts.ts";
import { requireHindsightTransitionCapability } from "./hindsight-transition-capability.ts";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";
import { hindsightError } from "./hindsight-errors.ts";

export function requireHindsightTransitionSourceCapability(manifest: HindsightCompatibilityWire): { providerLineage: string } {
  const base = requireHindsightTransitionCapability(manifest);
  const extension = manifest.contracts.transition_source_evidence;
  if (extension?.version !== HINDSIGHT_TRANSITION_SOURCE_EVIDENCE_VERSION || extension.support.state !== "supported"
    || extension.support.reason !== "all_contracts_available") throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  return base;
}
export async function probeHindsightTransitionSourceCapability(request: <T>(input: HindsightRequestInput<T>) => Promise<T>,
  context: HindsightCallContext): Promise<{ providerLineage: string }> {
  return requireHindsightTransitionSourceCapability(await request({ path: "/ext/taki-memory/version", context, schema: HindsightCompatibilityWireSchema }));
}
