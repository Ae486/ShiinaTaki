/**
 * INPUT: authenticated visible client, durable change hints and explicit recovery clicks
 * OUTPUT: retained reconciliation list and serialized idempotent operator continuation
 * POS: ui/subagents — separate from child Stop/Continue; Core alone restores inbox execution
 */
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator } from "@/lib/read-coordinator.js";

type InboxClient = Pick<WsClient, "subagentInboxRecovery" | "subagentInboxResume" | "onSubagentChanged" | "subscribeSubagents">;
type InboxPage = Awaited<ReturnType<InboxClient["subagentInboxRecovery"]>>;
export interface InboxView { page: InboxPage | null; loading: boolean; fresh: boolean; pending: string | null; error: string | null; feedback: string | null }
export const EMPTY_INBOX_VIEW: InboxView = { page: null, loading: false, fresh: false, pending: null, error: null, feedback: null };

export class SubagentInboxController {
  private readonly publish: (view: InboxView) => void;
  private state = EMPTY_INBOX_VIEW;
  private client: InboxClient | null = null;
  private characterId = "";
  private generation = 0;
  private unsubscribe: (() => void) | null = null;
  private readonly operations = new Map<string, string>();
  private depth = 1;
  private readonly read = createReadCoordinator<InboxPage>({
    started: () => this.patch({ loading: true, fresh: false }),
    loaded: (page) => this.patch({ page, loading: false, fresh: true, error: null }),
    failed: () => this.patch({ loading: false, fresh: false, error: "主助手恢复记录读取失败，已保留上次内容。" }),
    retired: () => this.patch({ loading: false, fresh: false }),
  });
  constructor(publish: (view: InboxView) => void) { this.publish = publish; }

  bind(client: InboxClient | null, characterId: string): void {
    this.unsubscribe?.(); this.unsubscribe = null;
    this.generation += 1;
    this.client = client; this.characterId = characterId;
    this.read.replace(client ? () => this.load(client, characterId) : null);
    this.read.setActive(false);
    if (this.state.pending) this.patch({ pending: null, feedback: "连接已中断，恢复操作结果尚未确认。不会自动重试。" });
    this.patch({ fresh: false });
    if (!client) return;
    const generation = this.generation;
    this.unsubscribe = client.onSubagentChanged((change) => {
      if (change.characterId === characterId && this.generation === generation && !this.state.pending) void this.read.invalidate();
    });
    void client.subscribeSubagents().then(() => {
      if (this.generation === generation) { this.read.setActive(true); void this.read.demand(); }
    }).catch(() => { if (this.generation === generation) this.patch({ error: "恢复记录订阅失败，请刷新。" }); });
  }

  refresh(): void {
    const client = this.client;
    const generation = this.generation;
    if (!client || this.state.pending) return;
    void client.subscribeSubagents().then(() => {
      if (this.generation === generation) { this.read.setActive(true); void this.read.demand(); }
    }).catch(() => { if (this.generation === generation) this.patch({ error: "恢复记录订阅失败，请刷新。" }); });
  }
  older(): void { if (this.state.page?.nextCursor) { this.depth += 1; void this.read.invalidate(); } }

  async resume(consumerId: string): Promise<void> {
    const client = this.client;
    const row = this.state.page?.entries.find((entry) => entry.consumerId === consumerId);
    if (!client || !this.state.fresh || this.state.pending || !row?.canResume) return;
    const generation = this.generation;
    const key = JSON.stringify([this.characterId, consumerId]);
    const operationKey = this.operations.get(key) ?? crypto.randomUUID();
    this.operations.set(key, operationKey);
    this.patch({ pending: consumerId, fresh: false, feedback: null });
    this.read.setActive(false);
    try {
      await client.subagentInboxResume({ characterId: this.characterId, consumerId, operationKey });
      if (this.generation === generation) this.patch({ feedback: "已接收主助手继续处理请求，请以当前恢复状态为准。" });
    } catch {
      if (this.generation === generation) this.patch({ feedback: "未能确认继续处理结果，可能被运行时拒绝或连接中断。请核对状态；再次点击会核对同一操作，不会新建重复请求。" });
    } finally {
      if (this.generation === generation) { this.patch({ pending: null }); this.read.setActive(true); void this.read.invalidate(); }
    }
  }

  private async load(client: InboxClient, characterId: string): Promise<InboxPage> {
    let result: InboxPage = { entries: [], nextCursor: null };
    let afterId: string | undefined;
    for (let page = 0; page < this.depth; page += 1) {
      const next = await client.subagentInboxRecovery({ characterId, afterId });
      result = { entries: [...result.entries, ...next.entries], nextCursor: next.nextCursor };
      if (!next.nextCursor) break;
      if (afterId === next.nextCursor) throw new Error("Recovery cursor did not advance");
      afterId = next.nextCursor;
    }
    return result;
  }
  private patch(update: Partial<InboxView>): void { this.state = { ...this.state, ...update }; this.publish(this.state); }
}
