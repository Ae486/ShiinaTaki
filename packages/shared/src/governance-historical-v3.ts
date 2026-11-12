/**
 * INPUT: frozen evidenced governance revision 3 descriptor data
 * OUTPUT: exact historical registry for durable Approval usability comparison
 * POS: shared/governance — immutable historical semantics; never derive from the current registry
 */
import { createGovernanceRegistry } from "./governance-registry.ts";
import type { CapabilityGovernanceDescriptor } from "./governance-schema.ts";

const levels = (strict: "auto" | "ask" | "deny", standard: "auto" | "ask" | "deny", relaxed: "auto" | "ask" | "deny") => ({ strict, standard, relaxed });
const cell = (input: {
  key: string;
  postures: ReturnType<typeof levels>;
  approvalMemory: "rememberable" | "once-only";
  overrideMode?: "ordinary" | "second-confirm" | "immutable";
}) => ({
  key: input.key,
  levels: input.postures,
  approvalMemory: input.approvalMemory,
  overrideMode: input.overrideMode ?? "ordinary",
});

const DESCRIPTORS: CapabilityGovernanceDescriptor[] = [
  {
    capabilityId: "hindsight-deployment", descriptorRevision: 1, subjectRequired: false,
    classifier: { authority: "host", classifierId: "hindsight-deployment-action", classifierRevision: 1 },
    cells: ["create", "start", "inject"].map((action) => cell({ key: `hindsight-deployment:${action}`,
      postures: levels("ask", "ask", "auto"), approvalMemory: "once-only" })),
  },
  {
    capabilityId: "hindsight-deployment-observe", descriptorRevision: 1, subjectRequired: false,
    classifier: { authority: "host", classifierId: "hindsight-owned-observation", classifierRevision: 1 },
    cells: [cell({ key: "hindsight-deployment-observe:read", postures: levels("auto", "auto", "auto"), approvalMemory: "once-only" })],
  },
  {
    capabilityId: "hindsight-custody", descriptorRevision: 1, subjectRequired: false,
    classifier: { authority: "host", classifierId: "hindsight-fixed-custody", classifierRevision: 1 },
    cells: [cell({ key: "hindsight-custody:prepare", postures: levels("ask", "ask", "auto"), approvalMemory: "once-only" })],
  },
  {
    capabilityId: "shell-open", descriptorRevision: 1, subjectRequired: false,
    classifier: { authority: "host", classifierId: "shell-open-target", classifierRevision: 1 },
    cells: [
      cell({ key: "shell-open:url-safe", postures: levels("ask", "auto", "auto"), approvalMemory: "rememberable" }),
      cell({ key: "shell-open:local-file", postures: levels("ask", "ask", "auto"), approvalMemory: "once-only" }),
      cell({ key: "shell-open:local-exec", postures: levels("ask", "ask", "auto"), approvalMemory: "once-only" }),
      cell({ key: "shell-open:blocked", postures: levels("deny", "deny", "deny"), approvalMemory: "once-only", overrideMode: "second-confirm" }),
    ],
  },
  {
    capabilityId: "exec", descriptorRevision: 1, subjectRequired: false,
    classifier: { authority: "host", classifierId: "exec-command", classifierRevision: 1 },
    cells: [
      cell({ key: "exec:simple-allowlisted", postures: levels("ask", "auto", "auto"), approvalMemory: "once-only" }),
      cell({ key: "exec:compound", postures: levels("ask", "ask", "auto"), approvalMemory: "once-only" }),
      cell({ key: "exec:shell-reentry", postures: levels("ask", "ask", "auto"), approvalMemory: "once-only" }),
      cell({ key: "exec:allowlist-miss", postures: levels("ask", "ask", "auto"), approvalMemory: "once-only" }),
      cell({ key: "exec:blocked", postures: levels("deny", "deny", "deny"), approvalMemory: "once-only", overrideMode: "second-confirm" }),
    ],
  },
  {
    capabilityId: "fs-write", descriptorRevision: 1, subjectRequired: false,
    classifier: { authority: "core", classifierId: "workspace-path", classifierRevision: 1 },
    cells: [
      cell({ key: "fs-write:in-workspace", postures: levels("auto", "auto", "auto"), approvalMemory: "rememberable" }),
      cell({ key: "fs-write:dir-root", postures: levels("ask", "ask", "auto"), approvalMemory: "rememberable" }),
      cell({ key: "fs-write:outside-root", postures: levels("ask", "ask", "auto"), approvalMemory: "once-only" }),
      cell({ key: "fs-write:skill-hook", postures: levels("ask", "ask", "auto"), approvalMemory: "once-only" }),
      cell({ key: "fs-write:sensitive", postures: levels("deny", "deny", "deny"), approvalMemory: "once-only", overrideMode: "second-confirm" }),
      cell({ key: "fs-write:self-escalation", postures: levels("deny", "deny", "deny"), approvalMemory: "once-only", overrideMode: "immutable" }),
    ],
  },
  ...["screenshot", "screenshot-ambient", "process-list", "clipboard-read", "clipboard-write", "foreground-window"].map(
    (capabilityId): CapabilityGovernanceDescriptor => ({
      capabilityId, descriptorRevision: 1, subjectRequired: false,
      classifier: { authority: "core", classifierId: "fixed-risk", classifierRevision: 1 },
      cells: [cell({ key: capabilityId, postures: levels("ask", "ask", "auto"), approvalMemory: "rememberable" })],
    }),
  ),
  {
    capabilityId: "skill.load", descriptorRevision: 1, subjectRequired: true,
    classifier: { authority: "core", classifierId: "skill-load", classifierRevision: 1 },
    cells: [cell({ key: "skill-load", postures: levels("auto", "auto", "auto"), approvalMemory: "once-only", overrideMode: "immutable" })],
  },
  {
    capabilityId: "mcp.tool.call", descriptorRevision: 1, subjectRequired: true,
    classifier: { authority: "core", classifierId: "mcp-tool-call", classifierRevision: 1 },
    cells: [cell({ key: "mcp-tool-call", postures: levels("ask", "ask", "ask"), approvalMemory: "rememberable" })],
  },
  {
    capabilityId: "core.time.read", descriptorRevision: 1, subjectRequired: false,
    classifier: { authority: "core", classifierId: "fixed-risk", classifierRevision: 1 },
    cells: [cell({ key: "get-current-time", postures: levels("auto", "auto", "auto"), approvalMemory: "once-only", overrideMode: "immutable" })],
  },
  {
    capabilityId: "core.schedule.manage", descriptorRevision: 1, subjectRequired: false,
    classifier: { authority: "core", classifierId: "fixed-risk", classifierRevision: 1 },
    cells: [cell({ key: "schedule-manage", postures: levels("auto", "auto", "auto"), approvalMemory: "once-only", overrideMode: "immutable" })],
  },
  {
    capabilityId: "core.memory.search", descriptorRevision: 1, subjectRequired: false,
    classifier: { authority: "core", classifierId: "fixed-risk", classifierRevision: 1 },
    cells: [cell({ key: "memory-search", postures: levels("auto", "auto", "auto"), approvalMemory: "once-only", overrideMode: "immutable" })],
  },
  ...[
    ["core.memory.write", "memory-write"],
    ["core.memory.archive", "memory-archive"],
    ["core.avatar.expression", "avatar-set-expression"],
    ["core.avatar.motion", "avatar-play-motion"],
  ].map(([capabilityId, key]): CapabilityGovernanceDescriptor => ({
    capabilityId: capabilityId!, descriptorRevision: 1, subjectRequired: false,
    classifier: { authority: "core", classifierId: "fixed-risk", classifierRevision: 1 },
    cells: [cell({ key: key!, postures: levels("auto", "auto", "auto"), approvalMemory: "once-only" })],
  })),
  {
    capabilityId: "workspace.file.read", descriptorRevision: 1, subjectRequired: false,
    classifier: { authority: "core", classifierId: "workspace-path", classifierRevision: 1 },
    cells: [cell({ key: "workspace-read", postures: levels("auto", "auto", "auto"), approvalMemory: "once-only", overrideMode: "immutable" })],
  },
];

export const HISTORICAL_GOVERNANCE_REGISTRY_3 = createGovernanceRegistry({
  registryRevision: 3, descriptors: DESCRIPTORS,
});
