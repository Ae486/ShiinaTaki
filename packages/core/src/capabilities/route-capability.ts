/**
 * INPUT:  explicit/legacy target Host resolution, validated live catalogs, connection registry, broker, logger
 * OUTPUT: structured result with sealed dispatch provenance/currentness; never selects first match
 * POS:    core/capabilities — explicit Host-qualified router; legacy compatibility resolves only one routable Host
 */
import type { HostCapabilityDescriptor, HostGovernanceProjection } from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import type { HostCatalogStore } from "../hosts/host-catalog.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import type { CapabilityBroker, CapabilityFailureCode } from "./capability-broker.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import type { Connection } from "../server/connection-registry.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import type { CapabilityRequestObservers } from "./capability-observers.ts";

export interface InteractiveOperator {
  connection: Connection;
  signal?: AbortSignal;
  runId?: string;
  attemptId?: string;
}

export interface CapabilityRouteDeps {
  registry: ConnectionRegistry;
  catalogs: HostCatalogStore;
  broker: CapabilityBroker;
  logger: Logger;
  governance: GovernancePolicyService;
  approval: ApprovalInteractionService;
  interactive?: InteractiveOperator;
  effects?: EffectLifecycleService;
}

export type RouteFailureCode = CapabilityFailureCode | "NO_NODE" | "TARGET_HOST_REQUIRED" | "CAPABILITY_MISSING";
/** Internal binding captured before dispatch, never a caller-supplied or wire-visible identity. */
export interface CapabilityRouteProvenance {
  readonly hostId: string;
  readonly connectionGeneration: number;
  readonly catalogGeneration: number;
  isCurrent(): boolean;
}
export type RouteResult =
  | { ok: true; output: unknown; provenance?: CapabilityRouteProvenance }
  | { ok: false; code: RouteFailureCode; message: string; state?: "cancelled" | "outcome_unknown" };

export interface CapabilityRouteRequest {
  capabilityId: string;
  input: unknown;
  targetHostId?: string;
  runId?: string;
  attemptId?: string;
  effectId?: string;
  operationId?: string;
  observers?: CapabilityRequestObservers;
  ownerCurrent?: () => boolean;
  /** Process-local Run lifetime; it is not an operator connection or part of the Host wire identity. */
  signal?: AbortSignal;
}

export async function routeCapability(
  deps: CapabilityRouteDeps,
  request: CapabilityRouteRequest,
): Promise<RouteResult> {
  const { capabilityId, targetHostId } = request;
  const resolved = resolveTarget(deps, capabilityId, targetHostId);
  if (!resolved.ok) {
    deps.logger.child({ mod: "capability" }).warn({ capability: capabilityId, code: resolved.code }, "capability routing failed");
    return resolved;
  }
  const { catalog, connection, descriptor } = resolved;
  if (!connection.notify) return { ok: false, code: "NO_NODE", message: `Host ${catalog.hostId} is unavailable` };
  const { compatibility: expected, ...dispatchPolicy } = deps.governance.hostDispatchPolicy(capabilityId);
  if (
    descriptor.governance.descriptorRevision !== expected.descriptorRevision
    || descriptor.governance.classifierRevision !== expected.classifierRevision
    || descriptor.governance.classifierId !== expected.classifierId
  ) {
    return {
      ok: false,
      code: "CAPABILITY_MISSING",
      message: `Host ${catalog.hostId} governance metadata is incompatible with ${capabilityId}`,
    };
  }
  const sealed: SealedDispatch = {
    hostId: catalog.hostId,
    connectionGeneration: catalog.connectionGeneration,
    catalogGeneration: catalog.catalogGeneration,
    capabilityId,
    descriptor,
    policyGeneration: dispatchPolicy.policyGeneration,
    projection: dispatchPolicy.projection,
  };
  return dispatch(deps, { connection, sealed }, request);
}

async function dispatch(
  deps: CapabilityRouteDeps,
  target: { connection: Connection; sealed: SealedDispatch },
  request: CapabilityRouteRequest,
): Promise<RouteResult> {
  const { connection, sealed } = target;
  if (!connection.notify) return { ok: false, code: "NO_NODE", message: "Host is unavailable" };
  const provenance: CapabilityRouteProvenance = Object.freeze({
    hostId: sealed.hostId,
    connectionGeneration: sealed.connectionGeneration,
    catalogGeneration: sealed.catalogGeneration,
    isCurrent: () => deps.registry.isCurrentHost(connection) && isCurrentDispatch(deps, sealed),
  });
  const result = await deps.broker.request({
    hostId: sealed.hostId,
    connectionGeneration: sealed.connectionGeneration,
    catalogGeneration: sealed.catalogGeneration,
    descriptor: sealed.descriptor,
    connection,
    notify: connection.notify,
    policyGeneration: sealed.policyGeneration,
    governanceProjection: sealed.projection,
    operator: deps.interactive,
    ownerCurrent: request.ownerCurrent,
    signal: request.signal,
    isCurrent: () => (request.ownerCurrent?.() ?? true) && provenance.isCurrent(),
  }, request.input, { runId: request.runId ?? deps.interactive?.runId, coreAttemptId: request.attemptId ?? deps.interactive?.attemptId, effectId: request.effectId, operationId: request.operationId, observers: request.observers, approvalGeneration: deps.approval.approvalGeneration() });
  return result.ok ? { ...result, provenance } : result;
}

interface SealedDispatch {
  hostId: string;
  connectionGeneration: number;
  catalogGeneration: number;
  capabilityId: string;
  descriptor: HostCapabilityDescriptor;
  policyGeneration: number;
  projection: HostGovernanceProjection;
}

function isCurrentDispatch(deps: CapabilityRouteDeps, sealed: SealedDispatch): boolean {
  const connection = deps.registry.findHost(sealed.hostId);
  const catalog = deps.catalogs.get(sealed.hostId);
  const currentDescriptor = catalog?.capabilities.find((item) => item.capabilityId === sealed.capabilityId);
  if (!connection || !deps.registry.isCurrentHost(connection) || !catalog || !currentDescriptor) return false;
  if (catalog.connectionGeneration !== sealed.connectionGeneration
    || catalog.catalogGeneration !== sealed.catalogGeneration) return false;
  const policy = deps.governance.hostDispatchPolicy(sealed.capabilityId);
  return JSON.stringify(currentDescriptor) === JSON.stringify(sealed.descriptor)
    && policy.policyGeneration === sealed.policyGeneration
    && JSON.stringify(policy.projection) === JSON.stringify(sealed.projection);
}

function resolveTarget(deps: CapabilityRouteDeps, capabilityId: string, targetHostId?: string) {
  const candidates = deps.catalogs.hostsForCapability(capabilityId);
  const catalog = targetHostId
    ? candidates.find((item) => item.hostId === targetHostId)
    : candidates.length === 1 ? candidates[0] : undefined;
  if (!catalog) {
    if (!targetHostId && candidates.length > 1) {
      return { ok: false as const, code: "TARGET_HOST_REQUIRED" as const, message: `multiple Hosts provide ${capabilityId}; targetHostId is required` };
    }
    return { ok: false as const, code: targetHostId ? "CAPABILITY_MISSING" as const : "NO_NODE" as const, message: `no routable Host provides ${capabilityId}` };
  }
  const connection = deps.registry.findHost(catalog.hostId);
  const descriptor = catalog.capabilities.find((item) => item.capabilityId === capabilityId);
  if (!connection || !descriptor) return { ok: false as const, code: "NO_NODE" as const, message: `Host ${catalog.hostId} is unavailable` };
  return { ok: true as const, catalog, connection, descriptor };
}
