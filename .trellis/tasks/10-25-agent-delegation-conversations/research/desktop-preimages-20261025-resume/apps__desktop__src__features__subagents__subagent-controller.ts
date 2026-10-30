/**
 * INPUT: authenticated client generations, acknowledged invalidations and explicit displayed-target actions
 * OUTPUT: coherent retained child/work views, serialized controls and honest recovery diagnostics
 * POS: ui/subagents — disposable read owner; Core alone schedules, stops and resumes work
 */
import type { SubagentControlResult, SubagentTarget } from "@taki/shared";
import type { SubagentHistory } from "@/lib/ws-client-subagents.js";
import { createReadCoordinator } from "@/lib/read-coordinator.js";
import { createReadObservation } from "@/lib/read-observation.js";
import { INITIAL_SUBAGENT_STATE, displayedTarget, sameTarget, type SubagentClient, type SubagentState } from "./subagent-state.ts";
import { readSubagentHistory, readSubagentList } from "./subagent-reads.ts";
import { commandFailure, privateViewUnavailable } from "./subagent-labels.ts";

export class SubagentController {
  private state: SubagentState = INITIAL_SUBAGENT_STATE;
  private client: SubagentClient | null = null;
  private visible = true;
  private generation = 0;
  private pages = 1;
  private historyPages = 1;
  private requestedWork: string | null = null;
  private mutation: object | null = null;
  private readonly publish: (state: SubagentState) => void;
  private readonly reads = createReadCoordinator({
    started: () => this.patch({ loading: true }),
    loaded: (list: NonNullable<SubagentState["list"]>) => this.patch({ list, loading: false, readError: null }),
    failed: () => this.patch({ loading: false, readError: "读取子代理列表失败，请重试。已保留上次内容。" }),
    retired: () => this.patch({ loading: false }),
  });
  private readonly details = createReadCoordinator({
    started: () => this.patch({ detailLoading: true, fresh: false }),
    loaded: (detail: SubagentHistory) => this.commitDetail(detail),
    failed: (cause) => this.failDetail(cause),
    retired: () => this.patch({ detailLoading: false }),
  });
  private readonly observation = createReadObservation({
    changed: (observation) => { this.patch({ observation }); this.syncReads(); },
    failed: () => this.patch({ readError: "订阅子代理状态失败，请重试。", fresh: false }),
    invalidated: () => this.invalidate(),
  });

  constructor(publish: (state: SubagentState) => void) { this.publish = publish; }

  bind(client: SubagentClient | null): void {
    if (this.client === client) return;
    this.generation += 1;
    this.client = client;
    if (this.mutation) this.patch({ feedback: { tone: "warn",
      message: "连接中断，刚才操作的结果尚未确认。恢复后请核对当前状态；不会自动重新提交。" } });
    this.mutation = null;
    this.patch({ pending: null, fresh: false });
    this.observation.replace(client ? {
      subscribe: () => client.subscribeSubagents(),
      onChanged: (handler) => client.onSubagentChanged((change) => {
        if (change.characterId === this.state.characterId) handler(change.revision);
      }),
    } : null);
    this.bindReads();
    if (client && this.visible) void this.refresh();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.syncReads();
    if (visible) { this.publish(this.state); void this.refresh(); }
    else this.patch({ fresh: false });
  }

  async refresh(): Promise<void> {
    if (!this.client || !this.visible || this.mutation || !await this.observation.prepare()) return;
    if (!this.visible || this.mutation) return;
    await Promise.all([this.reads.demand(), this.details.demand()]);
  }

  select(subagentId: string, workInputId?: string): void {
    if (subagentId === this.state.requestedId && !workInputId) return;
    this.requestedWork = workInputId ?? null;
    this.historyPages = 1;
    this.patch({ requestedId: subagentId, fresh: false, detailError: null });
    this.bindDetail();
    void this.details.demand();
  }

  selectWork(workInputId: string): void {
    if (!this.state.detail?.inputs.some((row) => row.kind === "work" && row.inputId === workInputId)) return;
    this.patch({ workInputId });
  }

  navigate(target: { characterId: string; subagentId: string; workInputId?: string }): void {
    if (target.characterId !== this.state.characterId) {
      this.patch({ ...INITIAL_SUBAGENT_STATE, characterId: target.characterId });
      this.pages = 1;
      this.bindReads();
    }
    this.select(target.subagentId, target.workInputId);
    void this.refresh();
  }

  loadMore(): void { if (this.state.list?.nextCursor) { this.pages += 1; void this.reads.invalidate(); } }
  loadMoreHistory(): void {
    const detail = this.state.detail;
    if (!detail || this.state.detailLoading || !(detail.nextMessageSeq || detail.nextInputSeq || detail.nextCompletionId)) return;
    this.historyPages += 1;
    void this.details.invalidate();
  }

  async act(target: SubagentTarget, action: "send" | "stop" | "continue", direction = ""): Promise<boolean> {
    const client = this.client;
    if (!client || this.mutation || !this.visible || !this.state.fresh || this.state.requestedId !== this.state.selectedId
      || !sameTarget(displayedTarget(this.state), target)) return false;
    if (action === "send" && !direction.trim()) return false;
    const token = {};
    const generation = this.generation;
    this.mutation = token;
    this.patch({ pending: action, feedback: null, fresh: false });
    this.syncReads();
    try {
      const base = { characterId: this.state.characterId, target };
      const addressed = { ...base, operationKey: crypto.randomUUID(), direction, materials: [] };
      const result = await (action === "stop" ? client.subagentStop(base)
        : action === "continue" ? client.subagentContinue(addressed) : client.subagentSend(addressed));
      if (this.generation !== generation || this.mutation !== token) return false;
      this.acceptControl(result, action);
      return true;
    } catch (cause) {
      if (this.generation === generation) this.patch({ feedback: { tone: "warn", message: commandFailure(cause) } });
      return false;
    } finally {
      if (this.mutation === token) {
        this.mutation = null;
        this.patch({ pending: null });
        this.syncReads();
        this.invalidate();
      }
    }
  }

  private acceptControl(result: SubagentControlResult, action: "send" | "stop" | "continue"): void {
    this.reads.acceptUpdate();
    this.details.acceptUpdate();
    const current = this.state.detail;
    if (current?.conversation.subagentId === result.conversation.subagentId) {
      this.patch({ detail: { ...current, conversation: result.conversation,
        inputs: result.input && !current.inputs.some((row) => row.inputId === result.input?.inputId)
          ? [...current.inputs, result.input] : current.inputs } });
    }
    this.patch({ feedback: { tone: "ok", message: action === "stop"
      ? result.cancellationRequested ? "已请求停止此子代理，正在等待执行结束。" : "已停止此子代理，需由你明确继续。"
      : action === "continue" ? "继续请求已接收，执行状态以当前工作为准。"
        : result.input?.consumed ? "输入已纳入模型请求意图。" : "输入已接收，等待纳入后续模型请求。" } });
  }

  private commitDetail(detail: SubagentHistory): void {
    const sameChild = this.state.selectedId === detail.conversation.subagentId;
    const workInputId = this.requestedWork ?? (sameChild ? this.state.workInputId : null)
      ?? detail.conversation.activeWorkInputId ?? detail.conversation.latestWorkInputId;
    this.requestedWork = null;
    this.patch({ detail, selectedId: detail.conversation.subagentId, workInputId,
      detailLoading: false, detailError: null, fresh: true });
  }

  private failDetail(cause: unknown): void {
    const unavailable = privateViewUnavailable(cause);
    const remove = unavailable && this.state.requestedId === this.state.selectedId;
    this.patch({ detailLoading: false, fresh: false, ...(remove ? { detail: null, selectedId: null, workInputId: null } : {}),
      detailError: unavailable ? "所选私有会话不存在或当前不可访问。" : "读取私有会话失败，请重试。上次内容仅供查看。" });
  }

  private invalidate(): void {
    this.patch({ fresh: false });
    void this.reads.invalidate();
    void this.details.invalidate();
  }

  private bindReads(): void {
    const client = this.client;
    this.reads.replace(client ? () => readSubagentList(this.scope(client, this.pages)) : null);
    this.bindDetail();
  }

  private bindDetail(): void {
    const client = this.client;
    const child = this.state.requestedId;
    this.details.replace(client && child ? () => readSubagentHistory(this.scope(client, this.historyPages), child) : null);
  }

  private scope(client: SubagentClient, pages: number) {
    const generation = this.generation;
    return { client, pages, characterId: this.state.characterId,
      current: () => this.client === client && this.generation === generation && this.visible };
  }

  private syncReads(): void {
    const active = this.visible && !this.mutation && this.observation.usable();
    this.reads.setActive(active);
    this.details.setActive(active);
  }

  private patch(patch: Partial<SubagentState>): void {
    this.state = { ...this.state, ...patch };
    if (this.visible) this.publish(this.state);
  }
}
