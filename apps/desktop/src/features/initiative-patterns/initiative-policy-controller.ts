/**
 * INPUT: existing Monitor client/visibility and typed Core policy invalidations.
 * OUTPUT: bounded retained policy diagnostics with explicit unavailable/error recovery.
 * POS: same-Monitor read projection; it creates neither synthetic Runs nor a polling runtime.
 */
import type { InitiativeWakePolicyStatus } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { createReadCoordinator } from "@/lib/read-coordinator.js";

type Client = Pick<WsClient, "initiativeWakePolicy" | "onInitiativeWakePolicyChanged">;
export interface InitiativePolicyState { data: InitiativeWakePolicyStatus | null; loading: boolean; stale: boolean; error: string | null }
export const INITIAL_POLICY_STATE: InitiativePolicyState = { data: null, loading: false, stale: true, error: null };

export class InitiativePolicyController {
  private state = INITIAL_POLICY_STATE;
  private client: Client | null = null;
  private active = false;
  private stop: (() => void) | null = null;
  private readonly publish: (state: InitiativePolicyState) => void;
  private readonly reads = createReadCoordinator<InitiativeWakePolicyStatus>({
    started: () => this.patch({ loading: true }),
    loaded: (data) => this.patch({ data, loading: false, stale: false, error: null }),
    failed: () => this.patch({ loading: false, stale: true, error: "当前无法读取主动互动判断记录，Core 可能尚不支持或暂时不可用。" }),
    retired: () => this.patch({ loading: false }),
  });
  constructor(publish: (state: InitiativePolicyState) => void) { this.publish = publish; this.reads.setActive(false); }
  bind(client: Client | null): void {
    if (this.client === client) return;
    this.stop?.(); this.client = client; this.patch({ stale: true });
    this.reads.replace(client ? () => client.initiativeWakePolicy({ characterId: ACTIVE_CHARACTER_ID }) : null);
    this.stop = client?.onInitiativeWakePolicyChanged((event) => {
      if (client !== this.client || event.characterId !== ACTIVE_CHARACTER_ID) return;
      this.patch({ stale: true }); void this.reads.invalidate();
    }) ?? null;
    if (this.active) void this.refresh();
  }
  setActive(active: boolean): void {
    this.active = active; this.reads.setActive(active);
    if (active) { this.publish(this.state); void this.refresh(); }
    else this.patch({ stale: true });
  }
  refresh(): Promise<void> { return this.reads.demand(); }
  private patch(patch: Partial<InitiativePolicyState>): void {
    this.state = { ...this.state, ...patch };
    if (this.active) this.publish(this.state);
  }
}
