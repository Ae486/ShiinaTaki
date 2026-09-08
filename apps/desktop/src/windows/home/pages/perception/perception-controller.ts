/**
 * INPUT:  one current Perception client, visible card demand and explicit Privacy Pause commands.
 * OUTPUT: coherent card/pause reads with retired-response guards, truthful uncertainty and independent write lifetime.
 * POS:    Home Perception — memory-only producer projection; no sampling, deadline inference or replay.
 */
import type { PerceptionCard, PerceptionPauseSetParams, PerceptionPauseState } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator, type ReadCoordinator } from "@/lib/read-coordinator.js";
import { createReadObservation, type ReadObservation, type ReadObservationState } from "@/lib/read-observation.js";

export type PerceptionClient = Pick<WsClient, "perceptionCard" | "perceptionPauseSet" | "subscribePerception" | "onPerceptionChanged">;
export interface PerceptionState {
  kind: "idle" | "loading" | "ready" | "failure";
  card: PerceptionCard | null;
  pause: PerceptionPauseState | null;
  error: string | null;
  pauseError: string | null;
  pending: boolean;
  stale: boolean;
  observation: ReadObservationState;
}
export const INITIAL_PERCEPTION_STATE: PerceptionState = {
  kind: "idle", card: null, pause: null, error: null, pauseError: null, pending: false, stale: true, observation: "idle",
};

export function createPerceptionController(publish: (state: PerceptionState) => void) {
  return new PerceptionOwner(publish);
}

class PerceptionOwner {
  private client: PerceptionClient | null = null;
  private generation = 0;
  private readEpoch = 0;
  private visible = true;
  private writing = false;
  private invalidatedDuringWrite = false;
  private restoreAfterWrite = false;
  private state = INITIAL_PERCEPTION_STATE;
  private readonly publish: (state: PerceptionState) => void;
  private readonly reads: ReadCoordinator<PerceptionCard>;
  private readonly observation: ReadObservation;

  constructor(publish: (state: PerceptionState) => void) {
    this.publish = publish;
    this.reads = createReadCoordinator<PerceptionCard>({
      started: () => this.set({ ...this.state, kind: "loading" }),
      loaded: (card) => {
        this.invalidatedDuringWrite = false;
        this.set({ ...this.state, kind: "ready", card, pause: card.pauseState, stale: false, error: null,
          pauseError: this.writing ? this.state.pauseError : null });
      },
      failed: (cause) => this.set({ ...this.state, kind: "failure", pause: null, stale: true, error: readable(cause) }),
      retired: () => this.set({ ...this.state, kind: "idle" }),
    });
    this.observation = createReadObservation({
      changed: (observation) => {
        const kind = observation === "subscribing" ? "loading" : this.state.kind;
        this.set({ ...this.state, observation, kind });
      },
      failed: (cause) => this.set({ ...this.state, kind: "failure", pause: null, stale: true, error: readable(cause) }),
      invalidated: () => { void this.invalidate(); },
    });
  }

  replace(client: PerceptionClient | null): void {
    if (this.client === client) return;
    this.generation += 1;
    this.readEpoch += 1;
    this.client = client;
    this.writing = false;
    this.invalidatedDuringWrite = false;
    this.restoreAfterWrite = false;
    this.reads.setActive(false);
    this.reads.replace(client ? () => client.perceptionCard() : null);
    this.set({ ...this.state, kind: "idle", pause: null, stale: true, pending: false, error: null, pauseError: null });
    this.observation.replace(client ? {
      subscribe: () => client.subscribePerception(),
      onChanged: (changed) => client.onPerceptionChanged((event) => changed(event.revision)),
    } : null);
    if (client) void this.refresh();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.readEpoch += 1;
    this.reads.setActive(false);
    if (!visible) this.set({ ...this.state, pause: null, stale: true });
    else {
      this.publish(this.state);
      if (!this.writing) void this.refresh();
      else this.restoreAfterWrite = true;
    }
  }

  refresh(): Promise<void> { return this.read(false); }
  invalidate(): Promise<void> {
    if (this.writing) this.invalidatedDuringWrite = true;
    this.set({ ...this.state, stale: true });
    return this.reads.invalidate();
  }

  async setPause(params: PerceptionPauseSetParams): Promise<void> {
    const client = this.client;
    const generation = this.generation;
    if (!client || this.writing) return;
    if (!params.paused && (this.state.stale || this.state.pause?.paused !== true)) {
      this.set({ ...this.state, pauseError: "当前隐私状态尚未确认，请刷新后再恢复观察。" });
      return;
    }
    this.writing = true;
    this.invalidatedDuringWrite = false;
    this.readEpoch += 1;
    this.reads.setActive(false);
    this.set({ ...this.state, pending: true, pauseError: null });
    try {
      const pause = await client.perceptionPauseSet(params);
      if (!this.current(client, generation)) return;
      this.reads.acceptUpdate();
      this.set({ ...this.state, pause: this.visible ? pause : null, pauseError: null });
      if (this.visible) this.restoreAfterWrite = false;
      await this.read(true);
    } catch (cause) {
      if (this.current(client, generation)) {
        this.set({ ...this.state, pause: null, stale: true, pauseError: readable(cause) });
        // A failed/unknown command can overlap somebody else's accepted change. Restore the read
        // projection after that hint while preserving this attempt's error and never replaying it.
        if (this.invalidatedDuringWrite) await this.read(true);
      }
    } finally {
      if (this.current(client, generation)) {
        this.writing = false;
        this.reads.setActive(this.visible && this.observation.usable());
        this.set({ ...this.state, pending: false });
        if (this.visible && this.restoreAfterWrite) {
          this.restoreAfterWrite = false;
          await this.refresh();
        }
      }
    }
  }

  dispose(): void { this.replace(null); }
  private async read(afterWrite: boolean): Promise<void> {
    if (!this.client || !this.visible || (this.writing && !afterWrite)) return;
    const token = this.readEpoch;
    if (!this.observation.usable() && !await this.observation.prepare()) return;
    if (token !== this.readEpoch || !this.visible || (this.writing && !afterWrite)) return;
    this.reads.setActive(true);
    await this.reads.demand();
  }
  private current(client: PerceptionClient, generation: number): boolean { return this.client === client && this.generation === generation; }
  private set(state: PerceptionState): void { this.state = state; if (this.visible) this.publish(state); }
}

function readable(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
