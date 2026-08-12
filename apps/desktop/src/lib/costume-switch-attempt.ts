/**
 * INPUT:  one costume request, the live WsClient timing policy, PetScene, asset resolver, and attachment callback.
 * OUTPUT: startCostumeSwitchAttempt() - one cancellable total-budget operation with attachment-time commit truth.
 * POS:    ui/lib - framework-free D61 controller spanning Core resolution, Tauri composition, renderer, and report sync.
 */

import type { AvatarVocabulary } from "@/renderer/live2d/model-vocabulary.js";
import type { PetScene } from "@/renderer/pet-scene.js";
import { ACTIVE_CHARACTER_ID } from "./active-character.ts";
import { costumeAssetResolver, type CostumeAssetResolver } from "./character-asset-url.ts";
import {
  costumeReportSync,
  type CostumeReportSyncTracker,
  type CostumeReportTicket,
} from "./costume-report-sync.ts";
import { withTimeout } from "./promise-timeout.ts";
import type { WsClient } from "./ws-client.ts";

export type CostumeAttemptStopReason = "cancelled" | "superseded" | "deadline";

export class CostumeAttemptStoppedError extends Error {
  readonly reason: CostumeAttemptStopReason;

  constructor(reason: CostumeAttemptStopReason, message: string) {
    super(message);
    this.name = "CostumeAttemptStoppedError";
    this.reason = reason;
  }
}

export interface CostumeAttemptRuntime {
  now(): number;
  schedule(delayMs: number, handler: () => void): { cancel(): void };
}

export interface CostumeCommit {
  costumeId: string;
  vocabulary: AvatarVocabulary;
}

export interface CostumeAttemptOutcome {
  committed: true;
  report: "synced" | "recovery-needed";
}

export interface CostumeAttemptHandle {
  result: Promise<CostumeAttemptOutcome>;
  cancel(reason?: Exclude<CostumeAttemptStopReason, "deadline">): boolean;
  committed(): boolean;
}

export interface CostumeSwitchAttemptDeps {
  client: Pick<WsClient, "costumeResolution" | "reportAvatar" | "currentTimingPolicy">;
  scene: Pick<PetScene, "switchCostume" | "abortSwitch">;
  costume: string;
  settingsFile: string;
  onCommit: (commit: CostumeCommit) => void;
  resolveAsset?: (deps: Parameters<typeof costumeAssetResolver>[0]) => Promise<CostumeAssetResolver>;
  reportSync?: CostumeReportSyncTracker;
  runtime?: CostumeAttemptRuntime;
}

const DEFAULT_RUNTIME: CostumeAttemptRuntime = {
  now: () => Date.now(),
  schedule(delayMs, handler) {
    const timer = setTimeout(handler, delayMs);
    return { cancel: () => clearTimeout(timer) };
  },
};

class AttemptGate {
  private readonly totalMs: number;
  private readonly scene: Pick<PetScene, "abortSwitch">;
  private readonly runtime: CostumeAttemptRuntime;
  private readonly deadlineAt: number;
  private readonly timer: { cancel(): void };
  private readonly stopped: Promise<never>;
  private rejectStopped: (cause: CostumeAttemptStoppedError) => void = () => undefined;
  private stopError: CostumeAttemptStoppedError | null = null;
  private rendererInFlight = false;
  private rendererInvalidated = false;
  private isCommitted = false;
  private settled = false;

  constructor(totalMs: number, scene: Pick<PetScene, "abortSwitch">, runtime: CostumeAttemptRuntime) {
    this.totalMs = totalMs;
    this.scene = scene;
    this.runtime = runtime;
    this.deadlineAt = runtime.now() + totalMs;
    this.stopped = new Promise<never>((_resolve, reject) => (this.rejectStopped = reject));
    this.timer = runtime.schedule(totalMs, () => this.stop("deadline"));
  }

  async stage<T>(start: () => Promise<T>): Promise<T> {
    const value = await this.race(start);
    this.throwIfStopped();
    return value;
  }

  async renderer<T>(start: () => Promise<T>, onAttached: (value: T) => void): Promise<T> {
    this.throwIfStopped();
    this.rendererInFlight = true;
    this.rendererInvalidated = false;
    let value: T;
    try {
      value = await Promise.race([start(), this.stopped]);
    } catch (cause) {
      this.invalidateRenderer();
      throw cause;
    } finally {
      this.rendererInFlight = false;
    }
    // switchCostume resolves only after the model attached. If that promise wins the race, attachment is already the
    // irreversible presentation truth; commit it before any later deadline callback can classify report health.
    this.isCommitted = true;
    onAttached(value);
    return value;
  }

  report<T>(start: () => Promise<T>): Promise<T> {
    // An acknowledgement that wins the active race is authoritative even if an injected clock reaches the boundary
    // before a delayed scheduler callback runs. There is no later presentation stage to admit after this await.
    return this.race(start);
  }

  remainingMs(): number {
    return Math.max(0, this.deadlineAt - this.runtime.now());
  }

  deadlineExceeded(): never {
    this.stop("deadline");
    this.throwIfStopped();
    throw new Error("unreachable deadline state");
  }

  committed(): boolean {
    return this.isCommitted;
  }

  cancel(reason: Exclude<CostumeAttemptStopReason, "deadline">): boolean {
    if (this.settled || this.isCommitted || this.stopError) return false;
    this.stop(reason);
    return true;
  }

  finish(): void {
    if (this.settled) return;
    this.settled = true;
    this.timer.cancel();
  }

  private stop(reason: CostumeAttemptStopReason): void {
    if (this.settled || this.stopError) return;
    const message =
      reason === "deadline"
        ? `costume attempt exceeded ${this.totalMs}ms`
        : `costume attempt ${reason}`;
    this.stopError = new CostumeAttemptStoppedError(reason, message);
    this.invalidateRenderer();
    this.rejectStopped(this.stopError);
  }

  private invalidateRenderer(): void {
    if (!this.rendererInFlight || this.rendererInvalidated) return;
    this.rendererInvalidated = true;
    this.scene.abortSwitch();
  }

  private race<T>(start: () => Promise<T>): Promise<T> {
    this.throwIfStopped();
    return Promise.race([start(), this.stopped]);
  }

  private throwIfStopped(): void {
    if (!this.stopError && this.runtime.now() >= this.deadlineAt) this.stop("deadline");
    if (this.stopError) throw this.stopError;
  }
}

async function resolveSource(deps: CostumeSwitchAttemptDeps, gate: AttemptGate): Promise<CostumeAssetResolver> {
  const { resolution } = await gate.stage(() =>
    deps.client.costumeResolution(ACTIVE_CHARACTER_ID, deps.costume),
  );
  const resolveAsset = deps.resolveAsset ?? costumeAssetResolver;
  return gate.stage(() =>
    resolveAsset({
      characterId: ACTIVE_CHARACTER_ID,
      costume: deps.costume,
      settingsFile: deps.settingsFile,
      resolution,
    }),
  );
}

interface AttachInput {
  deps: CostumeSwitchAttemptDeps;
  gate: AttemptGate;
  source: CostumeAssetResolver;
  rendererLoadMs: number;
}

async function attachCostume(input: AttachInput): Promise<AvatarVocabulary> {
  const timeoutMs = Math.min(input.rendererLoadMs, input.gate.remainingMs());
  if (timeoutMs <= 0) return input.gate.deadlineExceeded();
  const vocabulary = await input.gate.renderer(() =>
    withTimeout(input.deps.scene.switchCostume(input.source), timeoutMs, `costume ${input.deps.costume}`),
    (attached) => input.deps.onCommit({ costumeId: input.deps.costume, vocabulary: attached }),
  );
  return vocabulary;
}

interface ReportInput {
  deps: CostumeSwitchAttemptDeps;
  gate: AttemptGate;
  vocabulary: AvatarVocabulary;
  tracker: CostumeReportSyncTracker;
}

async function synchronizeReport(input: ReportInput): Promise<CostumeAttemptOutcome> {
  const ticket: CostumeReportTicket = input.tracker.begin(input.deps.costume, "switch");
  try {
    await input.gate.report(() =>
      input.deps.client.reportAvatar({
        characterId: ACTIVE_CHARACTER_ID,
        ...input.vocabulary,
        costume: input.deps.costume,
      }),
    );
    input.tracker.synchronized(ticket);
    return { committed: true, report: "synced" };
  } catch (cause) {
    input.tracker.recoveryNeeded(ticket, cause);
    return { committed: true, report: "recovery-needed" };
  }
}

async function executeAttempt(
  deps: CostumeSwitchAttemptDeps,
  gate: AttemptGate,
  rendererLoadMs: number,
): Promise<CostumeAttemptOutcome> {
  const source = await resolveSource(deps, gate);
  const vocabulary = await attachCostume({ deps, gate, source, rendererLoadMs });
  return synchronizeReport({ deps, gate, vocabulary, tracker: deps.reportSync ?? costumeReportSync });
}

export function startCostumeSwitchAttempt(deps: CostumeSwitchAttemptDeps): CostumeAttemptHandle {
  // Capture both live values exactly once. A config push changes the next attempt, never timers already in flight.
  const timing = deps.client.currentTimingPolicy();
  const gate = new AttemptGate(timing.petCostumeTotalMs, deps.scene, deps.runtime ?? DEFAULT_RUNTIME);
  const result = executeAttempt(deps, gate, timing.rendererLoadMs).finally(() => gate.finish());
  return {
    result,
    cancel: (reason = "cancelled") => gate.cancel(reason),
    committed: () => gate.committed(),
  };
}
