import { createHash } from "node:crypto";
import {
  APPROVAL_BINDING_REVISION,
  APPROVAL_DISCLOSURE_REVISION,
  CANONICAL_GOVERNANCE_REGISTRY,
  canonicalApprovalDecisionScope,
  canonicalStoredApprovalDurableDecisionBinding,
  type ApprovalDurableDecisionBinding,
  type GovernanceRegistry,
} from "@taki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { ApprovalBindingValidationError } from "./approval-binding.ts";
import { createApprovalDecisionService } from "./approval-decision-service.ts";
import { createApprovalStateRepo } from "./approval-state-repo.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function openService(initialRegistry: GovernanceRegistry = CANONICAL_GOVERNANCE_REGISTRY) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const repo = createApprovalStateRepo(db);
  return { db, repo, service: createApprovalDecisionService(repo, initialRegistry) };
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function binding(overrides: Partial<ApprovalDurableDecisionBinding> = {}): ApprovalDurableDecisionBinding {
  const scope = {
    bindingRevision: APPROVAL_BINDING_REVISION,
    identity: {
      capabilityId: "mcp.tool.call",
      ownerHostId: "11111111-1111-4111-8111-111111111111",
      subject: { subjectId: "server.tool", revision: "config-1" },
    },
    descriptorRevision: 1,
    classifierId: "mcp-tool-call",
    classifierRevision: 1,
    cellKey: "mcp-tool-call",
  } as const;
  return {
    ...scope,
    decisionScopeDigest: digest(canonicalApprovalDecisionScope(scope)),
    disclosureRevision: APPROVAL_DISCLOSURE_REVISION,
    ...overrides,
  };
}

function registry(revision: number, descriptorRevision: number): GovernanceRegistry {
  return {
    ...CANONICAL_GOVERNANCE_REGISTRY,
    registryRevision: revision,
    descriptors: CANONICAL_GOVERNANCE_REGISTRY.descriptors.map((descriptor) =>
      descriptor.capabilityId === "mcp.tool.call" ? { ...descriptor, descriptorRevision } : descriptor),
  };
}

describe("Approval decision service", () => {
  it("grants only a current canonical always binding and makes duplicate grants no-ops", () => {
    const { service } = openService();
    expect(service.grantAlways({ binding: binding(), expectedApprovalGeneration: 1 }).approvalGeneration).toBe(2);
    expect(service.grantAlways({
      binding: binding(), expectedApprovalGeneration: 2,
      decisionId: "22222222-2222-4222-8222-222222222222",
      now: "2026-08-14T00:00:00.000Z",
    }).approvalGeneration).toBe(2);
    expect(service.list()).toEqual([expect.objectContaining({ verdict: "allow", usability: { usable: true } })]);
  });

  it("rejects descriptor, classifier, cell, subject, scope, and once-only candidates", () => {
    const { service } = openService();
    const candidates = [
      binding({ descriptorRevision: 2 }),
      binding({ classifierId: "fixed-risk" }),
      binding({ cellKey: "screenshot" }),
      binding({ identity: { capabilityId: "mcp.tool.call", ownerHostId: binding().identity.ownerHostId } }),
      binding({ decisionScopeDigest: "b".repeat(64) }),
      binding({
        identity: { capabilityId: "skill.load", ownerHostId: binding().identity.ownerHostId, subject: { subjectId: "skill-a", revision: "hash-a" } },
        classifierId: "skill-load",
        cellKey: "skill-load",
        decisionScopeDigest: "c".repeat(64),
      }),
    ];
    for (const candidate of candidates) {
      expect(() => service.grantAlways({ binding: candidate, expectedApprovalGeneration: 1 }))
        .toThrow(ApprovalBindingValidationError);
    }
    expect(service.snapshot().approvalGeneration).toBe(1);
  });

  it("lists historical or corrupted stored rows as inert with digest corruption taking priority", () => {
    const { db, service } = openService();
    const current = binding();
    const historical = { ...current, bindingRevision: 2, disclosureRevision: 2 };
    db.prepare(`INSERT INTO approval_decisions (
      decision_id,binding_revision,binding_digest,capability_id,owner_host_id,subject_id,subject_revision,
      descriptor_revision,classifier_id,classifier_revision,cell_key,decision_scope_digest,disclosure_revision,
      provenance,created_at,updated_at
    ) VALUES (
      :decisionId,:bindingRevision,:bindingDigest,:capabilityId,:ownerHostId,:subjectId,:subjectRevision,
      :descriptorRevision,:classifierId,:classifierRevision,:cellKey,:decisionScopeDigest,:disclosureRevision,
      'operator',:createdAt,:updatedAt
    )`).run({
      decisionId: "33333333-3333-4333-8333-333333333333",
      bindingRevision: historical.bindingRevision,
      bindingDigest: digest(canonicalStoredApprovalDurableDecisionBinding(historical)),
      capabilityId: historical.identity.capabilityId,
      ownerHostId: historical.identity.ownerHostId,
      subjectId: historical.identity.subject?.subjectId ?? null,
      subjectRevision: historical.identity.subject?.revision ?? null,
      descriptorRevision: historical.descriptorRevision,
      classifierId: historical.classifierId,
      classifierRevision: historical.classifierRevision,
      cellKey: historical.cellKey,
      decisionScopeDigest: historical.decisionScopeDigest,
      disclosureRevision: historical.disclosureRevision,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    });
    expect(service.list()[0]?.usability).toEqual({ usable: false, reason: "binding_revision_mismatch" });
    db.prepare("UPDATE approval_decisions SET binding_digest = :digest").run({ digest: "f".repeat(64) });
    expect(service.list()[0]?.usability).toEqual({ usable: false, reason: "binding_digest_mismatch" });
  });

  it("lists a historical identity grammar as inert instead of failing row deserialization", () => {
    const { db, service } = openService();
    const historical = {
      ...binding(),
      identity: {
        capabilityId: "mcp.tool.call",
        ownerHostId: "legacy-host-key",
        subject: { subjectId: "Server/Tool", revision: "Config Revision 1" },
      },
    };
    db.prepare(`INSERT INTO approval_decisions (
      decision_id,binding_revision,binding_digest,capability_id,owner_host_id,subject_id,subject_revision,
      descriptor_revision,classifier_id,classifier_revision,cell_key,decision_scope_digest,disclosure_revision,
      provenance,created_at,updated_at
    ) VALUES (
      :decisionId,:bindingRevision,:bindingDigest,:capabilityId,:ownerHostId,:subjectId,:subjectRevision,
      :descriptorRevision,:classifierId,:classifierRevision,:cellKey,:decisionScopeDigest,:disclosureRevision,
      'operator',:createdAt,:updatedAt
    )`).run({
      decisionId: "44444444-4444-4444-8444-444444444444",
      bindingRevision: historical.bindingRevision,
      bindingDigest: digest(canonicalStoredApprovalDurableDecisionBinding(historical)),
      capabilityId: historical.identity.capabilityId,
      ownerHostId: historical.identity.ownerHostId,
      subjectId: historical.identity.subject.subjectId,
      subjectRevision: historical.identity.subject.revision,
      descriptorRevision: historical.descriptorRevision,
      classifierId: historical.classifierId,
      classifierRevision: historical.classifierRevision,
      cellKey: historical.cellKey,
      decisionScopeDigest: historical.decisionScopeDigest,
      disclosureRevision: historical.disclosureRevision,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    });
    expect(service.list()[0]?.usability).toEqual({ usable: false, reason: "subject_binding_mismatch" });
  });

  it("rotates process epoch without changing durable generation or decisions", () => {
    const { repo, service } = openService();
    service.grantAlways({ binding: binding(), expectedApprovalGeneration: 1 });
    const restarted = createApprovalDecisionService(repo);
    expect(restarted.processEpoch).not.toBe(service.processEpoch);
    expect(restarted.snapshot()).toMatchObject({ approvalGeneration: 2, decisions: [{ binding: binding() }] });
  });

  it("advances once when historical registry authority becomes inert", () => {
    const historical = registry(1, 1);
    const { repo, service } = openService(historical);
    service.grantAlways({ binding: binding(), expectedApprovalGeneration: 1 });
    const current = registry(2, 2);
    const upgraded = createApprovalDecisionService(repo, current, (revision) => revision === 1 ? historical : undefined);
    expect(upgraded.snapshot()).toMatchObject({ approvalGeneration: 3, governanceRegistryRevision: 2 });
    expect(upgraded.list()[0]?.usability).toEqual({ usable: false, reason: "descriptor_revision_mismatch" });
  });

  it("does not advance when a historical decision remains inert", () => {
    const original = registry(1, 1);
    const { repo, service } = openService(original);
    service.grantAlways({ binding: binding(), expectedApprovalGeneration: 1 });
    const historical = registry(2, 2);
    const inert = createApprovalDecisionService(repo, historical, (revision) => revision === 1 ? original : undefined);
    expect(inert.list()[0]?.usability).toEqual({ usable: false, reason: "descriptor_revision_mismatch" });
    const generation = inert.snapshot().approvalGeneration;
    const current = registry(3, 3);
    const upgraded = createApprovalDecisionService(repo, current, (revision) => revision === 2 ? historical : undefined);
    expect(upgraded.snapshot()).toMatchObject({ approvalGeneration: generation, governanceRegistryRevision: 3 });
  });

  it("fails closed when decisions need an unavailable historical registry", () => {
    const { repo, service } = openService(registry(1, 1));
    service.grantAlways({ binding: binding(), expectedApprovalGeneration: 1 });
    expect(() => createApprovalDecisionService(repo, registry(2, 2))).toThrow(
      "historical governance registry 1 is unavailable",
    );
    expect(repo.read()).toMatchObject({ approvalGeneration: 2, governanceRegistryRevision: 1 });
  });

  it("fails closed on stored binding digest corruption before revision reconciliation", () => {
    const { db, repo, service } = openService(registry(1, 1));
    service.grantAlways({ binding: binding(), expectedApprovalGeneration: 1 });
    db.prepare("UPDATE approval_decisions SET binding_digest = :digest").run({ digest: "f".repeat(64) });
    expect(() => createApprovalDecisionService(repo, registry(2, 2), (revision) =>
      revision === 1 ? registry(1, 1) : undefined)).toThrow("binding digest corruption");
    expect(repo.read()).toMatchObject({ approvalGeneration: 2, governanceRegistryRevision: 1 });
  });

  it("advances the generic seam and revokes with optimistic generation semantics", () => {
    const { service } = openService();
    service.grantAlways({ binding: binding(), expectedApprovalGeneration: 1 });
    const decisionId = service.list()[0]?.decisionId;
    expect(service.advanceGeneration(2).approvalGeneration).toBe(3);
    expect(service.revoke(decisionId!, 3)).toMatchObject({ revoked: true, snapshot: { approvalGeneration: 4 } });
  });

  it("does not evaluate current governance posture or persist optional safe labels", () => {
    const { service } = openService();
    service.grantAlways({ binding: binding(), expectedApprovalGeneration: 1 });
    const decisionId = service.list()[0]?.decisionId;
    const labels = new Map([[decisionId!, { capability: "Configured MCP tool" }]]);
    expect(service.list(labels)[0]).toMatchObject({ labels: { capability: "Configured MCP tool" }, usability: { usable: true } });
    expect(JSON.stringify(service.snapshot())).not.toContain("Configured MCP tool");
    expect(CANONICAL_GOVERNANCE_REGISTRY.registryRevision).toBe(service.snapshot().governanceRegistryRevision);
  });
});
