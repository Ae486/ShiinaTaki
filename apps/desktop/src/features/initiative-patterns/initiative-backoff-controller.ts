/**
 * INPUT: current Monitor transport/visibility, typed invalidations and explicit reset intent.
 * OUTPUT: retained real backoff evidence and serialized, non-replayed reset outcomes.
 * POS: same-Monitor disposable read/mutation owner; Core alone owns policy and counters.
 */
import type { InitiativeBackoffStatus } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { createReadCoordinator } from "@/lib/read-coordinator.js";

type Client = Pick<WsClient, "initiativeBackoffRead" | "initiativeBackoffReset" | "onInitiativeBackoffChanged">;
export interface InitiativeBackoffState {
  data: InitiativeBackoffStatus | null; loading: boolean; stale: boolean; pending: boolean;
  error: string | null; feedback: { tone: "ok" | "warn"; message: string } | null;
}
export const INITIAL_BACKOFF_STATE: InitiativeBackoffState = {
  data: null, loading: false, stale: true, pending: false, error: null, feedback: null,
};

export class InitiativeBackoffController {
  private state = INITIAL_BACKOFF_STATE;
  private client: Client | null = null;
  private active = false;
  private generation = 0;
  private mutation: object | null = null;
  private stop: (() => void) | null = null;
  private readonly publish: (state: InitiativeBackoffState) => void;
  private readonly reads = createReadCoordinator<InitiativeBackoffStatus>({
    started: () => this.patch({ loading: true }),
    loaded: (data) => this.patch({ data, loading: false, stale: false, error: null }),
    failed: () => this.patch({ loading: false, stale: true, error: "暂时无法读取退避状态，已保留上次内容。请刷新重试。" }),
    retired: () => this.patch({ loading: false }),
  });

  constructor(publish: (state: InitiativeBackoffState) => void) { this.publish = publish; this.reads.setActive(false); }

  bind(client: Client | null): void {
    if (this.client === client) return;
    this.stop?.(); this.client = client; this.generation += 1;
    if (this.mutation) this.patch({ feedback: { tone: "warn", message: "重置结果尚未确认，请恢复连接后核对。不会自动重新提交。" } });
    this.mutation = null; this.patch({ pending: false, stale: true });
    this.reads.replace(client ? () => client.initiativeBackoffRead({ characterId: ACTIVE_CHARACTER_ID }) : null);
    this.stop = client?.onInitiativeBackoffChanged((event) => {
      if (client !== this.client || event.characterId !== ACTIVE_CHARACTER_ID) return;
      void this.invalidate();
    }) ?? null;
    if (this.active) void this.refresh();
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active; this.reads.setActive(active);
    if (active) { this.publish(this.state); void this.refresh(); }
    else this.patch({ stale: true });
  }
  refresh(): Promise<void> { return this.reads.demand(); }
  private invalidate(): Promise<void> { this.patch({ stale: true }); return this.reads.invalidate(); }

  async reset(): Promise<void> {
    const client = this.client;
    if (!client || !this.active || this.mutation || this.state.stale || this.state.loading) return;
    const token = {}; const generation = this.generation;
    this.mutation = token; this.patch({ pending: true, feedback: null });
    try {
      const data = await client.initiativeBackoffReset({ characterId: ACTIVE_CHARACTER_ID });
      if (this.client !== client || this.generation !== generation) return;
      // The reset's own invalidation can have started a pre-echo read. Give post-reset
      // reconciliation its own read epoch so that old failure cannot consume its obligation.
      this.reads.retire();
      this.reads.acceptUpdate();
      this.patch({ data, feedback: { tone: "ok", message: "已重置主动互动退避。全局次数、间隔等限制仍然有效。" } });
      await this.invalidate();
    } catch {
      if (this.client !== client || this.generation !== generation) return;
      this.patch({ feedback: { tone: "warn", message: "重置结果未能确认，请刷新核对后再决定是否重试。不会自动重新提交。" } });
      await this.invalidate();
    } finally {
      if (this.mutation === token) { this.mutation = null; this.patch({ pending: false }); }
    }
  }

  private patch(patch: Partial<InitiativeBackoffState>): void {
    this.state = { ...this.state, ...patch };
    if (this.active) this.publish(this.state);
  }
}
