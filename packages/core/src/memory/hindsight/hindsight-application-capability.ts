/**
 * INPUT:  authenticated compatibility, installed transport methods and optional persisted admission evidence
 * OUTPUT: fresh D77/G1 admission or whole-manifest reuse after a live capability/lineage check
 * POS:    core/memory/hindsight — application runtime negotiation; no authority or policy mutation
 */
import {
  HINDSIGHT_API_VERSION, HINDSIGHT_APPLICATION_STATE_BUILD, HINDSIGHT_APPLICATION_STATE_VERSION,
  HINDSIGHT_APPLICATION_PART_BYTES, HINDSIGHT_APPLICATION_RESPONSE_BYTES, HINDSIGHT_APPLICATION_UPLOAD_BYTES,
  HINDSIGHT_NATIVE_RESULT_VERSION,
  HINDSIGHT_TRANSITION_BUILD,
  HINDSIGHT_CONFIGURATION_BUILD,
  HINDSIGHT_TEMPLATE_BUILD,
  HINDSIGHT_TEMPLATE_BACKUP_BUILD,
} from "@taki/shared";
import type { HindsightClient, HindsightCallContext } from "./hindsight-client.ts";
import type { HindsightApplicationClient } from "./hindsight-application-client.ts";
import type { HindsightCompatibilityWire } from "./hindsight-contracts.ts";
import { projectHindsightCompatibilityManifest } from "./hindsight-compatibility-service.ts";
import { hindsightError } from "./hindsight-errors.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";

export type HindsightApplicationAdmissionReader = (request: () => HindsightCallContext) => HindsightCompatibilityWire;

export function requireHindsightApplicationClient(client: HindsightClient): HindsightClient & HindsightApplicationClient {
  const methods: (keyof HindsightApplicationClient)[] = ["initializeApplication", "uploadApplicationBody", "applicationBody",
    "putApplicationBodyPart", "applicationBodyPart", "sealApplicationBody", "commitApplication", "applicationCommit",
    "hydrateApplication", "createApplicationSnapshot", "applicationSnapshot", "applicationSnapshotPage",
    "applicationChanges", "applicationChangePage", "pruneApplicationChanges", "reflectApplication"];
  if (methods.some((method) => typeof client[method] !== "function")) throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  return client as HindsightClient & HindsightApplicationClient;
}

export function requireHindsightApplicationCapability(manifest: HindsightCompatibilityWire): { providerLineage: string; guardedReflect: boolean } {
  const generic = projectHindsightCompatibilityManifest(manifest);
  const contract = manifest.contracts.application_state; const factual = manifest.contracts.native_results;
  if (![HINDSIGHT_APPLICATION_STATE_BUILD, HINDSIGHT_TRANSITION_BUILD, HINDSIGHT_CONFIGURATION_BUILD, HINDSIGHT_TEMPLATE_BUILD, HINDSIGHT_TEMPLATE_BACKUP_BUILD].includes(generic.compatibilityBuild) || !generic.providerLineage
    || contract?.version !== HINDSIGHT_APPLICATION_STATE_VERSION || !supported(contract.support)
    || contract.body_part_bytes !== HINDSIGHT_APPLICATION_PART_BYTES || contract.max_response_bytes !== HINDSIGHT_APPLICATION_RESPONSE_BYTES
    || contract.max_preparation_bytes !== HINDSIGHT_APPLICATION_UPLOAD_BYTES || !contract.state_cursor_reset_supported
    || factual?.version !== HINDSIGHT_NATIVE_RESULT_VERSION || !supported(factual.support)) {
    throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  }
  const reflect = manifest.contracts.application_reflect;
  return { providerLineage: generic.providerLineage, guardedReflect: reflect?.version === HINDSIGHT_APPLICATION_STATE_VERSION
    && supported(reflect.support) && reflect.linearization === "before_each_model_submission" };
}

export async function admitHindsightApplication(input: {
  client: HindsightClient; request: () => HindsightCallContext; expectedLineage: string;
}) {
  const health = await input.client.health(input.request());
  if (health.status !== "healthy" || health.database !== "connected") throw hindsightError("HINDSIGHT_HEALTH_FAILED");
  if ((await input.client.version(input.request())).apiVersion !== HINDSIGHT_API_VERSION) throw hindsightError("HINDSIGHT_VERSION_UNSUPPORTED");
  const manifest = await input.client.compatibility(input.request());
  const admission = requireHindsightApplicationCapability(manifest);
  input.request();
  if (admission.providerLineage !== input.expectedLineage) throw new Error("HINDSIGHT_REPLICA_LINEAGE_MISMATCH");
  return { ...admission, manifest };
}

export async function resolveHindsightApplicationAdmission(input: Parameters<typeof admitHindsightApplication>[0] & {
  evidence?: HindsightCompatibilityWire;
}): ReturnType<typeof admitHindsightApplication> {
  input.request();
  requireHindsightApplicationClient(input.client);
  if (!input.evidence) return admitHindsightApplication(input);
  const manifest = await input.client.compatibility(input.request());
  input.request();
  const admission = requireHindsightApplicationCapability(manifest);
  if (admission.providerLineage !== input.expectedLineage) throw new Error("HINDSIGHT_REPLICA_LINEAGE_MISMATCH");
  if (sameApplicationValue(manifest, input.evidence)) return { ...admission, manifest: input.evidence };
  return admitHindsightApplication(input);
}

function supported(value: { state: string; reason: string }): boolean {
  return value.state === "supported" && value.reason === "all_contracts_available";
}
