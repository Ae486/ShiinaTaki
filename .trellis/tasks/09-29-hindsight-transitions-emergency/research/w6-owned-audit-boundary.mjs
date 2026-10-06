/** Task-only extra audit boundary; never renews or changes a production transition executor. */
import { setImmediate as yieldEventLoop, setTimeout as yieldTimers } from "node:timers/promises";
import { readTransitionAttempt, requireTransitionLease } from "../../../../packages/core/src/db/memory-transition-repo.ts";

export async function auditWithHeartbeat(input, run) {
  const now = input.now ?? (() => new Date().toISOString());
  const lease = readTransitionAttempt(input.db, input.transitionId);
  if (!lease) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
  const check = () => requireTransitionLease(input.db, { lease, now: now() });
  check(); const started = performance.now(); const startedAt = Date.parse(now()); let completed = false;
  try {
    const value = run();
    if (value && (typeof value === "object" || typeof value === "function") && "then" in value) throw new Error("W6_SYNCHRONOUS_AUDIT_REQUIRED");
    // Refuse already expired work before yielding. Only the existing service heartbeat may renew a still-live
    // executor; waiting through both timer/check phases lets its serial promise finish without adopting new identity.
    check(); await yieldTimers(0); await yieldEventLoop(); const current = check();
    // A due heartbeat must actually have extended this executor before another long synchronous audit/bind.
    // A stopped/failed heartbeat cannot be substituted by this harness, even while the old lease is still live.
    if (Date.parse(now()) - startedAt >= 30_000 && Date.parse(current.leaseUntil) <= Date.parse(lease.leaseUntil)) {
      throw new Error("W6_ACTIVE_HEARTBEAT_REQUIRED");
    }
    completed = true; return value;
  } finally {
    input.record?.({ name: input.name, elapsedMs: performance.now() - started, completed, finishedAt: now(),
      leaseUntil: readTransitionAttempt(input.db, input.transitionId)?.leaseUntil ?? null });
  }
}
