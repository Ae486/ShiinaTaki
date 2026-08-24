/**
 * INPUT:  injected transport/client factories, authentication/restoration callbacks, timing store, clock, scheduler, RNG.
 * OUTPUT: createConnectionGenerationController() — fresh authenticated/restored client generations with retry/disposal.
 * POS:    ui/lib — framework-free D59 lifecycle owner; it never buffers or replays caller requests or mutations.
 */

import { ErrorCodeSchema } from "@taki/shared";
import type { ConnectionStatus } from "./connection-status.ts";
import type { TimingPolicyStore } from "./timing-policy.ts";
import type { ConnectOutcome } from "./ws-client-methods.ts";
import type { WsTransport } from "./ws-transport.ts";

export interface ConnectionTimer {
  cancel(): void;
}

export interface ConnectionScheduler {
  schedule(delayMs: number, handler: () => void): ConnectionTimer;
}

export interface ConnectionClock {
  now(): number;
}

export interface ConnectionGenerationClient {
  onClose(handler: () => void): void;
  close(): void;
}

export interface ConnectionGenerationContext {
  generation: number;
  isCurrent(): boolean;
}

export interface ConnectionSnapshot<TClient> {
  client: TClient | null;
  status: ConnectionStatus;
}

export interface ConnectionClientFactoryInput {
  transport: WsTransport;
  timingPolicy: TimingPolicyStore;
}

export interface ConnectionGenerationDeps<TClient extends ConnectionGenerationClient> {
  timingPolicy: TimingPolicyStore;
  transportFactory: () => WsTransport;
  clientFactory: (input: ConnectionClientFactoryInput) => TClient;
  authenticate: (client: TClient) => Promise<ConnectOutcome>;
  /** Optional one-shot recovery for a stale operator credential. Returns true when a fresh attempt is warranted. */
  recoverAuthFailure?: (outcome: Extract<ConnectOutcome, { ok: false }>) => boolean;
  restore?: (client: TClient, context: ConnectionGenerationContext) => Promise<void>;
  scheduler?: ConnectionScheduler;
  clock?: ConnectionClock;
  rng?: () => number;
}

export interface ConnectionGenerationController<TClient> {
  start(): void;
  snapshot(): ConnectionSnapshot<TClient>;
  subscribe(listener: (snapshot: ConnectionSnapshot<TClient>) => void): () => void;
  dispose(): void;
}

interface Candidate<TClient> {
  generation: number;
  client: TClient;
  retired: boolean;
  stableAt: number | null;
  stabilityTimer: ConnectionTimer | null;
}

const DEFAULT_SCHEDULER: ConnectionScheduler = {
  schedule(delayMs, handler) {
    const timer = setTimeout(handler, delayMs);
    return { cancel: () => clearTimeout(timer) };
  },
};

const DEFAULT_CLOCK: ConnectionClock = { now: () => Date.now() };

class GenerationController<TClient extends ConnectionGenerationClient>
  implements ConnectionGenerationController<TClient>
{
  private readonly deps: ConnectionGenerationDeps<TClient>;
  private readonly scheduler: ConnectionScheduler;
  private readonly clock: ConnectionClock;
  private readonly rng: () => number;
  private readonly listeners = new Set<(snapshot: ConnectionSnapshot<TClient>) => void>();
  private state: ConnectionSnapshot<TClient> = { client: null, status: { kind: "connecting" } };
  private active: Candidate<TClient> | null = null;
  private retryTimer: ConnectionTimer | null = null;
  private generation = 0;
  private retryExponent = 0;
  private started = false;
  private disposed = false;
  private authRecoveryAttempted = false;

  constructor(deps: ConnectionGenerationDeps<TClient>) {
    this.deps = deps;
    this.scheduler = deps.scheduler ?? DEFAULT_SCHEDULER;
    this.clock = deps.clock ?? DEFAULT_CLOCK;
    this.rng = deps.rng ?? Math.random;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.beginAttempt();
  }

  snapshot(): ConnectionSnapshot<TClient> {
    return this.state;
  }

  subscribe(listener: (snapshot: ConnectionSnapshot<TClient>) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.retryTimer?.cancel();
    this.retryTimer = null;
    if (this.active) this.retire(this.active, true);
    this.listeners.clear();
  }

  private beginAttempt(): void {
    if (this.disposed) return;
    const generation = ++this.generation;
    let transport: WsTransport;
    try {
      transport = this.deps.transportFactory();
    } catch (cause) {
      this.retryAfter(cause);
      return;
    }
    try {
      const client = this.deps.clientFactory({ transport, timingPolicy: this.deps.timingPolicy });
      const candidate: Candidate<TClient> = {
        generation,
        client,
        retired: false,
        stableAt: null,
        stabilityTimer: null,
      };
      this.active = candidate;
      client.onClose(() => this.closed(candidate));
      void this.authenticateAndRestore(candidate);
    } catch (cause) {
      transport.close();
      this.retryAfter(cause);
    }
  }

  private async authenticateAndRestore(candidate: Candidate<TClient>): Promise<void> {
    try {
      const outcome = await this.deps.authenticate(candidate.client);
      if (!this.isCurrent(candidate)) return;
      if (!outcome.ok) {
        this.refused(candidate, outcome);
        return;
      }
      const context: ConnectionGenerationContext = {
        generation: candidate.generation,
        isCurrent: () => this.isCurrent(candidate),
      };
      await this.deps.restore?.(candidate.client, context);
      if (this.isCurrent(candidate)) this.promote(candidate);
    } catch (cause) {
      if (this.isCurrent(candidate)) this.transientFailure(candidate, cause);
    }
  }

  private refused(candidate: Candidate<TClient>, outcome: Extract<ConnectOutcome, { ok: false }>): void {
    if (
      outcome.code === ErrorCodeSchema.enum.AUTH_FAILED &&
      !this.authRecoveryAttempted &&
      this.deps.recoverAuthFailure?.(outcome)
    ) {
      this.authRecoveryAttempted = true;
      this.retire(candidate, true);
      this.publish({ client: null, status: { kind: "connecting" } });
      this.beginAttempt();
      return;
    }
    if (!this.retire(candidate, true)) return;
    const status: ConnectionStatus =
      outcome.code === ErrorCodeSchema.enum.PAIRING_REQUIRED
        ? { kind: "pairing-required" }
        : { kind: "error", code: outcome.code, message: outcome.message };
    this.publish({ client: null, status });
  }

  private promote(candidate: Candidate<TClient>): void {
    this.authRecoveryAttempted = false;
    this.publish({ client: candidate.client, status: { kind: "connected" } });
    const stableMs = this.deps.timingPolicy.current().reconnectStabilityResetMs;
    candidate.stableAt = this.clock.now() + stableMs;
    this.scheduleStabilityCheck(candidate, stableMs);
  }

  private scheduleStabilityCheck(candidate: Candidate<TClient>, delayMs: number): void {
    candidate.stabilityTimer?.cancel();
    candidate.stabilityTimer = this.scheduler.schedule(delayMs, () => {
      if (!this.isCurrent(candidate) || candidate.stableAt === null) return;
      const remaining = candidate.stableAt - this.clock.now();
      if (remaining > 0) this.scheduleStabilityCheck(candidate, remaining);
      else this.retryExponent = 0;
    });
  }

  private closed(candidate: Candidate<TClient>): void {
    if (!this.retire(candidate, false)) return;
    this.scheduleRetry();
  }

  private transientFailure(candidate: Candidate<TClient>, cause: unknown): void {
    if (!this.retire(candidate, true)) return;
    this.retryAfter(cause);
  }

  private retryAfter(cause: unknown): void {
    console.warn("[connection-generation] generation failed; retrying", cause);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    this.retryTimer?.cancel();
    const policy = this.deps.timingPolicy.current();
    const exponential = policy.reconnectBaseMs * 2 ** this.retryExponent;
    const ceiling = Number.isFinite(exponential) ? Math.min(policy.reconnectCapMs, exponential) : policy.reconnectCapMs;
    const sample = this.rng();
    const unit = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0;
    const delayMs = Math.floor(unit * ceiling);
    this.retryExponent += 1;
    this.publish({ client: null, status: { kind: "reconnecting" } });
    this.retryTimer = this.scheduler.schedule(delayMs, () => {
      this.retryTimer = null;
      this.beginAttempt();
    });
  }

  private retire(candidate: Candidate<TClient>, close: boolean): boolean {
    if (candidate.retired) return false;
    candidate.retired = true;
    candidate.stabilityTimer?.cancel();
    candidate.stabilityTimer = null;
    if (this.active === candidate) this.active = null;
    if (close) candidate.client.close();
    return true;
  }

  private isCurrent(candidate: Candidate<TClient>): boolean {
    return !this.disposed && this.active === candidate && !candidate.retired;
  }

  private publish(snapshot: ConnectionSnapshot<TClient>): void {
    this.state = snapshot;
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}

export function createConnectionGenerationController<TClient extends ConnectionGenerationClient>(
  deps: ConnectionGenerationDeps<TClient>,
): ConnectionGenerationController<TClient> {
  return new GenerationController(deps);
}
