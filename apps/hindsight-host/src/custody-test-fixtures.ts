/**
 * INPUT:  checked-in non-secret Shared protocol fixtures and isolated test time
 * OUTPUT: fresh valid C1 controls and prepared status for Host tests
 * POS:    hindsight-host/testing — no platform trust, key source or production registration is fabricated
 */
import { readFileSync } from "node:fs";
import { HindsightTrustedInvocationSchema, type HindsightCustodyResult, type HindsightTrustedInvocation } from "@taki/shared/hindsight-custody";
import { canonicalHostGovernanceProjection } from "@taki/shared/host-control";
import { canonicalCapabilityInput } from "@taki/shared/host-input";
import { sha256 } from "./installed-files.ts";

export function invocationFixture(posture: "ask" | "auto" = "auto"): HindsightTrustedInvocation {
  const invocation = HindsightTrustedInvocationSchema.parse(JSON.parse(readFileSync(new URL("../../../packages/shared/fixtures/protocol/hindsight-custody-invocation.windows.valid.json", import.meta.url), "utf8")));
  invocation.control.dispatchedAt = new Date().toISOString(); invocation.control.deadlineAt = new Date(Date.now() + 60_000).toISOString();
  invocation.control.governanceProjection.cells[0]!.posture = posture;
  const projection = invocation.control.governanceProjection;
  projection.digest = sha256(canonicalHostGovernanceProjection({ registryRevision: projection.registryRevision,
    descriptorRevision: projection.descriptorRevision, classifierRevision: projection.classifierRevision, cells: projection.cells }));
  invocation.control.inputDigest = sha256(canonicalCapabilityInput(invocation.control.capabilityId, invocation.input));
  return invocation;
}
export function preparedFixture(invocation: HindsightTrustedInvocation): HindsightCustodyResult {
  return { version: 1, state: "prepared", snapshotId: invocation.input.snapshotId, requestId: invocation.requestId,
    hostAttemptId: invocation.control.attemptId, installationId: invocation.input.installationId,
    sealedEnvelopeSha256: invocation.input.sealedEnvelopeSha256, configurationDigest: invocation.input.configurationDigest,
    deploymentReady: false };
}
