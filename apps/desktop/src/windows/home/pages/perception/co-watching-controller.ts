/**
 * INPUT: a physical operator client, Character, page visibility and explicit start/stop commands
 * OUTPUT: push-driven, disposable Co-Watching projection with independent command settlement
 * POS: Home Perception — producer state only; no model calls, local playback gates or mutation replay
 */
import type { CoWatchingControlResult, CoWatchingReadResult, CoWatchingStart } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator } from "@/lib/read-coordinator.js";
import { createReadObservation, type ReadObservationState } from "@/lib/read-observation.js";

export type CoWatchingClient = Pick<WsClient, "coWatchingRead" | "coWatchingStart" | "coWatchingStop"
  | "subscribeCoWatching" | "onCoWatchingChanged">;
export interface CoWatchingState {
  data: CoWatchingReadResult | null;
  loading: boolean;
  stale: boolean;
  pending: boolean;
  error: string | null;
  commandError: string | null;
  observation: ReadObservationState;
}
export const INITIAL_CO_WATCHING_STATE: CoWatchingState = {
  data: null, loading: false, stale: true, pending: false, error: null, commandError: null, observation: "idle",
};
const REJECTIONS = { not_ready: "播放来源、分析或技能尚未就绪，请刷新后检查。", already_active: "已有共看正在进行。",
  request_conflict: "此操作与现有共看请求冲突，请刷新。", not_found: "该共看已不再可用。", busy: "正在处理上一项操作，请稍后再试。" };

export interface CoWatchingController {
  replace(client: CoWatchingClient | null): void;
  setVisible(visible: boolean): void;
  refresh(): Promise<void>;
  dispose(): void;
  start(selection: Pick<CoWatchingStart, "sourceRef" | "analysisId" | "lifetimeMinutes">): Promise<void>;
  stop(sessionId: string): Promise<void>;
}
export function createCoWatchingController(characterId: string, publish: (state: CoWatchingState) => void): CoWatchingController {
  return new CoWatchingOwner(characterId, publish);
}

class CoWatchingOwner {
  private client: CoWatchingClient | null = null;
  private generation = 0;
  private readEpoch = 0;
  private visible = true;
  private writing = false;
  private restoreAfterWrite = false;
  private state = INITIAL_CO_WATCHING_STATE;
  private readonly characterId: string;
  private readonly publish: (state: CoWatchingState) => void;
  private readonly reads = createReadCoordinator<CoWatchingReadResult>({
    started: () => this.set({ ...this.state, loading: true }),
    loaded: (data) => this.set({ ...this.state, data, loading: false, stale: false, error: null }),
    failed: (cause) => this.set({ ...this.state, loading: false, stale: true, error: readable(cause) }),
    retired: () => this.set({ ...this.state, loading: false }),
  });
  private readonly observation = createReadObservation({
    changed: (observation) => this.set({ ...this.state, observation }),
    failed: (cause) => this.set({ ...this.state, loading: false, stale: true, error: readable(cause) }),
    invalidated: () => {
      this.set({ ...this.state, stale: true });
      void this.reads.invalidate();
    },
  });

  constructor(characterId: string, publish: (state: CoWatchingState) => void) {
    this.characterId = characterId;
    this.publish = publish;
  }

  replace(client: CoWatchingClient | null): void {
    if (client === this.client) return;
    const commandError = this.writing ? "连接已更换，上次操作结果尚未确认；请检查当前状态，不要重复提交。" : this.state.commandError;
    this.generation += 1;
    this.readEpoch += 1;
    this.client = client;
    this.writing = false;
    this.restoreAfterWrite = false;
    this.reads.setActive(false);
    this.reads.replace(client ? () => client.coWatchingRead(this.characterId) : null);
    this.set({ ...INITIAL_CO_WATCHING_STATE, commandError });
    this.observation.replace(client ? {
      subscribe: () => client.subscribeCoWatching(this.characterId),
      onChanged: (changed) => client.onCoWatchingChanged((event) => {
        if (event.characterId === this.characterId) changed(event.revision);
      }),
    } : null);
    if (client) void this.refresh();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.readEpoch += 1;
    this.reads.setActive(false);
    if (!visible) this.set({ ...this.state, stale: true });
    else {
      this.publish(this.state);
      if (this.writing) this.restoreAfterWrite = true;
      else void this.refresh();
    }
  }
  refresh(): Promise<void> { return this.read(false); }
  dispose(): void { this.replace(null); }

  start(selection: Pick<CoWatchingStart, "sourceRef" | "analysisId" | "lifetimeMinutes">): Promise<void> {
    if (!this.visible || this.state.stale || !this.state.data?.enabled) return Promise.resolve();
    return this.mutate((client) => client.coWatchingStart({ ...selection, characterId: this.characterId, requestId: crypto.randomUUID() }));
  }
  stop(sessionId: string): Promise<void> {
    if (this.state.data?.session?.sessionId !== sessionId) return Promise.resolve();
    return this.mutate((client) => client.coWatchingStop({ characterId: this.characterId, sessionId }));
  }

  private async mutate(action: (client: CoWatchingClient) => Promise<CoWatchingControlResult>): Promise<void> {
    const client = this.client;
    const generation = this.generation;
    if (!client || this.writing) return;
    this.writing = true;
    this.readEpoch += 1;
    this.reads.setActive(false);
    this.set({ ...this.state, pending: true, stale: true, commandError: null });
    try {
      const result = await action(client);
      if (!this.current(client, generation)) return;
      this.reads.acceptUpdate();
      this.set({ ...this.state, commandError: result.accepted ? null : REJECTIONS[result.reason] });
    } catch (cause) {
      if (this.current(client, generation)) this.set({ ...this.state, commandError: `操作未确认：${readable(cause)}` });
    } finally {
      if (this.current(client, generation)) await this.settleWrite(client, generation);
    }
  }

  private async settleWrite(client: CoWatchingClient, generation: number): Promise<void> {
    // A covering read reconciles even unknown command outcomes. It never resubmits the command.
    this.restoreAfterWrite = false;
    await this.read(true);
    if (!this.current(client, generation)) return;
    this.writing = false;
    this.reads.setActive(this.visible && this.observation.usable());
    this.set({ ...this.state, pending: false });
    if (this.visible && this.restoreAfterWrite) {
      this.restoreAfterWrite = false;
      await this.refresh();
    }
  }
  private async read(afterWrite: boolean): Promise<void> {
    if (!this.client || !this.visible || (this.writing && !afterWrite)) return;
    const token = this.readEpoch;
    if (!this.observation.usable() && !await this.observation.prepare()) return;
    if (token !== this.readEpoch || !this.visible || (this.writing && !afterWrite)) return;
    this.reads.setActive(true);
    await this.reads.demand();
  }
  private current(client: CoWatchingClient, generation: number): boolean { return this.client === client && this.generation === generation; }
  private set(state: CoWatchingState): void { this.state = state; if (this.visible) this.publish(state); }
}
function readable(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
