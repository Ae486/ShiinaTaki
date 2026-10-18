/**
 * INPUT:  current protected registration/config, the sole Catalog owner and the authenticated capability router
 * OUTPUT: bounded C1 preparation status plus an unforgeable process-local accepted handle for later owner use
 * POS:    core/memory/hindsight — the admission owner; JSON and diagnostics never mint deployment evidence
 */
import { randomUUID } from "node:crypto";
import {
  HINDSIGHT_CUSTODY_CAPABILITY, HindsightCustodyPrepareSchema, HindsightCustodyResultSchema,
  type HindsightCustodyPrepare, type HindsightCustodyResult, type HindsightFixedSelection,
} from "@taki/shared/hindsight-custody";
import type { HindsightHostRegistration } from "@taki/shared/hindsight-installation";
import type { CustodyLinkV1, CustodyAttemptMapping as SharedCustodyMapping } from "@taki/shared/hindsight-deployment";
import type { CapabilityAuthorizationLineage, HostOperationControl } from "@taki/shared";
import type { SecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import { CatalogCustodyError, type CatalogCustodySnapshot } from "../../secrets/catalog-custody.ts";
import type { CapabilityRouteRequest, InteractiveOperator, RouteResult } from "../../capabilities/route-capability.ts";
import type { CapabilityAcceptedResult, CapabilityIssuedRequest } from "../../capabilities/capability-observers.ts";

export interface HindsightCustodyCurrent {
  registration: HindsightHostRegistration;
  configurationDigest: string;
  selection: HindsightFixedSelection;
}
export type CustodyAttemptMapping = SharedCustodyMapping;
export type AcceptedCustody = Readonly<{ readonly kind: "accepted-custody" }>;
interface Admission {
  current: HindsightCustodyCurrent;
  snapshot: CatalogCustodySnapshot;
  input: HindsightCustodyPrepare;
  coreOperationId: string;
  coreAttemptId: string;
  issued?: CapabilityIssuedRequest;
  mapping?: CustodyAttemptMapping;
  accepted?: CapabilityAcceptedResult;
  status?: Extract<HindsightCustodyResult, { state: "prepared" }>;
  refusal?: Extract<HindsightCustodyResult, { state: "unavailable" }>;
}
export interface HindsightCustodyDeps {
  coreHostId: string;
  catalog: SecretCatalogService;
  current(): HindsightCustodyCurrent | null;
  route(request: CapabilityRouteRequest, operator?: InteractiveOperator): Promise<RouteResult>;
  isCurrent(control: HostOperationControl, authorization?: CapabilityAuthorizationLineage): boolean;
  now?: () => number;
}

export function createHindsightCustodyOwner(deps: HindsightCustodyDeps) {
  const accepted = new WeakMap<AcceptedCustody, Admission>();
  let active = true;
  return {
    async prepare(operator?: InteractiveOperator): Promise<{ status: HindsightCustodyResult; evidence?: AcceptedCustody }> {
      if (!active) return { status: unavailable("host-unavailable") };
      try {
        const admission = admit(deps);
        const outcome = await deps.route({
          capabilityId: HINDSIGHT_CUSTODY_CAPABILITY, input: admission.input,
          targetHostId: admission.current.registration.executionHostId,
          operationId: admission.coreOperationId, attemptId: admission.coreAttemptId,
          observers: {
            onIssued: (issued) => recordIssued(admission, issued),
            onAccepted: (result) => recordAccepted(admission, result),
          },
        }, operator);
        if (!outcome.ok) return { status: unavailable(routeRefusal(outcome)) };
        if (admission.refusal) return { status: admission.refusal };
        // The route can cross persistence/notification awaits. Recheck at the actual owner transition.
        if (!active || !admission.accepted || !admission.status || !isCurrent(deps, admission)) {
          return { status: unavailable("snapshot-stale") };
        }
        const evidence = Object.freeze({ kind: "accepted-custody" as const });
        accepted.set(evidence, admission);
        return { status: admission.status, evidence };
      } catch (error) {
        return { status: unavailable(error instanceof CatalogCustodyError ? error.reason : "snapshot-stale") };
      }
    },
    validate(evidence: AcceptedCustody): boolean {
      const admission = accepted.get(evidence);
      return active && admission !== undefined && isCurrent(deps, admission);
    },
    mapping(evidence: AcceptedCustody): CustodyAttemptMapping | null {
      const record = accepted.get(evidence);
      return active && record?.mapping && isCurrent(deps, record) ? { ...record.mapping } : null;
    },
    describeAccepted(evidence: AcceptedCustody): CustodyLinkV1 | null {
      const record = accepted.get(evidence);
      return active && record?.mapping && record.issued && isCurrent(deps, record)
        ? structuredClone({ input: record.input, mapping: record.mapping, deadlineAt: record.issued.control.deadlineAt })
        : null;
    },
    dispose(): void { active = false; },
  };
}
export type HindsightCustodyOwner = ReturnType<typeof createHindsightCustodyOwner>;

function admit(deps: HindsightCustodyDeps): Admission {
  const current = deps.current();
  if (!current) throw new CatalogCustodyError("unsupported-installation");
  const registration = current.registration;
  if (registration.coreHostId !== deps.coreHostId || registration.catalogStoreId !== deps.coreHostId) {
    throw new CatalogCustodyError("unsafe-installation");
  }
  const snapshot = deps.catalog.captureCustodySnapshot(current.selection);
  if (snapshot.catalogKeyVersion !== registration.catalogKeyVersion) throw new CatalogCustodyError("custody-locked");
  return {
    current: structuredClone(current), snapshot, coreOperationId: randomUUID(), coreAttemptId: randomUUID(),
    input: HindsightCustodyPrepareSchema.parse({
      version: 1, ...snapshot, coreHostId: deps.coreHostId,
      installationId: registration.installationId, configurationDigest: current.configurationDigest,
    }),
  };
}

function recordIssued(admission: Admission, issued: CapabilityIssuedRequest): void {
  if (admission.issued || issued.control.coreAttemptId !== admission.coreAttemptId
    || issued.control.operationId !== admission.coreOperationId
    || issued.control.targetHostId !== admission.current.registration.executionHostId) throw new Error("invalid custody issue");
  admission.issued = issued;
  admission.mapping = {
    coreOperationId: admission.coreOperationId, coreAttemptId: admission.coreAttemptId,
    brokerOperationId: issued.control.operationId, hostAttemptId: issued.control.attemptId,
    requestId: issued.requestId, inputDigest: issued.control.inputDigest,
  };
}

function recordAccepted(admission: Admission, result: CapabilityAcceptedResult): void {
  if (admission.accepted || !admission.issued || result.requestId !== admission.issued.requestId
    || JSON.stringify(result.control) !== JSON.stringify(admission.issued.control)) throw new Error("invalid custody acceptance");
  const status = HindsightCustodyResultSchema.parse(result.outcome.output);
  if (status.state !== "prepared") {
    admission.refusal = status;
    return;
  }
  if (status.requestId !== result.requestId || status.hostAttemptId !== result.control.attemptId
    || status.snapshotId !== admission.snapshot.snapshotId
    || status.sealedEnvelopeSha256 !== admission.snapshot.sealedEnvelopeSha256
    || status.installationId !== admission.input.installationId
    || status.configurationDigest !== admission.input.configurationDigest) throw new Error("invalid custody binding");
  admission.accepted = result;
  admission.status = status;
}

function isCurrent(deps: HindsightCustodyDeps, admission: Admission): boolean {
  if (!admission.issued || !admission.accepted) return false;
  const control = admission.issued.control;
  try {
    return (deps.now ?? Date.now)() < Date.parse(control.deadlineAt)
      && deps.isCurrent(control, admission.accepted.authorization)
      && JSON.stringify(deps.current()) === JSON.stringify(admission.current)
      && deps.catalog.validateCustodySnapshot(admission.snapshot);
  } catch {
    return false;
  }
}

function routeRefusal(outcome: Extract<RouteResult, { ok: false }>): Parameters<typeof unavailable>[0] {
  if (outcome.code === "APPROVAL_REQUIRED") return "approval-required";
  if (outcome.code === "DENIED") return "denied";
  if (outcome.code === "OUTCOME_UNKNOWN" || outcome.code === "CAPABILITY_TIMEOUT") return "outcome-unknown";
  return outcome.code === "CANCELLED" ? "snapshot-stale" : "host-unavailable";
}
function unavailable(reason: Extract<HindsightCustodyResult, { state: "unavailable" }>["reason"]): HindsightCustodyResult {
  return { version: 1, state: "unavailable", reason, deploymentReady: false };
}
