import { describe, expect, it, vi } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
import type { HindsightCandidateProvenance } from "@taki/shared";
import { candidateFixture, candidateIdentities, binaryCopy } from "./hindsight-candidate-fixtures.ts";
import { verifyHindsightCandidate, type CandidateObserver, type CandidateInventorySnapshot } from "./hindsight-candidate-verifier.ts";
import { verifyCandidateIdentity } from "./hindsight-candidate-identity.ts";

describe("candidate verification evidence gates (deterministic producer substitutes)", () => {
  it("keeps offline and provenance-missing work explicitly unverified and never contacts a client", async () => {
    const f = await candidateFixture();
    try {
      const identities = candidateIdentities();
      const input = { ...f, ownership: identities.ownership, missingCredentials: () => [] };
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "unverified", identityHash: null,
        missing: ["physical_identity", "restored_equality", "fresh_template_observation", "environment_provenance"] });
      const client = vi.fn(() => f.client);
      const observer: CandidateObserver = { observe: async () => ({ ...identities, schema: f.targetSchema, sourceAuthorityHash: "a".repeat(64), provenance: null }),
        assertCurrent: () => undefined, client, openInventory: async () => copySnapshot(f) };
      expect(await verifyHindsightCandidate({ ...input, observer })).toMatchObject({ stage: "unverified",
        missing: ["environment_provenance", "fresh_template_observation"] });
      expect(client).not.toHaveBeenCalled();
    } finally { await f.close(); }
  }, 30_000);

  it("computes restored equality from every COPY stream before fresh v2 observation and rejects subsequent drift", async () => {
    const f = await candidateFixture("removed");
    try {
      const identities = candidateIdentities(); const identity = verifyCandidateIdentity(identities);
      const environment = { postgresVersion: "fixture-postgresql-18.1", softwareArtifactHash: "2".repeat(64), databaseEncoding: "UTF8" as const,
        extensions: [{ name: "vector", version: "fixture-0.8" }],
        schemaObjectsHash: "4".repeat(64), bodyStorage: "postgresql" as const };
      const provenance: HindsightCandidateProvenance = { archiveSha256: f.manifest.native.proof.zipSha256,
        sourceCapture: { backupId: f.manifest.backupId, requestHash: f.manifest.requestHash, coreSha256: f.manifest.core.sha256, evidenceHash: "3".repeat(64) },
        sourceIdentityHash: identity.sourceIdentityHash, candidateIdentityHash: identity.identityHash, source: environment, candidate: environment,
        executionFence: { profile: "archive-validation-only-v1", evidenceHash: "5".repeat(64) } };
      const observed = { ...identities, schema: f.targetSchema, sourceAuthorityHash: "6".repeat(64), provenance };
      const reads: string[] = []; const client = vi.fn(() => f.client);
      const observer: CandidateObserver = { observe: async () => observed, assertCurrent: () => undefined, client,
        openInventory: async () => ({ schema: f.targetSchema, close: async () => undefined,
          copyTable: async function* (name) { reads.push(name); yield f.streams[name]!; } }) };
      const input = { ...f, ownership: identities.ownership, observer, missingCredentials: () => [] };
      const result = await verifyHindsightCandidate(input);
      expect(result).toMatchObject({ stage: "baseline_verified", candidateId: identities.ownership.candidateId, observedTemplates: 2 });
      expect(result).not.toHaveProperty("deploymentReady"); expect(reads).toHaveLength(122);
      expect(client).toHaveBeenCalledWith("http://127.0.0.1:18489");
      expect(f.h.observer.requests.length).toBeGreaterThan(1);
      expect(new Set(f.h.observer.requests.map((request) => request.nonce)).size).toBe(f.h.observer.requests.length);

      client.mockClear(); observer.openInventory = async () => copySnapshot({ ...f, streams: { ...f.streams, async_operations: binaryCopy([]) } });
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "refused", refusal: { reason: "tampered", subject: "table", name: "async_operations" } });
      expect(client).not.toHaveBeenCalled();
      observer.openInventory = async () => copySnapshot(f);
      let calls = 0; observer.observe = async () => { if (++calls === 2) observed.sourceAuthorityHash = "7".repeat(64); return observed; };
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "refused", refusal: { reason: "tampered", subject: "identity" } });
      client.mockClear(); let revoked = false;
      observer.assertCurrent = () => { if (revoked) throw new Error("installed session was revoked"); };
      observer.openInventory = async () => ({ ...copySnapshot(f), copyTable: async function* (name) { revoked = true; yield f.streams[name]!; } });
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "refused", refusal: { reason: "unreadable" } });
      expect(client).not.toHaveBeenCalled();
      observer.assertCurrent = () => undefined; observer.observe = async () => observed; let snapshots = 0;
      observer.openInventory = async () => copySnapshot(++snapshots === 1 ? f : { ...f, streams: { ...f.streams, async_operations: binaryCopy([]) } });
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "refused", refusal: { reason: "tampered", subject: "table" } });
      expect(snapshots).toBe(2);
    } finally { await f.close(); }
  }, 30_000);

  it("refuses mismatched provenance, selected context drift, unavailable observation and foreign endpoints", async () => {
    const f = await candidateFixture();
    try {
      const identities = candidateIdentities(); const identity = verifyCandidateIdentity(identities);
      const environment = { postgresVersion: "fixture-postgresql-18.1", softwareArtifactHash: "2".repeat(64), databaseEncoding: "UTF8" as const,
        extensions: [{ name: "vector", version: "fixture-0.8" }],
        schemaObjectsHash: "4".repeat(64), bodyStorage: "postgresql" as const };
      const observed = { ...identities, schema: f.targetSchema, sourceAuthorityHash: "6".repeat(64), provenance: {
        archiveSha256: f.manifest.native.proof.zipSha256, sourceIdentityHash: identity.sourceIdentityHash, candidateIdentityHash: identity.identityHash,
        sourceCapture: { backupId: f.manifest.backupId, requestHash: f.manifest.requestHash, coreSha256: f.manifest.core.sha256, evidenceHash: "3".repeat(64) },
        source: environment, candidate: structuredClone(environment), executionFence: { profile: "archive-validation-only-v1" as const, evidenceHash: "5".repeat(64) } } };
      const observer: CandidateObserver = { observe: async () => observed, assertCurrent: () => undefined, client: () => f.client,
        openInventory: async () => copySnapshot(f) };
      const input = { ...f, ownership: identities.ownership, observer, missingCredentials: () => [] };
      observed.provenance.sourceCapture.backupId = identities.ownership.candidateId;
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "refused", refusal: { reason: "foreign", subject: "identity" } });
      observed.provenance.sourceCapture.backupId = f.manifest.backupId;
      observed.provenance.candidate.schemaObjectsHash = "8".repeat(64);
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "refused", refusal: { reason: "unsupported", subject: "schema" } });
      observed.provenance.candidate.schemaObjectsHash = environment.schemaObjectsHash;
      f.h.observer.contexts.set(f.manifest.banks[0]!.nativeBankId, "9".repeat(64));
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "refused", refusal: { subject: "template" } });
      f.h.observer.contexts.clear(); observer.observe = async () => { throw new Error("private path and credential must not escape"); };
      const result = await verifyHindsightCandidate(input);
      expect(result).toMatchObject({ stage: "refused", refusal: { reason: "unreadable", name: null } });
      expect(JSON.stringify(result)).not.toContain("credential must");
      observer.observe = async () => observed; observed.candidate.listener.port = observed.sources[0]!.listener.port;
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "refused", refusal: { reason: "not_isolated" } });
    } finally { await f.close(); }
  }, 30_000);

  it("requires an independent restored snapshot and binds historical source evidence to the original capture", async () => {
    const f = await candidateFixture();
    try {
      const observed = observedFixture(f);
      // A restarted source can have another current physical identity; the archived identity stays historical.
      observed.provenance.sourceIdentityHash = "9".repeat(64);
      const client = vi.fn(() => f.client);
      const observer: CandidateObserver = { observe: async () => observed, assertCurrent: () => undefined, client };
      const input = { ...f, ownership: observed.ownership, observer, missingCredentials: () => [] };
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "unverified",
        missing: ["restored_equality", "fresh_template_observation"] });
      expect(client).not.toHaveBeenCalled();
      const open = vi.fn(async () => copySnapshot(f)); observer.openInventory = open;
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "baseline_verified" });
      expect(open).toHaveBeenCalledTimes(2);
      for (const key of ["requestHash", "coreSha256"] as const) {
        open.mockClear(); client.mockClear();
        const original = observed.provenance.sourceCapture[key]; observed.provenance.sourceCapture[key] = "0".repeat(64);
        expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "refused", refusal: { reason: "foreign", subject: "identity" } });
        expect(open).not.toHaveBeenCalled(); expect(client).not.toHaveBeenCalled();
        observed.provenance.sourceCapture[key] = original;
      }
      observed.provenance.archiveSha256 = "0".repeat(64);
      expect(await verifyHindsightCandidate(input)).toMatchObject({ stage: "refused", refusal: { reason: "foreign", subject: "identity" } });
      expect(open).not.toHaveBeenCalled(); expect(client).not.toHaveBeenCalled();
    } finally { await f.close(); }
  }, 30_000);

  it.each(["archive", "sidecar"] as const)("refuses %s mutation during selected-template observation", async (mutation) => {
    const f = await candidateFixture();
    try {
      const observed = observedFixture(f); const closed = vi.fn(async () => undefined);
      const observeTemplateBackup = f.client.observeTemplateBackup;
      if (!observeTemplateBackup) throw new Error("candidate fixture requires the v2 observer");
      const client = { ...f.client, observeTemplateBackup: async (request: Parameters<typeof observeTemplateBackup>[0]) => {
        const reply = await observeTemplateBackup(request);
        if (mutation === "archive") appendFileSync(f.archivePath, Buffer.from([0]));
        else writeFileSync(f.corePath + "-wal", Buffer.alloc(0));
        return reply;
      } };
      const observer: CandidateObserver = { observe: async () => observed, assertCurrent: () => undefined, client: () => client,
        openInventory: async () => ({ ...copySnapshot(f), close: closed }) };
      expect(await verifyHindsightCandidate({ ...f, ownership: observed.ownership, observer, missingCredentials: () => [] }))
        .toMatchObject({ stage: "refused", refusal: mutation === "archive" ? { reason: "tampered", subject: "archive" }
          : { reason: "unsupported", subject: "core", name: "live_sidecar" } });
      expect(closed).toHaveBeenCalledTimes(2);
    } finally { await f.close(); }
  }, 30_000);
});

function copySnapshot(f: Pick<Awaited<ReturnType<typeof candidateFixture>>, "targetSchema" | "streams">): CandidateInventorySnapshot {
  return { schema: f.targetSchema, copyTable: async function* (name) { yield f.streams[name]!; }, close: async () => undefined };
}

function observedFixture(f: Awaited<ReturnType<typeof candidateFixture>>) {
  const identities = candidateIdentities(); const identity = verifyCandidateIdentity(identities);
  const environment = { postgresVersion: "fixture-postgresql-18.1", softwareArtifactHash: "2".repeat(64), databaseEncoding: "UTF8" as const,
    extensions: [{ name: "vector", version: "fixture-0.8" }], schemaObjectsHash: "4".repeat(64), bodyStorage: "postgresql" as const };
  return { ...identities, schema: f.targetSchema, sourceAuthorityHash: "6".repeat(64), provenance: {
    archiveSha256: f.manifest.native.proof.zipSha256, sourceIdentityHash: identity.sourceIdentityHash, candidateIdentityHash: identity.identityHash,
    sourceCapture: { backupId: f.manifest.backupId, requestHash: f.manifest.requestHash, coreSha256: f.manifest.core.sha256, evidenceHash: "3".repeat(64) },
    source: environment, candidate: structuredClone(environment), executionFence: { profile: "archive-validation-only-v1" as const, evidenceHash: "5".repeat(64) } } };
}
