/**
 * INPUT:  canonical registry plus the durable policy repository and operator/evaluation requests
 * OUTPUT: policy reads/mutations/evaluation, copied registry classifier metadata, and ask fail-closed decisions
 * POS:    core/governance — sole policy-domain authority between SQLite, operator methods, and execution adapters
 */
import {
  CANONICAL_GOVERNANCE_REGISTRY,
  evaluateGovernance,
  governanceCell,
  governanceDescriptor,
  type CanonicalCapabilityIdentity,
  type GovernanceEvaluationResult,
  type GovernanceExecutionCode,
  type GovernanceRegistry,
  type PermissionCellSetParams,
  type PermissionCellState,
  type PermissionCellsState,
  type PermissionLevel,
  type PermissionLevelState,
  type HostGovernanceProjection,
  type HostCapabilityGovernanceSupport,
  canonicalHostGovernanceProjection,
} from "@taki/shared";
import { createHash } from "node:crypto";
import { overrideIdentity, type GovernancePolicyRepo, type GovernancePolicySnapshot } from "./governance-policy-repo.ts";

export class GovernanceMutationError extends Error {
  readonly reason: "unknown-cell" | "immutable" | "second-confirm-required";
  constructor(reason: GovernanceMutationError["reason"], message: string) {
    super(message);
    this.name = "GovernanceMutationError";
    this.reason = reason;
  }
}

export interface GovernancePolicyService {
  level(): PermissionLevelState;
  cells(): PermissionCellsState;
  setLevel(level: PermissionLevel, expectedPolicyGeneration: number): PermissionLevelState;
  setCell(params: PermissionCellSetParams): { policyGeneration: number; registryRevision: number; cell: PermissionCellState };
  evaluate(input: {
    identity: CanonicalCapabilityIdentity;
    cellKey: string;
    denyConstraints?: string[];
  }): GovernanceEvaluationResult;
  authorize(input: { identity: CanonicalCapabilityIdentity; cellKey: string; denyConstraints?: string[] }): GovernanceExecutionDecision;
  classifierMetadata(capabilityId: string): Readonly<Pick<HostCapabilityGovernanceSupport, "classifierId" | "classifierRevision">>;
  hostDispatchPolicy(capabilityId: string): {
    policyGeneration: number;
    compatibility: HostCapabilityGovernanceSupport;
    projection: HostGovernanceProjection;
  };
}

export type GovernanceExecutionDecision =
  | { allowed: true; evaluation: GovernanceEvaluationResult }
  | { allowed: false; code: GovernanceExecutionCode; evaluation: GovernanceEvaluationResult };

export function createGovernancePolicyService(
  repo: GovernancePolicyRepo,
  registry: GovernanceRegistry = CANONICAL_GOVERNANCE_REGISTRY,
): GovernancePolicyService {
  reconcile(repo, registry);
  return {
    level: () => levelState(repo.read()),
    cells: () => cellsState(repo.read(), registry),
    setLevel(level, expectedPolicyGeneration) {
      return levelState(repo.setLevel(level, expectedPolicyGeneration));
    },
    setCell: (params) => setCell(repo, registry, params),
    evaluate: (input) => evaluate(repo, registry, input),
    classifierMetadata: (capabilityId) => classifierMetadata(registry, capabilityId),
    authorize(input) {
      const evaluation = this.evaluate(input);
      if (evaluation.posture === "auto") return { allowed: true, evaluation };
      return { allowed: false, code: evaluation.posture === "ask" ? "APPROVAL_REQUIRED" : "GOVERNANCE_DENIED", evaluation };
    },
    hostDispatchPolicy(capabilityId) {
      const snapshot = repo.read();
      const descriptor = governanceDescriptor(registry, capabilityId);
      if (!descriptor) throw new Error(`unknown governance capability ${capabilityId}`);
      const cells = descriptor.cells.map((cell) => ({ key: cell.key, posture: cellState({ snapshot, capabilityId, descriptorRevision: descriptor.descriptorRevision, cell }).effectivePosture })).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
      const payload = {
        registryRevision: snapshot.registryRevision,
        descriptorRevision: descriptor.descriptorRevision,
        classifierRevision: descriptor.classifier.classifierRevision,
        cells,
      };
      const digest = createHash("sha256").update(canonicalHostGovernanceProjection(payload), "utf8").digest("hex");
      return {
        policyGeneration: snapshot.policyGeneration,
        compatibility: {
          descriptorRevision: descriptor.descriptorRevision,
          classifierId: descriptor.classifier.classifierId,
          classifierRevision: descriptor.classifier.classifierRevision,
        },
        projection: { ...payload, digest },
      };
    },
  };
}

function classifierMetadata(registry: GovernanceRegistry, capabilityId: string) {
  const classifier = governanceDescriptor(registry, capabilityId)?.classifier;
  if (!classifier) throw new Error(`unknown governance capability ${capabilityId}`);
  return { classifierId: classifier.classifierId, classifierRevision: classifier.classifierRevision };
}

function setCell(repo: GovernancePolicyRepo, registry: GovernanceRegistry, params: PermissionCellSetParams) {
  const target = resolveCell(registry, params.key);
  const posture = normalizedPosture(target.cell, params.level, params.posture);
  validateOverride(target.cell, { level: params.level, posture, secondConfirm: params.secondConfirm });
  const snapshot = repo.setOverride({
    key: target.cell.key,
    level: params.level,
    posture,
    descriptorRevision: target.descriptor.descriptorRevision,
    expectedPolicyGeneration: params.expectedPolicyGeneration,
  });
  return {
    policyGeneration: snapshot.policyGeneration,
    registryRevision: snapshot.registryRevision,
    cell: cellState({
      snapshot,
      capabilityId: target.descriptor.capabilityId,
      descriptorRevision: target.descriptor.descriptorRevision,
      cell: target.cell,
    }),
  };
}

function evaluate(
  repo: GovernancePolicyRepo,
  registry: GovernanceRegistry,
  input: { identity: CanonicalCapabilityIdentity; cellKey: string; denyConstraints?: string[] },
): GovernanceEvaluationResult {
  const snapshot = repo.read();
  const descriptor = governanceDescriptor(registry, input.identity.capabilityId);
  const cell = descriptor ? governanceCell(descriptor, input.cellKey) : undefined;
  return evaluateGovernance(registry, {
    identity: input.identity,
    registryRevision: snapshot.registryRevision,
    descriptorRevision: descriptor?.descriptorRevision ?? 1,
    classifierId: descriptor?.classifier.classifierId ?? "unknown",
    classifierRevision: descriptor?.classifier.classifierRevision ?? 1,
    cellKey: input.cellKey,
    level: snapshot.level,
    policyGeneration: snapshot.policyGeneration,
    override: cell ? snapshot.overrides.find((item) => item.key === cell.key && item.level === snapshot.level) : undefined,
    denyConstraints: input.denyConstraints ?? [],
  });
}

function reconcile(repo: GovernancePolicyRepo, registry: GovernanceRegistry): void {
  const valid = new Set<string>();
  for (const descriptor of registry.descriptors) {
    for (const cell of descriptor.cells) {
      for (const level of ["strict", "standard", "relaxed"] as const) {
        for (const posture of legalStoredPostures(cell)) {
          valid.add(overrideIdentity({ key: cell.key, level, posture, descriptorRevision: descriptor.descriptorRevision }));
        }
      }
    }
  }
  validateStoredOverrides(repo.reconcileRegistry(registry.registryRevision, valid), registry);
}

function levelState(snapshot: GovernancePolicySnapshot): PermissionLevelState {
  return { level: snapshot.level, policyGeneration: snapshot.policyGeneration, registryRevision: snapshot.registryRevision };
}

function cellsState(snapshot: GovernancePolicySnapshot, registry: GovernanceRegistry): PermissionCellsState {
  const cells = registry.descriptors.flatMap((descriptor) => descriptor.cells.flatMap((cell) =>
    (["strict", "standard", "relaxed"] as const).map((level) => cellState({
      snapshot,
      capabilityId: descriptor.capabilityId,
      descriptorRevision: descriptor.descriptorRevision,
      cell,
      level,
    })),
  ));
  return { ...levelState(snapshot), cells };
}

function cellState(input: {
  snapshot: GovernancePolicySnapshot;
  capabilityId: string;
  descriptorRevision: number;
  cell: GovernanceRegistry["descriptors"][number]["cells"][number];
  level?: PermissionLevel;
}): PermissionCellState {
  const level = input.level ?? input.snapshot.level;
  const override = input.snapshot.overrides.find((item) => item.key === input.cell.key && item.level === level);
  return {
    key: input.cell.key,
    capabilityId: input.capabilityId,
    descriptorRevision: input.descriptorRevision,
    level,
    factoryPosture: input.cell.levels[level],
    overridePosture: override?.posture ?? null,
    effectivePosture: override?.posture ?? input.cell.levels[level],
    approvalMemory: input.cell.approvalMemory,
    overrideMode: input.cell.overrideMode,
  };
}

function resolveCell(registry: GovernanceRegistry, key: string) {
  for (const descriptor of registry.descriptors) {
    const cell = governanceCell(descriptor, key);
    if (cell) return { descriptor, cell };
  }
  throw new GovernanceMutationError("unknown-cell", `unknown governance cell ${key}`);
}

function validateOverride(
  cell: GovernanceRegistry["descriptors"][number]["cells"][number],
  input: { level: PermissionLevel; posture: PermissionCellSetParams["posture"]; secondConfirm?: boolean },
): void {
  if (input.posture === null) return;
  if (cell.overrideMode === "immutable") {
    throw new GovernanceMutationError("immutable", `governance cell ${cell.key} is immutable`);
  }
  const loosensFactory = postureRank(input.posture) < postureRank(cell.levels[input.level]);
  if (cell.overrideMode === "second-confirm" && loosensFactory && input.secondConfirm !== true) {
    throw new GovernanceMutationError("second-confirm-required", `governance cell ${cell.key} requires second confirmation`);
  }
}

function normalizedPosture(
  cell: GovernanceRegistry["descriptors"][number]["cells"][number],
  level: PermissionLevel,
  posture: PermissionCellSetParams["posture"],
): PermissionCellSetParams["posture"] {
  return posture === cell.levels[level] ? null : posture;
}

function legalStoredPostures(
  cell: GovernanceRegistry["descriptors"][number]["cells"][number],
): ReadonlyArray<"auto" | "ask" | "deny"> {
  return cell.overrideMode === "immutable" ? [] : ["auto", "ask", "deny"];
}

function validateStoredOverrides(snapshot: GovernancePolicySnapshot, registry: GovernanceRegistry): void {
  for (const override of snapshot.overrides) {
    const target = resolveCell(registry, override.key);
    if (target.descriptor.descriptorRevision !== override.descriptorRevision) {
      throw new Error(
        `governance override ${override.key}/${override.level} has descriptor revision ${override.descriptorRevision}; expected ${target.descriptor.descriptorRevision}`,
      );
    }
    if (target.cell.overrideMode === "immutable") {
      throw new Error(`governance override ${override.key}/${override.level} illegally stores an immutable cell override`);
    }
  }
}

function postureRank(posture: "auto" | "ask" | "deny"): number {
  return { auto: 0, ask: 1, deny: 2 }[posture];
}
