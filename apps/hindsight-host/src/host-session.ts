/**
 * INPUT:  one authenticated role=node generation's request/execute/resume/cancel notifications
 * OUTPUT: canonical preflight challenges and terminal C1 results with one-use authorization lineage
 * POS:    hindsight-host — memory-only Host lifetime; disconnect discards pending input and never replays reads
 */
import {
  CapabilityRequestSchema, CapabilityExecuteSchema, CapabilityCancelSchema,
  type CapabilityAuthorizationLineage, type CapabilityRequest, type CapabilityRespondParams,
} from "@taki/shared/host-control";
import { CapabilityResumeSchema, type CapabilityChallenge } from "@taki/shared/host-approval";
import { HindsightTrustedInvocationSchema, type HindsightCustodyResult, type HindsightTrustedInvocation } from "@taki/shared/hindsight-custody";
import { classifyCustody, custodyChallenge, requireResume, type HostGateIdentity } from "./host-gate.ts";
import { CustodyError, custodyFailure } from "./custody-error.ts";

interface Pending {
  request: CapabilityRequest;
  challenge: CapabilityChallenge;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  executing: boolean;
  authorization?: CapabilityAuthorizationLineage;
}
export interface CustodyHostSessionDeps {
  identity: HostGateIdentity;
  owner: HindsightTrustedInvocation["owner"];
  send(method: "capability.challenge" | "capability.respond", params: unknown): Promise<void>;
  prepare(invocation: HindsightTrustedInvocation, signal: AbortSignal): Promise<HindsightCustodyResult>;
  audit?(entry: { requestId: string; allowed: boolean }): void;
  onTransportFailure?(): void;
}

export function createCustodyHostSession(deps: CustodyHostSessionDeps) {
  const state = {
    deps, pending: new Map<string, Pending>(), terminal: new Map<string, CapabilityRespondParams>(),
    policy: 0, digest: "", live: true,
  };
  return {
    receive(method: string, params: unknown): void {
      if (!state.live) return;
      try {
        if (method === "capability.request") request(state, CapabilityRequestSchema.parse(params));
        else if (method === "capability.execute") execute(state, params, false);
        else if (method === "capability.resume") execute(state, params, true);
        else if (method === "capability.cancel") cancel(state, params);
      } catch {
        // Malformed/current-lineage mismatches execute nothing; raw control input is never diagnostic output.
      }
    },
    close(): void {
      state.live = false;
      for (const entry of state.pending.values()) { clearTimeout(entry.timer); entry.controller.abort(); }
      state.pending.clear(); state.terminal.clear();
    },
  };
}
type Session = {
  deps: CustodyHostSessionDeps; pending: Map<string, Pending>; terminal: Map<string, CapabilityRespondParams>;
  policy: number; digest: string; live: boolean;
};

function request(state: Session, request: CapabilityRequest): void {
  for (const [id, terminal] of state.terminal) {
    if (Date.now() >= Date.parse(terminal.control.deadlineAt)) state.terminal.delete(id);
  }
  // Keep attempts bound to one request ID. Retaining unexpired tombstones (and refusing saturation) prevents
  // a cache eviction from making a still-authorized old attempt executable again.
  if ([...state.pending.values()].some((entry) => entry.request.control.attemptId === request.control.attemptId && entry.request.requestId !== request.requestId)
    || [...state.terminal.values()].some((entry) => entry.control.attemptId === request.control.attemptId && entry.requestId !== request.requestId)) return;
  const existing = state.pending.get(request.requestId)?.request ?? state.terminal.get(request.requestId);
  if (existing) {
    if (JSON.stringify(existing.control) !== JSON.stringify(request.control)) return;
    const cached = state.terminal.get(request.requestId);
    if (cached) send(state, "capability.respond", cached);
    return;
  }
  const evidence = classifyCustody(request, state.deps.identity);
  requirePolicy(state, request);
  if (state.pending.size + state.terminal.size >= 256) {
    send(state, "capability.respond", { requestId: request.requestId, control: request.control, state: "failed",
      error: { code: "EXEC_FAILED", message: "Host custody attempt capacity is unavailable" }, governance: evidence });
    return;
  }
  const challenge = custodyChallenge(request, evidence);
  const controller = new AbortController();
  const entry: Pending = {
    request, challenge, controller, executing: false,
    timer: setTimeout(() => retire(state, request.requestId), Math.max(1, Date.parse(request.control.deadlineAt) - Date.now())),
  };
  state.pending.set(request.requestId, entry);
  if (evidence.effectivePosture === "deny") {
    state.deps.audit?.({ requestId: request.requestId, allowed: false });
    finish(state, entry, { requestId: request.requestId, control: request.control, state: "failed",
      error: { code: "DENIED", message: "Host custody is denied" }, governance: evidence });
  } else send(state, "capability.challenge", challenge); // Core commits intent before even auto reaches execution.
}

function execute(state: Session, params: unknown, resume: boolean): void {
  const value = resume ? CapabilityResumeSchema.parse(params) : CapabilityExecuteSchema.parse(params);
  const entry = state.pending.get(value.requestId);
  if (!entry || entry.executing || value.challengeId !== entry.challenge.challengeId
    || JSON.stringify(value.control) !== JSON.stringify(entry.request.control)) return;
  try {
    const evidence = classifyCustody(entry.request, state.deps.identity);
    requirePolicy(state, entry.request);
    if (resume) {
      const authorized = CapabilityResumeSchema.parse(params);
      requireResume(entry.challenge, authorized);
      if (evidence.effectivePosture !== "ask") throw new CustodyError("denied");
      entry.authorization = {
        authorizationId: authorized.authorization.authorizationId, approvalGeneration: authorized.authorization.approvalGeneration,
        challengeDigest: authorized.authorization.challengeDigest,
      };
    } else if (value.authorization !== undefined || evidence.effectivePosture !== "auto") throw new CustodyError("denied");
    entry.executing = true;
    state.deps.audit?.({ requestId: value.requestId, allowed: true });
    const invocation = HindsightTrustedInvocationSchema.parse({
      version: 1, requestId: value.requestId, control: value.control, input: entry.request.input,
      authorization: entry.authorization, owner: state.deps.owner,
    });
    void perform(state, entry, invocation);
  } catch {
    state.deps.audit?.({ requestId: value.requestId, allowed: false });
    retire(state, value.requestId);
  }
}

async function perform(state: Session, entry: Pending, invocation: HindsightTrustedInvocation): Promise<void> {
  let output: HindsightCustodyResult;
  try { output = await state.deps.prepare(invocation, entry.controller.signal); }
  catch (error) { output = custodyFailure(error); }
  if (!state.live || entry.controller.signal.aborted || state.pending.get(entry.request.requestId) !== entry) return;
  try {
    const governance = classifyCustody(entry.request, state.deps.identity);
    requirePolicy(state, entry.request);
    finish(state, entry, { requestId: entry.request.requestId, control: entry.request.control,
      state: "completed", output, governance, authorization: entry.authorization });
  } catch { retire(state, entry.request.requestId); }
}

function requirePolicy(state: Session, request: CapabilityRequest): void {
  const { policyGeneration, governanceProjection } = request.control;
  if (policyGeneration < state.policy || (policyGeneration === state.policy && state.digest !== governanceProjection.digest)) {
    throw new CustodyError("snapshot-stale");
  }
  state.policy = policyGeneration; state.digest = governanceProjection.digest;
}

function cancel(state: Session, params: unknown): void {
  const value = CapabilityCancelSchema.parse(params);
  const entry = state.pending.get(value.requestId);
  if (entry && JSON.stringify(entry.request.control) === JSON.stringify(value.control)) retire(state, value.requestId);
}
function retire(state: Session, requestId: string): void {
  const entry = state.pending.get(requestId);
  if (!entry) return;
  entry.controller.abort();
  finish(state, entry, { requestId, control: entry.request.control, state: "cancelled", authorization: entry.authorization });
}
function finish(state: Session, entry: Pending, response: CapabilityRespondParams): void {
  state.pending.delete(response.requestId); clearTimeout(entry.timer);
  state.terminal.set(response.requestId, response);
  send(state, "capability.respond", response);
}
function send(state: Session, method: "capability.challenge" | "capability.respond", params: unknown): void {
  void state.deps.send(method, params).catch(() => {
    // Lost replies are never replayed automatically. Connection retirement suppresses all pending results.
    state.live = false;
    for (const entry of state.pending.values()) { clearTimeout(entry.timer); entry.controller.abort(); }
    state.pending.clear();
    state.deps.onTransportFailure?.();
  });
}
