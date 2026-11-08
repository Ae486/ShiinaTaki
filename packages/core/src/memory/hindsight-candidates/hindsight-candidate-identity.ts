/**
 * INPUT:  controlling Core candidate association and fresh source/candidate observations from the installed Host
 * OUTPUT: exact ownership and physical-disjointness validation with a derived loopback verifier endpoint
 * POS:    D1 verifier boundary; no resource discovery, adoption, mutation or operator-supplied endpoint
 */
import { HindsightCandidateOwnershipSchema, HindsightCandidatePhysicalIdentitySchema,
  type HindsightCandidateOwnership, type HindsightCandidatePhysicalIdentity } from "@taki/shared";
import { transitionLocalHash } from "../transitions/transition-local-encoding.ts";
import { refuse } from "./hindsight-candidate-refusal.ts";

export function verifyCandidateIdentity(input: {
  ownership: HindsightCandidateOwnership; candidate: HindsightCandidatePhysicalIdentity; sources: HindsightCandidatePhysicalIdentity[];
}) {
  const owner = HindsightCandidateOwnershipSchema.safeParse(input.ownership);
  const target = HindsightCandidatePhysicalIdentitySchema.safeParse(input.candidate);
  const sources = input.sources.map((source) => HindsightCandidatePhysicalIdentitySchema.safeParse(source));
  if (!owner.success || !target.success || !sources.length || sources.some((source) => !source.success)) refuse("unreadable", "identity");
  const candidate = target.data;
  if (candidate.role !== "candidate" || candidate.resourceId !== owner.data.candidateId) refuse("foreign", "identity");
  for (const key of ["coreHostId", "executionHostId", "installationId", "engineId", "imageId"] as const) {
    if (candidate[key] !== owner.data[key]) refuse("foreign", "identity", { name: key });
  }
  if (candidate.volumes.some((volume) => volume.writableAttachments.length !== 1 || volume.writableAttachments[0] !== candidate.containerId)) {
    refuse("foreign", "identity", { name: "writableAttachments" });
  }
  for (const parsed of sources) {
    if (!parsed.success) refuse("unreadable", "identity");
    const source = parsed.data;
    if (source.role !== "source" || source.coreHostId !== candidate.coreHostId) refuse("foreign", "identity");
    assertDisjoint(source, candidate);
  }
  return { identity: candidate, identityHash: transitionLocalHash(candidate),
    sourceIdentityHash: transitionLocalHash(input.sources), endpoint: `http://127.0.0.1:${candidate.listener.port}` };
}

function assertDisjoint(source: HindsightCandidatePhysicalIdentity, candidate: HindsightCandidatePhysicalIdentity) {
  if (source.resourceId === candidate.resourceId || source.containerId === candidate.containerId
    || source.postgres.systemIdentifier === candidate.postgres.systemIdentifier
    || source.listener.processIdentity === candidate.listener.processIdentity
    || source.executionHostId === candidate.executionHostId && source.listener.port === candidate.listener.port
    || source.volumes.some((old) => candidate.volumes.some((next) => old.backingId === next.backingId
      || source.engineId === candidate.engineId && old.name === next.name
      || old.writableAttachments.includes(candidate.containerId)))) refuse("not_isolated", "identity");
}
