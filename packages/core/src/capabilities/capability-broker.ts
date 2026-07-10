/**
 * INPUT:  a capability name + input + a per-node notify fn; capability.respond params from the node
 * OUTPUT: createCapabilityBroker(deps) -> { request, resolve, denyAll } — correlate node responses by requestId
 * POS:    core/capabilities — the core→node ask/await broker (structural mirror of approval-broker, ruling 11/12)
 */
import { randomUUID } from "node:crypto";
import {
  CAPABILITY_METHODS,
  type CapabilityErrorCode,
  type CapabilityOutput,
  type CapabilityRequest,
  type CapabilityRespondParams,
  type CapabilityRespondResult,
} from "@taki/shared";
import type { Logger } from "../logging/logger.ts";

/** Core-internal failure codes added to the closed wire union (surfaced to the tool, never onto the wire). */
export type CapabilityFailureCode = CapabilityErrorCode | "CAPABILITY_TIMEOUT" | "NODE_DISCONNECTED";

/** A node's answer: its output, or a structured failure the tool degrades into a model-readable result. */
export type CapabilityOutcome =
  | { ok: true; output: CapabilityOutput }
  | { ok: false; code: CapabilityFailureCode; message: string };

/** Pushes a capability.request notification to ONE node socket (from connection-registry.findNodeForCapability). */
export type CapabilityNotify = (method: string, params: unknown) => void;

export interface CapabilityBroker {
  /** Notifies the node and resolves when it responds, it disconnects, or the backstop elapses (fail-closed). */
  request(capability: string, input: unknown, notify: CapabilityNotify): Promise<CapabilityOutcome>;
  /** Applies a node answer to the pending request; unknown/late requestId -> {accepted:false} (never an error). */
  resolve(params: CapabilityRespondParams): CapabilityRespondResult;
  /** Fails every pending request now (the node socket closed) — fail-closed. */
  denyAll(reason: string): void;
}

// The shell's own 60s dialog deny fires first; this backstop only covers a node that never answers at all (ruling 11).
const DEFAULT_TIMEOUT_MS = 90_000;
export const TIMEOUT_MESSAGE = "capability request timed out";

interface Pending {
  finish: (outcome: CapabilityOutcome) => void;
}

export function createCapabilityBroker(deps: { logger: Logger; timeoutMs?: number }): CapabilityBroker {
  const log = deps.logger.child({ mod: "capability" });
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = new Map<string, Pending>();

  function settle(requestId: string, outcome: CapabilityOutcome): boolean {
    const entry = pending.get(requestId);
    if (!entry) return false;
    pending.delete(requestId);
    entry.finish(outcome);
    return true;
  }

  return {
    request(capability, input, notify) {
      const requestId = randomUUID();
      return new Promise<CapabilityOutcome>((resolve) => {
        const timer = setTimeout(
          () => settle(requestId, { ok: false, code: "CAPABILITY_TIMEOUT", message: TIMEOUT_MESSAGE }),
          timeoutMs,
        );
        pending.set(requestId, {
          finish: (outcome) => {
            clearTimeout(timer);
            resolve(outcome);
          },
        });
        // input is content (per-capability args) — it rides to the node but never enters a core log.
        notify(CAPABILITY_METHODS.request, { requestId, capability, input } satisfies CapabilityRequest);
        log.info({ requestId, capability }, "capability requested");
      });
    },
    resolve(params) {
      const outcome: CapabilityOutcome = params.ok
        ? { ok: true, output: params.output }
        : { ok: false, code: params.error.code, message: params.error.message };
      return { accepted: settle(params.requestId, outcome) };
    },
    denyAll(reason) {
      for (const requestId of [...pending.keys()]) {
        settle(requestId, { ok: false, code: "NODE_DISCONNECTED", message: reason });
      }
    },
  };
}
