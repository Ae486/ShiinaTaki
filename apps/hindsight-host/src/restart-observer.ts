/**
 * INPUT:  one original fake resource identity, independent fake startup grants, and exact observations
 * OUTPUT: bounded non-secret restart state without creation, replay, or deployment authority
 * POS:    hindsight-host — C1b internal prototype; no production adapter, registry, or release caller
 */
import { z } from "zod";
import {
  HINDSIGHT_CUSTODY_LIMITS, HindsightCustodyDigestSchema, HindsightCustodyRefusalSchema,
  type HindsightCustodyRefusal,
} from "@taki/shared/hindsight-custody";

export interface OriginalResource {
  readonly resourceId: string;
  readonly operationId: string;
  readonly configurationDigest: string;
}

export interface StartupAttempt {
  readonly startupId: string;
  readonly operationId: string;
  readonly attemptId: string;
  readonly authorizationId: string;
  readonly configurationDigest: string;
}

export interface FakeStartupGrant extends StartupAttempt {
  readonly kind: "c1b-fake-startup-grant";
  readonly deadlineAt: string;
  readonly current: () => HindsightCustodyRefusal | undefined;
}

export interface FakeResourceObservation {
  readonly resourceId: string;
  readonly startupId: string;
  readonly configurationDigest: string;
  readonly state: "waiting" | "running" | "stopped";
  readonly accepted?: StartupAttempt;
}

export type FakeGrantResult = FakeStartupGrant | { readonly reason: HindsightCustodyRefusal };

/** Internal test adapter, not a wire protocol or production grant authority. */
export interface FakeRestartAdapter {
  inspect(resourceId: string): Promise<FakeResourceObservation | undefined>;
  authorize(original: OriginalResource, startupId: string): Promise<FakeGrantResult>;
  submit(grant: FakeStartupGrant): Promise<StartupAttempt>;
}

export interface RestartStatus extends OriginalResource {
  readonly state: "waiting" | "running" | "stopped" | "unavailable" | "outcome-unknown";
  readonly startupId?: string;
  readonly attemptId?: string;
  readonly reason?: HindsightCustodyRefusal;
  readonly deploymentReady: false;
}

interface ObserverOptions {
  readonly original: OriginalResource;
  readonly adapter: FakeRestartAdapter;
  readonly recovery?: StartupAttempt;
  readonly wallNow?: () => number;
  readonly monotonicNow?: () => number;
}

interface AttemptRecord {
  readonly attempt: StartupAttempt;
  readonly grant?: FakeStartupGrant;
  readonly monotonicDeadline: number;
  dispatched: boolean;
}

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const MAX_STARTUPS = 64;


class ObservationRefusal extends Error {
  readonly reason: HindsightCustodyRefusal;
  constructor(reason: HindsightCustodyRefusal) {
    super(reason);
    this.reason = reason;
  }
}

function validAttempt(attempt: StartupAttempt): boolean {
  return [attempt.startupId, attempt.operationId, attempt.attemptId, attempt.authorizationId]
    .every((value) => uuid.safeParse(value).success)
    && HindsightCustodyDigestSchema.safeParse(attempt.configurationDigest).success;
}

function sameAttempt(left: StartupAttempt, right: StartupAttempt): boolean {
  return left.startupId === right.startupId && left.operationId === right.operationId
    && left.attemptId === right.attemptId && left.authorizationId === right.authorizationId
    && left.configurationDigest === right.configurationDigest;
}

export class FakeRestartObserver {
  readonly #original: OriginalResource;
  readonly #adapter: FakeRestartAdapter;
  readonly #wallNow: () => number;
  readonly #monotonicNow: () => number;
  readonly #attempts = new Map<string, AttemptRecord>();
  readonly #cancel = new Set<(error: Error) => void>();
  #active = true;
  #pending: Promise<RestartStatus> | undefined;
  #status: RestartStatus;

  constructor(options: ObserverOptions) {
    const original = options.original;
    if (!uuid.safeParse(original.resourceId).success || !uuid.safeParse(original.operationId).success
      || !HindsightCustodyDigestSchema.safeParse(original.configurationDigest).success) {
      throw new Error("invalid C1b fake resource identity");
    }
    this.#original = Object.freeze({ resourceId: original.resourceId, operationId: original.operationId,
      configurationDigest: original.configurationDigest });
    this.#adapter = options.adapter;
    this.#wallNow = options.wallNow ?? Date.now;
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#status = { ...this.#original, state: "waiting", deploymentReady: false };
    if (options.recovery) this.#recover(options.recovery);
  }

  #recover(attempt: StartupAttempt): void {
    if (!validAttempt(attempt) || attempt.operationId !== this.#original.operationId
      || attempt.configurationDigest !== this.#original.configurationDigest) {
      throw new Error("invalid C1b fake recovery identity");
    }
    // A supplied recovery record proves only the original IDs. It must still
    // inspect that same resource; it is never permission to submit again.
    this.#attempts.set(attempt.startupId, {
      attempt: Object.freeze({ ...attempt }), monotonicDeadline: 0, dispatched: true,
    });
  }

  snapshot(): RestartStatus {
    return { ...this.#status };
  }

  close(): void {
    this.#active = false;
    for (const cancel of this.#cancel) cancel(new ObservationRefusal("host-unavailable"));
    // This retires observation only. Home closure is not connected here, and
    // the observer cannot delete/recreate/stop an existing owned resource.
    this.#publish("unavailable", "host-unavailable");
  }

  reconcile(): Promise<RestartStatus> {
    if (this.#pending) return this.#pending;
    const pending = this.#step().finally(() => { this.#pending = undefined; });
    this.#pending = pending;
    return pending;
  }

  #publish(state: RestartStatus["state"], reason?: HindsightCustodyRefusal, attempt?: StartupAttempt): RestartStatus {
    const status: RestartStatus = {
      ...this.#original, state, deploymentReady: false,
      ...(attempt ? { startupId: attempt.startupId, attemptId: attempt.attemptId } : {}),
      ...(reason ? { reason } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(status)) > HINDSIGHT_CUSTODY_LIMITS.resultBytes) {
      throw new Error("C1b status exceeded its fixed contract");
    }
    this.#status = status;
    return this.snapshot();
  }

  #validObservation(observed: FakeResourceObservation): boolean {
    return observed.resourceId === this.#original.resourceId
      && observed.configurationDigest === this.#original.configurationDigest
      && uuid.safeParse(observed.startupId).success
      && ["waiting", "running", "stopped"].includes(observed.state);
  }

  async #bounded<T>(work: () => Promise<T>, record?: AttemptRecord): Promise<T> {
    const remaining = record?.grant ? Math.min(record.monotonicDeadline - this.#monotonicNow(),
      Date.parse(record.grant.deadlineAt) - this.#wallNow()) : 90_000;
    if (!this.#active || remaining <= 0) throw new ObservationRefusal(this.#active ? "snapshot-stale" : "host-unavailable");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: ((error: Error) => void) | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      cancel = reject;
      this.#cancel.add(reject);
      timer = setTimeout(() => reject(new ObservationRefusal("snapshot-stale")), remaining);
    });
    try {
      return await Promise.race([work(), expired]);
    } finally {
      clearTimeout(timer);
      if (cancel) this.#cancel.delete(cancel);
    }
  }

  async #step(): Promise<RestartStatus> {
    if (!this.#active) return this.#publish("unavailable", "host-unavailable");
    try {
      const observed = await this.#bounded(() => this.#adapter.inspect(this.#original.resourceId));
      if (!this.#active || !observed) return this.#publish("unavailable", "host-unavailable");
      if (!this.#validObservation(observed)) return this.#publish("unavailable", "snapshot-stale");
      const previous = this.#attempts.get(observed.startupId);
      if (previous?.dispatched) return this.#observeDispatched(observed, previous);
      if (observed.state !== "waiting") return this.#publish("outcome-unknown", "outcome-unknown");
      // Keep the prototype finite without evicting consumed IDs and enabling
      // restore-ABA replay. C2a owns the actual durable deployment registry.
      if (this.#attempts.size >= MAX_STARTUPS) return this.#publish("unavailable", "snapshot-stale");
      return await this.#authorize(observed);
    } catch (error) {
      return this.#publish("unavailable", error instanceof ObservationRefusal ? error.reason : "host-unavailable");
    }
  }

  #observeDispatched(observed: FakeResourceObservation, previous: AttemptRecord): RestartStatus {
    const attempt = previous.attempt;
    if (!observed.accepted || !validAttempt(observed.accepted) || !sameAttempt(observed.accepted, attempt)) {
      return this.#publish("outcome-unknown", "outcome-unknown", attempt);
    }
    if (observed.state === "waiting") return this.#publish("outcome-unknown", "outcome-unknown", attempt);
    // Receipt recovery is read-only and can outlive grant expiry or Catalog
    // rotation. An already running process does not obtain fresh credentials.
    return this.#publish(observed.state, undefined, attempt);
  }

  #grantRecord(grant: FakeStartupGrant, observed: FakeResourceObservation): AttemptRecord | undefined {
    if (grant.kind !== "c1b-fake-startup-grant" || typeof grant.current !== "function"
      || !validAttempt(grant) || !timestamp.safeParse(grant.deadlineAt).success
      || grant.startupId !== observed.startupId || grant.operationId !== this.#original.operationId
      || grant.configurationDigest !== this.#original.configurationDigest) return undefined;
    if ([...this.#attempts.values()].some(({ attempt }) => attempt.attemptId === grant.attemptId
      || attempt.authorizationId === grant.authorizationId)) return undefined;
    return {
      attempt: Object.freeze({ startupId: grant.startupId, operationId: grant.operationId, attemptId: grant.attemptId,
        authorizationId: grant.authorizationId, configurationDigest: grant.configurationDigest }),
      grant, dispatched: false,
      monotonicDeadline: this.#monotonicNow() + Math.min(90_000, Math.max(0, Date.parse(grant.deadlineAt) - this.#wallNow())),
    };
  }

  #current(record: AttemptRecord): HindsightCustodyRefusal | undefined {
    if (!this.#active) return "host-unavailable";
    const grant = record.grant;
    if (!grant || this.#monotonicNow() >= record.monotonicDeadline || this.#wallNow() >= Date.parse(grant.deadlineAt)) {
      return "snapshot-stale";
    }
    const reason = grant.current();
    if (reason === undefined) return undefined;
    return HindsightCustodyRefusalSchema.safeParse(reason).success ? reason : "snapshot-stale";
  }

  async #authorize(observed: FakeResourceObservation): Promise<RestartStatus> {
    const grant = await this.#bounded(() => this.#adapter.authorize(this.#original, observed.startupId));
    if (!this.#active) return this.#publish("unavailable", "host-unavailable");
    if ("reason" in grant) {
      const reason = HindsightCustodyRefusalSchema.safeParse(grant.reason);
      return this.#publish("unavailable", reason.success ? reason.data : "snapshot-stale");
    }
    const record = this.#grantRecord(grant, observed);
    if (!record) return this.#publish("unavailable", "snapshot-stale");
    const current = await this.#bounded(() => this.#adapter.inspect(this.#original.resourceId), record);
    if (!current || !this.#validObservation(current) || current.startupId !== observed.startupId || current.state !== "waiting") {
      return this.#publish("unavailable", "snapshot-stale", record.attempt);
    }
    const reason = this.#current(record);
    if (reason) return this.#publish("unavailable", reason, record.attempt);
    this.#attempts.set(observed.startupId, record);
    return this.#submit(record);
  }

  async #submit(record: AttemptRecord): Promise<RestartStatus> {
    const grant = record.grant;
    if (!grant) return this.#publish("unavailable", "snapshot-stale", record.attempt);
    // Fence before awaiting any effect. An exception, disconnect, lost ACK or
    // late result is observed by the original IDs; it never triggers replay.
    record.dispatched = true;
    try {
      const ack = await this.#bounded(() => this.#adapter.submit(grant), record);
      if (this.#current(record) || !validAttempt(ack) || !sameAttempt(ack, record.attempt)) {
        return this.#publish("outcome-unknown", "outcome-unknown", record.attempt);
      }
      return this.#publish("running", undefined, record.attempt);
    } catch {
      return this.#publish("outcome-unknown", "outcome-unknown", record.attempt);
    }
  }
}
