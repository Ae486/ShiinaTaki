/**
 * INPUT:  a post-gate Host invocation and verified same-host installation
 * OUTPUT: bounded preparation status after a read-only authenticated fixed-slot Catalog read
 * POS:    hindsight-host — transient decoding only; C1a neither caches secrets nor starts Native
 */
import {
  HINDSIGHT_CUSTODY_LIMITS, HindsightTrustedInvocationSchema,
  type HindsightCustodyResult, type HindsightTrustedInvocation,
} from "@taki/shared/hindsight-custody";
import { canonicalCapabilityInput } from "@taki/shared/host-input";
import { sha256 } from "./installed-files.ts";
import { withSelectedCatalog } from "./catalog-selection.ts";
import type { VerifiedInstallation } from "./installation.ts";
import { CustodyError, custodyFailure } from "./custody-error.ts";

export async function prepareCustody(invocation: HindsightTrustedInvocation, installation: VerifiedInstallation,
  signal: AbortSignal): Promise<HindsightCustodyResult> {
  try {
    const request = HindsightTrustedInvocationSchema.parse(invocation);
    requireBinding(request, installation, signal);
    await withSelectedCatalog({ selection: request.input, installation, signal,
      requireCurrent: () => requireBinding(request, installation, signal) }, () => undefined);
    requireBinding(request, installation, signal);
    return {
      version: 1, state: "prepared", snapshotId: request.input.snapshotId,
      requestId: request.requestId, hostAttemptId: request.control.attemptId,
      installationId: request.input.installationId, sealedEnvelopeSha256: request.input.sealedEnvelopeSha256,
      configurationDigest: request.input.configurationDigest, deploymentReady: false,
    };
  } catch (error) {
    return custodyFailure(error);
  }
}

function requireBinding(request: HindsightTrustedInvocation, installation: VerifiedInstallation, signal: AbortSignal): void {
  installation.validate();
  const registration = installation.registration;
  const input = request.input;
  if (signal.aborted || Date.now() >= Date.parse(request.control.deadlineAt)
    || (request.control.expiresAt !== undefined && Date.now() >= Date.parse(request.control.expiresAt))) throw new CustodyError("snapshot-stale");
  if (input.coreHostId !== registration.coreHostId || input.catalogStoreId !== registration.catalogStoreId
    || input.catalogKeyVersion !== registration.catalogKeyVersion || input.installationId !== registration.installationId
    || request.control.targetHostId !== registration.executionHostId
    || JSON.stringify(request.owner) !== JSON.stringify(installation.owner)
    || sha256(canonicalCapabilityInput(request.control.capabilityId, input)) !== request.control.inputDigest) {
    throw new CustodyError("snapshot-stale");
  }
  if (Buffer.byteLength(JSON.stringify(request)) > HINDSIGHT_CUSTODY_LIMITS.requestBytes) throw new CustodyError("input-oversize");
}
