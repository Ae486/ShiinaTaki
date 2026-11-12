/**
 * INPUT:  open({ commandId, subscribers, signal? }) from an avatar tool's execute + report(commandId, report) from
 *         the avatar.outcome method; a deadlineMs reader (config knob) and an injectable timer for tests
 * OUTPUT: createAvatarOutcomes(deps) -> { open, report, size }; open resolves to the Presentation Outcome
 * POS:    core/avatar — the pending-outcome registry the tools await (bounded, never blocks with zero subscribers);
 *         pure and node-tested; no OS, no DB (invariant 1/2)
 */
import type { AvatarOutcome, AvatarRejectReason } from "@taki/shared";

export type AvatarReportedOutcome = Exclude<AvatarOutcome, "not_rendered" | "unknown">;

export interface AvatarOutcomeReport {
  /** The reporting connection identity; a duplicate report from the same connection counts once. */
  connection: unknown;
  outcome: AvatarReportedOutcome;
  reason?: AvatarRejectReason;
}

export interface AvatarOutcomeResolution {
  outcome: AvatarOutcome;
  reason?: AvatarRejectReason;
}

export type AvatarReportStatus = "resolved" | "recorded" | "late" | "unknown_command";

export interface AvatarOutcomes {
  open(input: { commandId: string; subscribers: number; signal?: AbortSignal }): Promise<AvatarOutcomeResolution>;
  report(commandId: string, report: AvatarOutcomeReport): AvatarReportStatus;
  size(): number;
}

export interface AvatarOutcomesDeps {
  /** Read per open (the knob's apply class is live). */
  deadlineMs: () => number;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void; clear: () => void };
  /** Cap on simultaneously pending commands; the oldest resolves `unknown` when exceeded. */
  maxPending?: number;
}

interface Pending {
  subscribers: number;
  reports: Map<unknown, AvatarOutcomeReport>;
  finish: (resolution: AvatarOutcomeResolution) => void;
}

interface Registry {
  // Insertion-ordered so the cap can retire the oldest wait first.
  pending: Map<string, Pending>;
  // Recently settled ids, so a report arriving after resolution is classed late rather than unknown.
  settled: Set<string>;
  maxPending: number;
}

const DEFAULT_MAX_PENDING = 256;

const defaultTimer: NonNullable<AvatarOutcomesDeps["setTimer"]> = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return { unref: () => handle.unref(), clear: () => clearTimeout(handle) };
};

// rejected outranks superseded: a rejection names a reason the model can read, a supersession is just "replaced".
function strongest(reports: Iterable<AvatarOutcomeReport>): AvatarOutcomeResolution | undefined {
  let pick: AvatarOutcomeReport | undefined;
  for (const report of reports) {
    if (report.outcome === "applied") return { outcome: "applied" };
    if (!pick || (report.outcome === "rejected" && pick.outcome !== "rejected")) pick = report;
  }
  if (!pick) return undefined;
  return pick.reason === undefined ? { outcome: pick.outcome } : { outcome: pick.outcome, reason: pick.reason };
}

function settle(registry: Registry, commandId: string, resolution: AvatarOutcomeResolution): void {
  const entry = registry.pending.get(commandId);
  if (!entry) return;
  registry.pending.delete(commandId);
  registry.settled.add(commandId);
  if (registry.settled.size > registry.maxPending) {
    const oldest = registry.settled.values().next().value;
    if (oldest !== undefined) registry.settled.delete(oldest);
  }
  entry.finish(resolution);
}

function openWait(
  registry: Registry,
  input: { commandId: string; subscribers: number; signal?: AbortSignal },
  timer: { setTimer: NonNullable<AvatarOutcomesDeps["setTimer"]>; deadlineMs: number },
): Promise<AvatarOutcomeResolution> {
  const { commandId, subscribers, signal } = input;
  if (registry.pending.size >= registry.maxPending) {
    const oldest = registry.pending.keys().next().value;
    if (oldest !== undefined) settle(registry, oldest, { outcome: "unknown" });
  }
  return new Promise<AvatarOutcomeResolution>((resolve) => {
    const deadline = timer.setTimer(() => {
      const entry = registry.pending.get(commandId);
      settle(registry, commandId, (entry && strongest(entry.reports.values())) ?? { outcome: "unknown" });
    }, timer.deadlineMs);
    deadline.unref?.();
    const onAbort = (): void => settle(registry, commandId, { outcome: "unknown" });
    signal?.addEventListener("abort", onAbort, { once: true });
    registry.pending.set(commandId, {
      subscribers,
      reports: new Map(),
      finish: (resolution) => {
        deadline.clear();
        signal?.removeEventListener("abort", onAbort);
        resolve(resolution);
      },
    });
  });
}

export function createAvatarOutcomes(deps: AvatarOutcomesDeps): AvatarOutcomes {
  const setTimer = deps.setTimer ?? defaultTimer;
  const registry: Registry = { pending: new Map(), settled: new Set(), maxPending: deps.maxPending ?? DEFAULT_MAX_PENDING };

  return {
    open(input) {
      if (input.subscribers <= 0) return Promise.resolve({ outcome: "not_rendered" });
      if (input.signal?.aborted) return Promise.resolve({ outcome: "unknown" });
      return openWait(registry, input, { setTimer, deadlineMs: deps.deadlineMs() });
    },
    report(commandId, report) {
      const entry = registry.pending.get(commandId);
      if (!entry) return registry.settled.has(commandId) ? "late" : "unknown_command";
      entry.reports.set(report.connection, report);
      if (report.outcome === "applied") {
        settle(registry, commandId, { outcome: "applied" });
        return "resolved";
      }
      if (entry.reports.size >= entry.subscribers) {
        settle(registry, commandId, strongest(entry.reports.values()) ?? { outcome: "unknown" });
        return "resolved";
      }
      return "recorded";
    },
    size: () => registry.pending.size,
  };
}
