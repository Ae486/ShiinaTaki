import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPROVAL_BINDING_REVISION,
  APPROVAL_DISCLOSURE_REVISION,
  canonicalStoredApprovalDurableDecisionBinding,
  type ApprovalDurableDecision,
} from "@taki/shared";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import {
  ApprovalBindingCollisionError,
  ApprovalBindingDigestMismatchError,
  ApprovalGenerationConflictError,
  createApprovalStateRepo,
} from "./approval-state-repo.ts";

const dbs: Database[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmTempDir(dir);
});

function open(path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS });
  dbs.push(db);
  return { db, repo: createApprovalStateRepo(db) };
}

function decision(overrides: Partial<ApprovalDurableDecision> = {}): ApprovalDurableDecision {
  const binding = {
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
    decisionScopeDigest: "a".repeat(64),
    disclosureRevision: APPROVAL_DISCLOSURE_REVISION,
  } as const;
  const bindingDigest = createHash("sha256")
    .update(canonicalStoredApprovalDurableDecisionBinding(binding), "utf8")
    .digest("hex");
  return {
    decisionId: "22222222-2222-4222-8222-222222222222",
    binding,
    bindingDigest,
    provenance: "operator",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

function withBinding(
  base: ApprovalDurableDecision,
  binding: ApprovalDurableDecision["binding"],
): ApprovalDurableDecision {
  return {
    ...base,
    binding,
    bindingDigest: createHash("sha256")
      .update(canonicalStoredApprovalDurableDecisionBinding(binding), "utf8")
      .digest("hex"),
  };
}

describe("Approval state repository", () => {
  it("creates once, treats identical digest columns as a no-op, and lists deterministically", () => {
    const { repo } = open();
    expect(repo.grant(decision(), 1).approvalGeneration).toBe(2);
    expect(repo.grant(decision({
      decisionId: "33333333-3333-4333-8333-333333333333",
      provenance: "legacy-reconfirmation",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    }), 2).approvalGeneration).toBe(2);
    expect(repo.read().decisions[0]?.provenance).toBe("operator");
    const second = withBinding(decision({
      decisionId: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
    }), {
      ...decision().binding,
      identity: {
        ...decision().binding.identity,
        subject: { subjectId: "server.other", revision: "config-1" },
      },
    });
    expect(repo.grant(second, 2).approvalGeneration).toBe(3);
    expect(repo.read().decisions.map((item) => item.decisionId)).toEqual([second.decisionId, decision().decisionId]);
  });

  it("fails closed on digest collision, mismatched candidate digest, or reused decision id", () => {
    const { db, repo } = open();
    repo.grant(decision(), 1);
    expect(() => repo.grant(decision({
      decisionId: "55555555-5555-4555-8555-555555555555",
      binding: {
        ...decision().binding,
        identity: {
          ...decision().binding.identity,
          subject: { subjectId: "server.tampered", revision: "config-1" },
        },
      },
      bindingDigest: "d".repeat(64),
    }), 2)).toThrow(ApprovalBindingDigestMismatchError);
    const stored = decision();
    db.prepare("UPDATE approval_decisions SET classifier_revision = :revision WHERE decision_id = :decisionId")
      .run({ revision: 2, decisionId: stored.decisionId });
    expect(() => repo.grant(stored, 2)).toThrow(ApprovalBindingCollisionError);
    expect(repo.read()).toMatchObject({ approvalGeneration: 2, decisions: [{ provenance: "operator" }] });
  });

  it("checks stale generations before create/revoke no-op and keeps rollback exact", () => {
    const { repo } = open();
    repo.grant(decision(), 1);
    expect(() => repo.grant(decision(), 1)).toThrow(ApprovalGenerationConflictError);
    expect(() => repo.revoke("44444444-4444-4444-8444-444444444444", 1))
      .toThrow(ApprovalGenerationConflictError);
    expect(repo.revoke("44444444-4444-4444-8444-444444444444", 2)).toMatchObject({
      revoked: false, snapshot: { approvalGeneration: 2 },
    });
    expect(repo.revoke(decision().decisionId, 2)).toMatchObject({ revoked: true, snapshot: { approvalGeneration: 3 } });
  });

  it("reconciles metadata without increments and advances once for material change or deletion", () => {
    const { repo } = open();
    expect(repo.reconcile({
      governanceRegistryRevision: 2, disclosureRevision: 2, materiallyChanged: false,
    })).toMatchObject({ approvalGeneration: 1, governanceRegistryRevision: 2, disclosureRevision: 2 });
    expect(repo.reconcile({
      governanceRegistryRevision: 3, disclosureRevision: 3, materiallyChanged: true,
    }).approvalGeneration).toBe(2);
    const row = decision();
    repo.grant(row, 2);
    expect(repo.reconcile({
      governanceRegistryRevision: 4,
      disclosureRevision: 4,
      materiallyChanged: true,
      deleteDecisionIds: [row.decisionId, row.decisionId],
    })).toMatchObject({ approvalGeneration: 4, decisions: [] });
  });

  it("fails revision downgrade without deleting rows or changing metadata", () => {
    const { repo } = open();
    repo.grant(decision(), 1);
    repo.reconcile({ governanceRegistryRevision: 2, disclosureRevision: 2, materiallyChanged: false });
    expect(() => repo.reconcile({
      governanceRegistryRevision: 1,
      disclosureRevision: 2,
      materiallyChanged: true,
      deleteDecisionIds: [decision().decisionId],
    })).toThrow(/newer than code/);
    expect(repo.read()).toMatchObject({ approvalGeneration: 2, governanceRegistryRevision: 2, decisions: [{ decisionId: decision().decisionId }] });
  });

  it("persists durable rows and generation across a real close/reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-approval-repo-"));
    dirs.push(dir);
    const path = join(dir, "taki.db");
    const first = open(path);
    first.repo.grant(decision(), 1);
    first.db.close();
    const second = open(path);
    expect(second.repo.read()).toMatchObject({ approvalGeneration: 2, decisions: [{ decisionId: decision().decisionId }] });
  });
});
