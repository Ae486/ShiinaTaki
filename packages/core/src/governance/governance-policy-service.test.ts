import { CANONICAL_GOVERNANCE_REGISTRY } from "@taki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createGovernancePolicyRepo } from "./governance-policy-repo.ts";
import { createGovernancePolicyService, GovernanceMutationError } from "./governance-policy-service.ts";

const hostId = "11111111-1111-4111-8111-111111111111";
const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function service() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return createGovernancePolicyService(createGovernancePolicyRepo(db));
}

function openService() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return { db, policy: createGovernancePolicyService(createGovernancePolicyRepo(db)) };
}

describe("governance policy service", () => {
  it("projects every registered cell/level and supports real optimistic mutations", () => {
    const policy = service();
    const generation = policy.level().policyGeneration;
    const expected = CANONICAL_GOVERNANCE_REGISTRY.descriptors
      .reduce((count, descriptor) => count + descriptor.cells.length, 0) * 3;
    expect(policy.cells().cells).toHaveLength(expected);
    expect(policy.level().registryRevision).toBe(CANONICAL_GOVERNANCE_REGISTRY.registryRevision);
    expect(policy.setLevel("strict", generation)).toMatchObject({ level: "strict", policyGeneration: generation + 1 });
    expect(policy.setCell({ key: "screenshot", level: "strict", posture: "deny", expectedPolicyGeneration: generation + 1 })).toMatchObject({ policyGeneration: generation + 2, cell: { effectivePosture: "deny" } });
  });

  it("enforces immutable and second-confirm override legality before persistence", () => {
    const policy = service();
    const generation = policy.level().policyGeneration;
    expect(() => policy.setCell({ key: "fs-write:self-escalation", level: "standard", posture: "auto", expectedPolicyGeneration: generation })).toThrow(GovernanceMutationError);
    expect(() => policy.setCell({ key: "exec:blocked", level: "standard", posture: "auto", expectedPolicyGeneration: generation })).toThrow(/second confirmation/);
    expect(policy.setCell({ key: "exec:blocked", level: "standard", posture: "auto", expectedPolicyGeneration: generation, secondConfirm: true })).toMatchObject({ policyGeneration: generation + 1, cell: { effectivePosture: "auto" } });
  });

  it("normalizes factory-equal requests to reset/no-op, including immutable cells", () => {
    const policy = service();
    const generation = policy.level().policyGeneration;
    expect(policy.setCell({
      key: "screenshot", level: "standard", posture: "ask", expectedPolicyGeneration: generation,
    })).toMatchObject({ policyGeneration: generation, cell: { overridePosture: null, effectivePosture: "ask" } });
    expect(policy.setCell({
      key: "skill-load", level: "standard", posture: "auto", expectedPolicyGeneration: generation,
    })).toMatchObject({ policyGeneration: generation, cell: { overridePosture: null, effectivePosture: "auto" } });
  });

  it("fails startup closed for current-revision unknown, stale-descriptor, or immutable override rows", () => {
    for (const row of [
      { key: "unknown-cell", level: "standard", posture: "deny", descriptorRevision: 1 },
      { key: "screenshot", level: "standard", posture: "deny", descriptorRevision: 2 },
      { key: "skill-load", level: "standard", posture: "deny", descriptorRevision: 1 },
    ] as const) {
      const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
      dbs.push(db);
      // Current-revision corruption must not enter the legitimate old-registry upgrade cleanup.
      createGovernancePolicyService(createGovernancePolicyRepo(db));
      db.prepare(
        "INSERT INTO governance_cell_overrides (cell_key, level, posture, descriptor_revision, updated_at) " +
        "VALUES (:key, :level, :posture, :descriptorRevision, 't')",
      ).run(row);
      expect(() => createGovernancePolicyService(createGovernancePolicyRepo(db))).toThrow();
    }
  });

  it("accepts an exact legal current-revision override at startup", () => {
    const { db } = openService();
    db.prepare(
      "INSERT INTO governance_cell_overrides (cell_key, level, posture, descriptor_revision, updated_at) " +
      "VALUES ('screenshot', 'standard', 'deny', 1, 't')",
    ).run();
    expect(createGovernancePolicyService(createGovernancePolicyRepo(db)).cells().cells).toContainEqual(
      expect.objectContaining({ key: "screenshot", level: "standard", overridePosture: "deny" }),
    );
  });

  it("fails ask closed before Slice 4 and never treats Skill instructions as authority", () => {
    const policy = service();
    expect(policy.authorize({
      identity: { capabilityId: "mcp.tool.call", ownerHostId: hostId, subject: { subjectId: "srv.tool", revision: "cfg-1" } },
      cellKey: "mcp-tool-call",
    })).toMatchObject({ allowed: false, code: "APPROVAL_REQUIRED" });
    expect(policy.authorize({
      identity: { capabilityId: "skill.load", ownerHostId: hostId, subject: { subjectId: "skill-a", revision: "hash-a" } },
      cellKey: "skill-load",
    })).toMatchObject({ allowed: true });
    expect(policy.authorize({
      identity: { capabilityId: "mcp.tool.call", ownerHostId: hostId, subject: { subjectId: "srv.tool", revision: "cfg-1" } },
      cellKey: "mcp-tool-call",
      denyConstraints: ["skill-markdown-cannot-grant"],
    })).toMatchObject({ allowed: false, code: "GOVERNANCE_DENIED" });
  });
});
