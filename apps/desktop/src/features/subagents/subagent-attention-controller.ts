/**
 * INPUT: Home client generations, actual child change hints and document visibility
 * OUTPUT: bounded attention reads, deduplicated notices and explicit idempotent inbox recovery
 * POS: ui/subagents — window-wide status owner; no automatic resumption or mutation replay
 */
import type { SubagentAttentionResult } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator } from "@/lib/read-coordinator.js";
import { createReadObservation } from "@/lib/read-observation.js";

type AttentionClient = Pick<WsClient, "subagentAttention" | "subagentInboxResume" | "subagentInboxRetry" | "subscribeSubagents" | "onSubagentChanged">;
export interface AttentionView {
  page: SubagentAttentionResult | null; loading: boolean; fresh: boolean; error: string | null; older: boolean;
  pending: string | null; feedback: string | null;
}
export const EMPTY_ATTENTION_VIEW: AttentionView = { page: null, loading: false, fresh: false, error: null, older: false, pending: null, feedback: null };
export const ATTENTION_LABEL = {
  needs_user_input: "需要你的补充输入", reconciliation_needed: "主助手处理需要核对", check_in_user: "进度检查需要你决定",
  inbox_retry_exhausted: "主助手接入重试已结束",
};
const NOTICE_LIMIT = 200;

export class SubagentAttentionController {
  private state = EMPTY_ATTENTION_VIEW;
  private client: AttentionClient | null = null;
  private characterId = "";
  private visible = true;
  private afterId: string | undefined;
  private generation = 0;
  private readonly operations = new Map<string, string>();
  private readonly notices = new Map<string, object>();
  private readonly publish: (view: AttentionView) => void;
  private readonly notice: (message: string, identity: object) => void;
  private readonly read = createReadCoordinator<SubagentAttentionResult>({
    started: () => this.patch({ loading: true, fresh: false }),
    loaded: (page) => this.loaded(page),
    failed: () => this.patch({ loading: false, fresh: false, error: "待处理状态读取失败，已保留上次内容。请重试。" }),
    retired: () => this.patch({ loading: false, fresh: false }),
  });
  private readonly observation = createReadObservation({
    changed: () => this.syncRead(),
    failed: () => this.patch({ error: "待处理状态订阅失败，请重试。", fresh: false }),
    invalidated: () => {
      if (this.afterId !== undefined) { this.afterId = undefined; this.bindRead(); }
      this.patch({ fresh: false }); void this.read.invalidate();
    },
  });

  constructor(publish: (view: AttentionView) => void, notice: (message: string, identity: object) => void) {
    this.publish = publish; this.notice = notice;
  }

  bind(client: AttentionClient | null, characterId: string): void {
    if (this.client === client && this.characterId === characterId) return;
    this.generation += 1;
    this.client = client; this.characterId = characterId; this.afterId = undefined;
    if (this.state.pending) this.patch({ pending: null, feedback: "连接已中断，恢复操作结果尚未确认。不会自动重试。" });
    let revision = 0;
    this.observation.replace(client ? {
      subscribe: () => client.subscribeSubagents(),
      onChanged: (handler) => client.onSubagentChanged((change) => {
        if (change.characterId === characterId) handler(++revision);
      }),
    } : null);
    this.bindRead(); this.patch({ fresh: false });
    if (client && this.visible) void this.refresh();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible; this.syncRead();
    if (visible) { this.publish(this.state); void this.refresh(); }
  }

  async refresh(): Promise<void> {
    if (this.client && this.visible && !this.state.pending && await this.observation.prepare() && this.visible) await this.read.demand();
  }

  older(): void {
    if (!this.state.page?.nextCursor || !this.state.fresh || this.state.loading) return;
    this.afterId = this.state.page.nextCursor; this.bindRead(); void this.read.demand();
  }

  newest(): void { this.afterId = undefined; this.bindRead(); void this.refresh(); }

  async resume(attentionId: string): Promise<void> {
    const client = this.client;
    const entry = this.state.page?.entries.find((row) => row.attentionId === attentionId);
    if (!client || !this.visible || !this.state.fresh || this.state.pending || !entry?.canResume
      || entry.kind !== "inbox_retry_exhausted" && (entry.kind !== "reconciliation_needed" || !entry.consumerId)) return;
    const generation = this.generation;
    this.patch({ pending: attentionId, fresh: false, feedback: null }); this.syncRead();
    try {
      const feedback = await this.recover(client, entry);
      if (generation === this.generation) this.patch({ feedback });
    } catch {
      if (generation === this.generation) this.patch({ feedback: entry.kind === "inbox_retry_exhausted"
        ? "重试结果尚未确认。请核对最新状态；不会自动重试。仍显示重试已结束时，可再次明确尝试。"
        : "恢复结果尚未确认。请核对状态；再次明确点击会使用同一操作身份，不会自动重试。" });
    } finally {
      if (generation === this.generation) {
        this.patch({ pending: null }); this.syncRead(); void this.read.invalidate();
      }
    }
  }

  private async recover(client: AttentionClient, entry: SubagentAttentionResult["entries"][number]): Promise<string> {
    if (entry.kind === "inbox_retry_exhausted") {
      const result = await client.subagentInboxRetry({ characterId: this.characterId });
      return result.status === "scheduled" ? "已请求重新尝试接入主助手，请以实际处理状态为准。" : "当前没有需要重新尝试接入的消息，请核对最新状态。";
    }
    if (!entry.consumerId) throw new Error("Recovery target missing");
    const key = JSON.stringify([this.characterId, entry.consumerId]);
    const operationKey = this.operations.get(key) ?? crypto.randomUUID();
    this.operations.set(key, operationKey);
    await client.subagentInboxResume({ characterId: this.characterId, consumerId: entry.consumerId, operationKey });
    return "已接收主助手继续处理请求，已有记录会保留，请核对后续状态。";
  }

  private bindRead(): void {
    const client = this.client;
    const params = { characterId: this.characterId, afterId: this.afterId, limit: 20 };
    this.read.replace(client ? () => client.subagentAttention(params) : null);
  }

  private loaded(page: SubagentAttentionResult): void {
    this.patch({ page, loading: false, fresh: true, error: null, older: this.afterId !== undefined });
    // A canonical first page with no successor pages proves which recovery targets have resolved.
    if (this.afterId === undefined && !page.nextCursor) {
      const current = new Set(page.entries.map((entry) => JSON.stringify([this.characterId, entry.consumerId])));
      for (const key of this.operations.keys()) if (!current.has(key)) this.operations.delete(key);
    }
    for (const entry of page.entries) {
      const key = JSON.stringify([this.characterId, entry.attentionId]);
      if (this.notices.has(key)) continue;
      const identity = {};
      this.notices.set(key, identity);
      if (this.notices.size > NOTICE_LIMIT) {
        const oldest = this.notices.keys().next().value;
        if (oldest !== undefined) this.notices.delete(oldest);
      }
      this.notice(`${ATTENTION_LABEL[entry.kind]}。请查看 Home 左侧的子代理待处理入口。`, identity);
    }
  }

  private syncRead(): void { this.read.setActive(this.visible && !this.state.pending && this.observation.usable()); }

  private patch(update: Partial<AttentionView>): void {
    this.state = { ...this.state, ...update }; if (this.visible) this.publish(this.state);
  }
}
