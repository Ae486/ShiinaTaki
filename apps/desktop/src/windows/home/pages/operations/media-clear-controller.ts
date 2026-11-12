/**
 * INPUT:  explicit two-step purge events, the current operator client and presentation callbacks.
 * OUTPUT: one destructive attempt per confirmation, guarded outcomes and truthful retryable errors.
 * POS:    Operations media-clear action owner; never replays writes or treats refresh as execution.
 */
import type { WsClient } from "@/lib/ws-client.js";
import { clearPhaseAfter, type ClearEvent, type ClearPhase } from "./operations-state.ts";

type MediaClient = Pick<WsClient, "mediaClear">;
type ClearResult = Awaited<ReturnType<MediaClient["mediaClear"]>>;
export interface MediaClearState { phase: ClearPhase; error: string | null }
interface MediaClearSink {
  changed(state: MediaClearState): void;
  started(): void;
  succeeded(result: ClearResult, eventKey: object): void;
  failed(eventKey: object): void;
  settled(): void;
}

export function createMediaClearController(sink: MediaClearSink) {
  return new MediaClear(sink);
}

class MediaClear {
  private state: MediaClearState = { phase: "idle", error: null };
  private client: MediaClient | null = null;
  private epoch = 0;
  private readonly sink: MediaClearSink;
  constructor(sink: MediaClearSink) { this.sink = sink; }

  replace(client: MediaClient | null): void {
    if (client === this.client) return;
    this.client = client;
    this.epoch += 1;
    // Reconnection restores transport, not proof of the prior purge. A new confirmation may clear
    // this past-attempt diagnostic, but a retired response or another bind must not erase it.
    const error = this.state.phase === "clearing" ? "连接已变化，清除结果尚未确认；请刷新存储占用核对。" : this.state.error;
    this.set({ phase: "idle", error });
  }

  dispose(): void { this.client = null; this.epoch += 1; }

  onEvent = (event: ClearEvent): void => {
    const phase = clearPhaseAfter(this.state.phase, event);
    if (phase === this.state.phase) return;
    if (event === "request") this.sink.started();
    if (phase !== "clearing") { this.set({ phase, error: null }); return; }
    if (!this.client) { this.set({ ...this.state, error: "尚未连接到 Agent Core，未执行清除。" }); return; }
    this.set({ phase, error: null });
    void this.clear(this.client);
  };

  private async clear(client: MediaClient): Promise<void> {
    const epoch = this.epoch;
    const eventKey = {};
    try {
      const result = await client.mediaClear();
      if (!this.current(client, epoch)) return;
      this.set({ phase: "idle", error: null });
      this.sink.succeeded(result, eventKey);
      this.sink.settled();
    } catch (cause) {
      if (!this.current(client, epoch)) return;
      this.set({ phase: "idle", error: cause instanceof Error ? cause.message : String(cause) });
      this.sink.failed(eventKey);
    }
  }

  private current(client: MediaClient, epoch: number): boolean {
    return this.client === client && this.epoch === epoch;
  }
  private set(state: MediaClearState): void { this.state = state; this.sink.changed(state); }
}
