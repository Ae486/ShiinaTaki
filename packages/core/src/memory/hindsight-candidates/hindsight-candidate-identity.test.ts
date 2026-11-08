import { describe, expect, it } from "vitest";
import { candidateIdentities } from "./hindsight-candidate-fixtures.ts";
import { verifyCandidateIdentity } from "./hindsight-candidate-identity.ts";

describe("physical candidate identity", () => {
  it("derives the endpoint from a matching owned candidate and physically disjoint source", () => {
    const f = candidateIdentities(); const result = verifyCandidateIdentity(f);
    expect(result.endpoint).toBe("http://127.0.0.1:18489"); expect(result.identityHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(["coreHostId", "executionHostId", "installationId", "engineId", "imageId"] as const)("refuses foreign %s", (key) => {
    const f = candidateIdentities(); f.ownership[key] = candidateIdentities().ownership[key] === f.ownership[key]
      ? key === "imageId" ? `sha256:${"0".repeat(64)}` : "foreign-engine" : candidateIdentities().ownership[key];
    expect(() => verifyCandidateIdentity(f)).toThrow();
  });
  it("refuses a source endpoint, shared storage/cluster/container and foreign writable attachment", () => {
    const mutations = [
      (f: ReturnType<typeof candidateIdentities>) => { f.candidate.listener.port = f.sources[0]!.listener.port; },
      (f: ReturnType<typeof candidateIdentities>) => { f.candidate.volumes[0]!.backingId = f.sources[0]!.volumes[0]!.backingId; },
      (f: ReturnType<typeof candidateIdentities>) => { f.candidate.postgres = f.sources[0]!.postgres; },
      (f: ReturnType<typeof candidateIdentities>) => { f.candidate.containerId = f.sources[0]!.containerId; },
      (f: ReturnType<typeof candidateIdentities>) => { f.candidate.volumes[0]!.writableAttachments.push("0".repeat(64)); },
      (f: ReturnType<typeof candidateIdentities>) => { f.candidate.role = "source"; },
    ];
    for (const mutate of mutations) { const f = candidateIdentities(); mutate(f); expect(() => verifyCandidateIdentity(f)).toThrow(); }
    const f = candidateIdentities(); f.sources = []; expect(() => verifyCandidateIdentity(f)).toThrow();
  });
});
