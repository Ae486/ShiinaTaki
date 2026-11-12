import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPROVAL_METHODS,
  APPROVAL_PRESENTATION_REVISION,
  canonicalApprovalDecisionScope,
  type ApprovalDecisionBinding,
  type ApprovalPresentation,
} from "@taki/shared";
import { createHash } from "node:crypto";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import type { Connection } from "../server/connection-registry.ts";
import { approvalDecisionScopeDigest, storedApprovalBindingDigest } from "./approval-binding.ts";
import { createApprovalDecisionService } from "./approval-decision-service.ts";
import { createApprovalInteractionService } from "./approval-interaction-service.ts";
import { createApprovalStateRepo } from "./approval-state-repo.ts";
import type { ApprovalLabelResolver } from "./approval-labels.ts";

const OWNER_HOST_ID = "11111111-1111-4111-8111-111111111111";
const dbs: Database[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const db of dbs.splice(0)) db.close();
});

function service(resolveLabels?: ApprovalLabelResolver) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const repo = createApprovalStateRepo(db);
  const decisions = createApprovalDecisionService(repo);
  return { repo, decisions, interactions: createApprovalInteractionService(decisions, undefined, resolveLabels) };
}

function binding(subjectId = "mcp.subject"): ApprovalDecisionBinding {
  const scope = {
    bindingRevision: 1 as const,
    identity: {
      capabilityId: "mcp.tool.call",
      ownerHostId: OWNER_HOST_ID,
      subject: { subjectId, revision: "cfg.1" },
    },
    descriptorRevision: 1,
    classifierId: "mcp-tool-call",
    classifierRevision: 1,
    cellKey: "mcp-tool-call",
  };
  expect(createHash("sha256").update(canonicalApprovalDecisionScope(scope)).digest("hex"))
    .toBe(approvalDecisionScopeDigest(scope));
  return { ...scope, decisionScopeDigest: approvalDecisionScopeDigest(scope) };
}

const presentation: ApprovalPresentation = {
  revision: APPROVAL_PRESENTATION_REVISION,
  title: "Run configured MCP tool",
  capabilityLabel: "MCP tool",
  riskSummary: "This tool can access its configured server.",
  sections: [{ title: "Target", fields: [{ label: "Server", value: "Configured server" }] }],
};

function connection(deviceId = "same-device") {
  const notifications: Array<{ method: string; params: unknown }> = [];
  const value: Connection = {
    state: { status: "authenticated", deviceId, role: "operator", capabilities: [] },
    notify: (method, params) => notifications.push({ method, params }),
  };
  return { value, notifications };
}

function ask(
  interactions: ReturnType<typeof createApprovalInteractionService>,
  owner: Connection,
  options: { candidate?: ApprovalDecisionBinding; timeoutMs?: number } = {},
) {
  return interactions.request({
    owner,
    policyGeneration: 1,
    binding: options.candidate ?? binding(),
    presentation,
    timeoutMs: options.timeoutMs ?? 1_000,
  });
}

describe("ApprovalInteractionService", () => {
  it("resolves one label batch without changing stored bindings, digests, usability or generations", () => {
    const resolver = vi.fn<ApprovalLabelResolver>((rows) => new Map(rows.map((row, index) =>
      [row.decisionId, { subject: `github · tool-${index}` }])));
    const { decisions, interactions } = service(resolver);
    decisions.grantAlways({ binding: { ...binding("mcp.first"), disclosureRevision: 1 }, expectedApprovalGeneration: 1 });
    decisions.grantAlways({ binding: { ...binding("mcp.second"), disclosureRevision: 1 }, expectedApprovalGeneration: 2 });
    const before = decisions.snapshot();
    const authorityRows = decisions.list();

    const listed = interactions.list();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith(before.decisions);
    expect(listed.approvalGeneration).toBe(before.approvalGeneration);
    expect(listed.decisions.map(({ labels, ...authority }) => {
      expect(labels?.capability).toBe("调用 MCP 工具");
      expect(labels?.subject).toMatch(/^github · tool-/u);
      return authority;
    })).toEqual(authorityRows);
    expect(decisions.snapshot()).toEqual(before);
    expect(interactions.revoke(listed.decisions[1]!.decisionId, listed.approvalGeneration))
      .toEqual({ status: "revoked", approvalGeneration: before.approvalGeneration + 1 });
    expect(interactions.list().decisions.map((row) => row.decisionId)).toEqual([listed.decisions[0]!.decisionId]);
  });

  it("keeps durable decisions readable and usable when the current-name source fails", () => {
    const { decisions, interactions } = service(() => { throw new Error("catalog unavailable"); });
    decisions.grantAlways({ binding: { ...binding(), disclosureRevision: 1 }, expectedApprovalGeneration: 1 });
    const before = decisions.snapshot();
    const listed = interactions.list();
    expect(listed.decisions).toHaveLength(1);
    expect(listed.decisions[0]).toMatchObject({
      labels: { capability: "调用 MCP 工具", subject: "当前无法确认服务器与工具名称" },
      usability: { usable: true },
    });
    expect(decisions.snapshot()).toEqual(before);
  });

  it.each(["", "x".repeat(241)])("isolates an invalid optional label from valid rows: %s", (invalid) => {
    const { decisions, interactions } = service((rows) => new Map(rows.map((row, index) =>
      [row.decisionId, { subject: index === 0 ? invalid : "github · search" }])));
    decisions.grantAlways({ binding: { ...binding("mcp.first"), disclosureRevision: 1 }, expectedApprovalGeneration: 1 });
    decisions.grantAlways({ binding: { ...binding("mcp.second"), disclosureRevision: 1 }, expectedApprovalGeneration: 2 });
    const before = decisions.snapshot();
    const listed = interactions.list();
    expect(listed.decisions[0]?.labels?.subject).toBe("当前无法确认服务器与工具名称");
    expect(listed.decisions[1]?.labels?.subject).toBe("github · search");
    expect(listed.decisions.every((row) => row.usability.usable)).toBe(true);
    expect(decisions.snapshot()).toEqual(before);
  });

  it("gives historical identities generic labels while preserving their inert state and revoke target", () => {
    const { repo, decisions, interactions } = service();
    const historicalBinding = {
      ...binding(), disclosureRevision: 1,
      identity: {
        capabilityId: "Legacy/Unknown Capability", ownerHostId: "old opaque host",
        subject: { subjectId: "old opaque subject", revision: "old revision" },
      },
      cellKey: "legacy/classification",
    };
    // Seed a valid stored row under the historical grammar, as an upgrade may encounter it.
    repo.grant({
      decisionId: "22222222-2222-4222-8222-222222222222",
      binding: historicalBinding, bindingDigest: storedApprovalBindingDigest(historicalBinding),
      provenance: "operator", createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z",
    }, 1);
    const before = decisions.snapshot();
    const listed = interactions.list();
    expect(listed.decisions[0]).toMatchObject({
      binding: historicalBinding,
      labels: { capability: "未识别的操作", subject: "当前无法确认目标名称" },
      usability: { usable: false },
    });
    expect(decisions.snapshot()).toEqual(before);
    expect(interactions.revoke(listed.decisions[0]!.decisionId, listed.approvalGeneration))
      .toEqual({ status: "revoked", approvalGeneration: 3 });
  });

  it("targets one physical Connection and rejects a sibling socket with the same deviceId", async () => {
    const { decisions, interactions } = service();
    const owner = connection();
    const sibling = connection();
    const handle = ask(interactions, owner.value);

    expect(owner.notifications).toHaveLength(1);
    expect(owner.notifications[0]).toMatchObject({ method: APPROVAL_METHODS.request });
    expect(sibling.notifications).toEqual([]);
    expect(JSON.stringify(owner.notifications)).not.toContain("SENTINEL_RAW_INPUT");

    expect(interactions.respond(sibling.value, {
      approvalId: handle.approvalId!, choice: "allow_once", expectedApprovalGeneration: 1,
    })).toEqual({ status: "wrong_session", approvalGeneration: 1 });
    expect(interactions.respond(owner.value, {
      approvalId: handle.approvalId!, choice: "allow_once", expectedApprovalGeneration: 1,
    })).toEqual({ status: "accepted", approvalGeneration: 1 });
    await expect(handle.result).resolves.toEqual({ allowed: true, scope: "once", approvalGeneration: 1 });
    expect(owner.notifications[1]).toMatchObject({
      method: APPROVAL_METHODS.closed,
      params: { approvalId: handle.approvalId, reason: "answered", approvalGeneration: 1 },
    });
    expect(decisions.snapshot().approvalGeneration).toBe(1);
  });

  it("settles deny once and reports a later duplicate as late", async () => {
    const { interactions } = service();
    const owner = connection();
    const handle = ask(interactions, owner.value);
    const params = { approvalId: handle.approvalId!, choice: "deny" as const, expectedApprovalGeneration: 1 };

    expect(interactions.respond(owner.value, params)).toEqual({ status: "accepted", approvalGeneration: 1 });
    expect(interactions.respond(owner.value, params)).toEqual({ status: "late", approvalGeneration: 1 });
    await expect(handle.result).resolves.toEqual({ allowed: false, reason: "denied", approvalGeneration: 1 });
  });

  it("closes timeout, explicit cancellation, and disconnect only on the owning connection", async () => {
    vi.useFakeTimers();
    const { interactions } = service();
    const owner = connection();
    const other = connection("other-device");
    const expired = ask(interactions, owner.value, { candidate: binding("mcp.expired"), timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    await expect(expired.result).resolves.toMatchObject({ allowed: false, reason: "expired" });

    const cancelled = ask(interactions, owner.value, { candidate: binding("mcp.cancelled") });
    expect(cancelled.cancel()).toBe(true);
    expect(cancelled.cancel()).toBe(false);
    await expect(cancelled.result).resolves.toMatchObject({ allowed: false, reason: "cancelled" });

    const disconnected = ask(interactions, owner.value, { candidate: binding("mcp.disconnected") });
    interactions.disconnect(owner.value);
    await expect(disconnected.result).resolves.toMatchObject({ allowed: false, reason: "operator_disconnected" });
    expect(other.notifications).toEqual([]);
    expect(owner.notifications.filter((item) => item.method === APPROVAL_METHODS.closed).map((item) =>
      (item.params as { reason: string }).reason)).toEqual(["expired", "cancelled", "operator_disconnected"]);
  });

  it("advances once for a material session grant, zero for its no-op, and once for teardown", async () => {
    const { decisions, interactions } = service();
    const owner = connection();
    const first = ask(interactions, owner.value);

    expect(interactions.respond(owner.value, {
      approvalId: first.approvalId!, choice: "allow_session", expectedApprovalGeneration: 1,
    })).toEqual({ status: "accepted", approvalGeneration: 2 });
    await expect(first.result).resolves.toEqual({ allowed: true, scope: "session", approvalGeneration: 2 });
    expect(decisions.snapshot().approvalGeneration).toBe(2);

    const notificationCount = owner.notifications.length;
    interactions.invalidatePolicy(1);
    const noOp = ask(interactions, owner.value);
    expect(noOp.approvalId).toBeNull();
    await expect(noOp.result).resolves.toEqual({ allowed: true, scope: "session", approvalGeneration: 2 });
    expect(owner.notifications).toHaveLength(notificationCount);
    expect(decisions.snapshot().approvalGeneration).toBe(2);

    interactions.disconnect(owner.value);
    expect(decisions.snapshot().approvalGeneration).toBe(3);
    interactions.disconnect(owner.value);
    expect(decisions.snapshot().approvalGeneration).toBe(3);

    const reconnected = connection();
    const fresh = ask(interactions, reconnected.value);
    expect(fresh.approvalId).not.toBeNull();
    expect(reconnected.notifications[0]).toMatchObject({ method: APPROVAL_METHODS.request });
    fresh.cancel();
  });

  it("advances once when a policy change revokes live session authority and zero on a repeated no-op", async () => {
    const { decisions, interactions } = service();
    const owner = connection();
    const handle = ask(interactions, owner.value);
    interactions.respond(owner.value, {
      approvalId: handle.approvalId!, choice: "allow_session", expectedApprovalGeneration: 1,
    });
    await expect(handle.result).resolves.toMatchObject({ allowed: true, scope: "session", approvalGeneration: 2 });

    interactions.invalidatePolicy(2);
    expect(decisions.snapshot().approvalGeneration).toBe(3);
    interactions.invalidatePolicy(2);
    expect(decisions.snapshot().approvalGeneration).toBe(3);
  });

  it("fails closed before pending state when the binding or notification route is unavailable", async () => {
    const { decisions, interactions } = service();
    const noNotify: Connection = {
      state: { status: "authenticated", deviceId: "no-notify", role: "operator", capabilities: [] },
    };
    const unavailable = ask(interactions, noNotify);
    expect(unavailable.approvalId).toBeNull();
    await expect(unavailable.result).resolves.toEqual({
      allowed: false, reason: "operator_unavailable", approvalGeneration: 1,
    });

    expect(() => ask(interactions, connection().value, { candidate: {
      ...binding(), classifierId: "wrong-classifier",
    } })).toThrow("classifier_mismatch");

    const throwing = connection("throws");
    throwing.value.notify = () => { throw new Error("socket is gone"); };
    const failed = ask(interactions, throwing.value);
    await expect(failed.result).resolves.toEqual({
      allowed: false, reason: "notification_failed", approvalGeneration: 1,
    });
    expect(failed.cancel()).toBe(false);
    interactions.disconnect(throwing.value);
    expect(decisions.snapshot().approvalGeneration).toBe(1);
  });

  it("persists always authority, lists it, revokes it, and invalidates sibling pending generations", async () => {
    const { decisions, interactions } = service();
    const owner = connection();
    const sibling = connection("sibling");
    const retained = ask(interactions, owner.value, { candidate: binding("mcp.always") });
    const invalidated = ask(interactions, sibling.value, { candidate: binding("mcp.sibling") });

    expect(interactions.respond(owner.value, {
      approvalId: retained.approvalId!,
      choice: "allow_always",
      expectedApprovalGeneration: 1,
      disclosure: { revision: 1, futureBackgroundUseAccepted: true },
    })).toEqual({ status: "accepted", approvalGeneration: 2 });
    await expect(retained.result).resolves.toEqual({ allowed: true, scope: "always", approvalGeneration: 2 });
    await expect(invalidated.result).resolves.toEqual({ allowed: false, reason: "invalidated", approvalGeneration: 2 });

    const listed = interactions.list();
    expect(listed).toMatchObject({ approvalGeneration: 2, decisions: [{ verdict: "allow" }] });
    const decisionId = listed.decisions[0]!.decisionId;
    expect(interactions.revoke(decisionId, 2)).toEqual({ status: "revoked", approvalGeneration: 3 });
    expect(interactions.list().decisions).toEqual([]);
    expect(interactions.revoke(decisionId, 3)).toEqual({ status: "not_found", approvalGeneration: 3 });
    expect(decisions.snapshot().approvalGeneration).toBe(3);
  });

  it("derives scope ceilings and closes stale policy prompts", async () => {
    const { interactions } = service();
    const owner = connection();
    const onceOnly = {
      bindingRevision: 1 as const,
      identity: { capabilityId: "core.time.read", ownerHostId: OWNER_HOST_ID },
      descriptorRevision: 1,
      classifierId: "fixed-risk",
      classifierRevision: 1,
      cellKey: "get-current-time",
    };
    const candidate = { ...onceOnly, decisionScopeDigest: approvalDecisionScopeDigest(onceOnly) };
    const handle = ask(interactions, owner.value, { candidate });
    expect(owner.notifications[0]).toMatchObject({
      params: { allowedChoices: ["allow_once", "deny"] },
    });
    expect(interactions.respond(owner.value, {
      approvalId: handle.approvalId!, choice: "allow_session", expectedApprovalGeneration: 1,
    })).toEqual({ status: "scope_not_allowed", approvalGeneration: 1 });
    interactions.invalidatePolicy(2);
    await expect(handle.result).resolves.toEqual({ allowed: false, reason: "invalidated", approvalGeneration: 1 });
  });

  it("keeps a legacy allow inert until canonical reconfirmation targets current identity and disclosure", async () => {
    const { decisions, interactions } = service();
    const owner = connection();
    const candidate = binding("legacy.server.tool");

    // No canonical row exists: the legacy allow stored elsewhere never authorizes, so the operator is prompted.
    const first = ask(interactions, owner.value, { candidate });
    expect(first.approvalId).not.toBeNull();
    interactions.respond(owner.value, {
      approvalId: first.approvalId!, choice: "deny", expectedApprovalGeneration: 1,
    });
    await expect(first.result).resolves.toMatchObject({ allowed: false, reason: "denied" });

    // Reconfirmation is an explicit canonical durable grant against the CURRENT binding + disclosure revision.
    const snapshot = decisions.grantAlways({
      binding: { ...candidate, disclosureRevision: 1 },
      expectedApprovalGeneration: decisions.snapshot().approvalGeneration,
      provenance: "legacy-reconfirmation",
    });
    expect(snapshot.approvalGeneration).toBe(2);
    const listed = interactions.list().decisions;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ provenance: "legacy-reconfirmation", usability: { usable: true } });
    expect(listed[0]!.binding.disclosureRevision).toBe(1);

    // After reconfirmation the same binding resolves as durable always authority with no second prompt.
    const second = ask(interactions, owner.value, { candidate });
    expect(second.approvalId).toBeNull();
    await expect(second.result).resolves.toEqual({ allowed: true, scope: "always", approvalGeneration: 2 });
  });
});
