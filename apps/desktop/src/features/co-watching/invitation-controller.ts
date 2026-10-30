/**
 * INPUT: a physical operator client, actual Chat visibility and exact invitation/session actions
 * OUTPUT: push-driven contextual invitation/Stop state with retained uncertain command outcomes
 * POS: Desktop Co-Watching — disposable projection; Core alone owns consent, expiry and suppression
 */
import type { CoWatchingInvitation, CoWatchingInvitationRespondResult, CoWatchingSession } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator } from "@/lib/read-coordinator.js";
import { createReadObservation } from "@/lib/read-observation.js";

export type InvitationClient = Pick<WsClient, "coWatchingInvitationRead" | "coWatchingInvitationRespond"
  | "coWatchingRead" | "coWatchingStop" | "subscribeCoWatching" | "onCoWatchingChanged">;
interface Projection { invitation: CoWatchingInvitation | null; session: CoWatchingSession | null }
export interface InvitationState extends Projection {
  stale: boolean; loading: boolean; pending: boolean; error: string | null; commandError: string | null;
}
export const INITIAL_INVITATION_STATE: InvitationState = {
  invitation: null, session: null, stale: true, loading: false, pending: false, error: null, commandError: null,
};
const REJECTIONS: Record<Extract<CoWatchingInvitationRespondResult, { status: "refused" }>["reason"], string> = {
  not_found: "这份邀请已不再可用。", stale: "邀请或播放来源已变化，请刷新后确认。", already_handled: "这份邀请已处理，请查看当前状态。",
  not_ready: "当前无法开始共看，请查看视频连接与分析服务。", command_conflict: "操作与已有请求冲突，请刷新。", unavailable: "共看邀请暂不可用。",
};

export class InvitationController {
  private client: InvitationClient | null = null;
  private generation = 0;
  private readEpoch = 0;
  private visible = true;
  private writing = false;
  private restoreAfterWrite = false;
  private state = INITIAL_INVITATION_STATE;
  private readonly characterId: string;
  private readonly publish: (state: InvitationState) => void;
  private readonly reads = createReadCoordinator<Projection>({
    started: () => this.set({ ...this.state, loading: true }),
    loaded: (data) => this.set({ ...this.state, ...data, loading: false, stale: false, error: null }),
    failed: (cause) => this.set({ ...this.state, loading: false, stale: true, error: readable(cause) }),
    retired: () => this.set({ ...this.state, loading: false }),
  });
  private readonly observation = createReadObservation({
    changed: () => undefined,
    failed: (cause) => this.set({ ...this.state, loading: false, stale: true, error: readable(cause) }),
    invalidated: () => { this.set({ ...this.state, stale: true }); void this.reads.invalidate(); },
  });
  constructor(characterId: string, publish: (state: InvitationState) => void) {
    this.characterId = characterId; this.publish = publish;
  }
  replace(client: InvitationClient | null): void {
    if (client === this.client) return;
    const commandError = this.writing ? "连接已更换，上次操作结果尚未确认；请查看当前状态，不要重复提交。" : this.state.commandError;
    this.generation += 1; this.readEpoch += 1; this.client = client;
    this.writing = false; this.restoreAfterWrite = false; this.reads.setActive(false);
    this.reads.replace(client ? async () => {
      const [offered, watching] = await Promise.all([client.coWatchingInvitationRead(this.characterId), client.coWatchingRead(this.characterId)]);
      return { invitation: offered.invitation, session: watching.session };
    } : null);
    this.set({ ...INITIAL_INVITATION_STATE, commandError });
    this.observation.replace(client ? { subscribe: () => client.subscribeCoWatching(this.characterId),
      onChanged: (changed) => client.onCoWatchingChanged((event) => { if (event.characterId === this.characterId) changed(event.revision); }) } : null);
    if (client) void this.refresh();
  }
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible; this.readEpoch += 1; this.reads.setActive(false);
    if (!visible) this.set({ ...this.state, stale: true });
    else {
      this.publish(this.state);
      if (this.writing) this.restoreAfterWrite = true;
      else void this.refresh();
    }
  }
  refresh(): Promise<void> { return this.read(false); }
  respond(invitation: CoWatchingInvitation, action: "accept" | "defer"): Promise<void> {
    if (!this.visible || this.state.stale || this.state.invitation?.invitationId !== invitation.invitationId
      || this.state.invitation.version !== invitation.version) return Promise.resolve();
    return this.mutate(async (client) => {
      const result = await client.coWatchingInvitationRespond({ characterId: this.characterId,
        invitationId: invitation.invitationId, expectedVersion: invitation.version, commandId: crypto.randomUUID(), action });
      return result.status === "refused" ? REJECTIONS[result.reason] : null;
    });
  }
  stop(sessionId: string): Promise<void> {
    if (this.state.session?.sessionId !== sessionId) return Promise.resolve();
    return this.mutate(async (client) => {
      const result = await client.coWatchingStop({ characterId: this.characterId, sessionId });
      return result.accepted ? null : "停止结果尚未确认，请刷新共看状态。";
    });
  }
  private async mutate(action: (client: InvitationClient) => Promise<string | null>): Promise<void> {
    const client = this.client; const generation = this.generation;
    if (!client || this.writing) return;
    this.writing = true; this.readEpoch += 1; this.reads.setActive(false);
    this.set({ ...this.state, pending: true, stale: true, commandError: null });
    try {
      const commandError = await action(client);
      if (!this.current(client, generation)) return;
      this.reads.acceptUpdate(); this.set({ ...this.state, commandError });
    } catch (cause) {
      if (this.current(client, generation)) this.set({ ...this.state, commandError: `操作未确认：${readable(cause)}` });
    } finally {
      if (this.current(client, generation)) await this.settleWrite(client, generation);
    }
  }
  private async settleWrite(client: InvitationClient, generation: number): Promise<void> {
    this.restoreAfterWrite = false;
    await this.read(true);
    if (!this.current(client, generation)) return;
    this.writing = false;
    this.reads.setActive(this.visible && this.observation.usable());
    this.set({ ...this.state, pending: false });
    if (this.visible && this.restoreAfterWrite) { this.restoreAfterWrite = false; await this.refresh(); }
  }
  private async read(afterWrite: boolean): Promise<void> {
    if (!this.client || !this.visible || (this.writing && !afterWrite)) return;
    const token = this.readEpoch;
    if (!this.observation.usable() && !await this.observation.prepare()) return;
    if (token !== this.readEpoch || !this.visible || (this.writing && !afterWrite)) return;
    this.reads.setActive(true); await this.reads.demand();
  }
  private current(client: InvitationClient, generation: number): boolean { return this.client === client && this.generation === generation; }
  private set(state: InvitationState): void { this.state = state; if (this.visible) this.publish(state); }
}
function readable(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
