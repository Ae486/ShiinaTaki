/**
 * INPUT: authenticated client generations, explicit Pattern commands and resource invalidations.
 * OUTPUT: last-good list/detail/history with serialized exact-revision actions and honest conflicts.
 * POS: disposable Desktop read owner; Core alone activates revisions, no mutation replay or polling.
 */
import type { InteractionPatternDefinition, InteractionPatternMutationResult, InteractionPatternView } from "@taki/shared";
import { createReadCoordinator } from "@/lib/read-coordinator.js";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { PATTERN_REFUSALS } from "./pattern-labels.ts";
import { INITIAL_PATTERN_STATE, type PatternClient, type PatternDetail, type PatternState } from "./pattern-state.ts";

export class PatternController {
  private state: PatternState = INITIAL_PATTERN_STATE;
  private client: PatternClient | null = null;
  private visible = true;
  private generation = 0;
  private pages = 1;
  private historyPages = 1;
  private stop: (() => void) | null = null;
  private mutation: object | null = null;
  private readonly reads = createReadCoordinator({
    started: () => this.patch({ loading: true }),
    loaded: (list: NonNullable<PatternState["list"]>) => {
      this.patch({ list, loading: false, fresh: true, readError: null });
    },
    failed: () => this.patch({ loading: false, fresh: false, readError: "读取互动规则失败，已保留上次内容。请重试。" }),
    retired: () => this.patch({ loading: false }),
  });
  private readonly details = createReadCoordinator({
    started: () => this.patch({ detailLoading: true }),
    loaded: (detail: PatternDetail) => this.patch({ detail, selectedId: this.state.requestedId, detailLoading: false, detailError: null }),
    failed: () => this.patch({ detailLoading: false, detailError: "读取规则详情或历史失败，已保留上次内容。请重试。" }),
    retired: () => this.patch({ detailLoading: false }),
  });

  private readonly publish: (state: PatternState) => void;
  constructor(publish: (state: PatternState) => void) { this.publish = publish; }

  bind(client: PatternClient | null): void {
    if (this.client === client) return;
    this.stop?.();
    this.generation += 1;
    this.client = client;
    if (this.mutation) this.patch({ feedback: { tone: "warn", message: "连接中断，刚才操作的结果尚未确认。恢复连接后请核对当前状态；不会自动重新提交。" } });
    this.mutation = null;
    this.patch({ pending: false, fresh: false });
    this.reads.replace(client ? () => this.readList(client) : null);
    this.bindDetail();
    this.stop = client?.onInitiativePatternsChanged((event) => {
      if (this.client === client && event.characterId === ACTIVE_CHARACTER_ID) this.invalidate();
    }) ?? null;
    if (client && this.visible) void this.refresh();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.reads.setActive(visible);
    this.details.setActive(visible);
    if (visible) { this.publish(this.state); void this.refresh(); }
    else this.patch({ fresh: false });
  }

  async refresh(): Promise<void> {
    await Promise.all([this.reads.demand(), this.details.demand()]);
  }

  invalidate(): void {
    this.patch({ fresh: false });
    void this.reads.invalidate();
    void this.details.invalidate();
  }

  loadMore(): void {
    if (!this.state.list?.nextAfter || this.state.loading) return;
    this.pages += 1;
    void this.reads.invalidate();
  }

  select(patternId: string): void {
    if (this.state.requestedId === patternId) return;
    this.historyPages = 1;
    this.patch({ requestedId: patternId, detailError: null });
    this.bindDetail();
    void this.details.demand();
  }

  loadMoreHistory(): void {
    if (!this.state.detail?.history.nextBefore || this.state.detailLoading) return;
    this.historyPages += 1;
    void this.details.invalidate();
  }

  propose(base: InteractionPatternView | null, definition: InteractionPatternDefinition): Promise<boolean> {
    return this.mutate((client) => client.initiativePatternPropose({
      characterId: ACTIVE_CHARACTER_ID, commandId: crypto.randomUUID(), patternId: base?.patternId ?? null,
      expectedVersion: base?.version ?? 0, definition,
    }), "提案已保存。请阅读完整内容后确认生效。");
  }

  confirm(reviewed: InteractionPatternView): Promise<boolean> {
    const candidate = reviewed.candidateRevision;
    if (!candidate) return Promise.resolve(false);
    return this.mutate((client) => client.initiativePatternConfirm({
      ...this.command(reviewed), candidateRevisionId: candidate.revisionId,
    }), (pattern) => pattern.state === "paused" ? "修改已确认，互动规则仍保持暂停。" : "已确认这份提案，互动规则已生效。");
  }

  changeState(row: InteractionPatternView, action: "pause" | "resume" | "retire"): Promise<boolean> {
    return this.mutate((client) => client.initiativePatternChangeState({ ...this.command(row), action }),
      action === "pause" ? "互动规则已暂停。" : action === "resume" ? "互动规则已恢复。" : "互动规则已停用，历史仍可查看。");
  }

  rollback(row: InteractionPatternView, revisionId: string): Promise<boolean> {
    return this.mutate((client) => client.initiativePatternRollback({ ...this.command(row), revisionId }),
      "已根据所选历史内容建立新提案，请阅读并确认。");
  }

  private command(row: InteractionPatternView) {
    return { characterId: ACTIVE_CHARACTER_ID, patternId: row.patternId, expectedVersion: row.version, commandId: crypto.randomUUID() };
  }

  private async mutate(run: (client: PatternClient) => Promise<InteractionPatternMutationResult>, success: string | ((pattern: InteractionPatternView) => string)): Promise<boolean> {
    const client = this.client;
    if (!client || this.mutation || !this.visible || !this.state.fresh) return false;
    const token = {};
    this.mutation = token;
    const generation = this.generation;
    this.patch({ pending: true, feedback: null });
    try {
      const result = await run(client);
      if (this.client !== client || this.generation !== generation || this.mutation !== token) return false;
      const pattern = result.status === "refused" ? result.current : result.pattern;
      if (pattern) this.acceptPattern(pattern);
      this.patch({ feedback: result.status === "refused"
        ? { tone: "warn", message: PATTERN_REFUSALS[result.reason] }
        : { tone: "ok", message: result.status === "duplicate" ? "这次操作已处理，请核对当前状态。"
          : typeof success === "string" ? success : success(result.pattern) } });
      this.invalidate();
      return result.status !== "refused";
    } catch {
      if (this.client === client && this.generation === generation) {
        this.patch({ feedback: { tone: "danger", message: "未能确认操作结果。请刷新核对当前状态后再操作；草稿已保留，不会自动重新提交。" } });
        this.invalidate();
      }
      return false;
    } finally {
      if (this.mutation === token) { this.mutation = null; this.patch({ pending: false }); }
    }
  }

  private acceptPattern(pattern: InteractionPatternView): void {
    this.reads.acceptUpdate();
    this.details.acceptUpdate();
    const rows = this.state.list?.patterns ?? [];
    const patterns = rows.some((row) => row.patternId === pattern.patternId)
      ? rows.map((row) => row.patternId === pattern.patternId ? pattern : row) : [...rows, pattern];
    const detail = this.state.selectedId === pattern.patternId && this.state.detail
      ? { ...this.state.detail, pattern } : this.state.detail;
    this.patch({ list: { patterns, nextAfter: this.state.list?.nextAfter ?? null }, detail });
    if (!this.state.requestedId) this.select(pattern.patternId);
  }

  private bindDetail(): void {
    const client = this.client;
    const patternId = this.state.requestedId;
    this.details.replace(client && patternId ? async () => {
      const params = { characterId: ACTIVE_CHARACTER_ID, patternId };
      const [{ pattern }, history] = await Promise.all([client.initiativePatternRead(params), this.readHistory(client, patternId)]);
      return { pattern, history };
    } : null);
  }

  private async readList(client: PatternClient): Promise<NonNullable<PatternState["list"]>> {
    const patterns: InteractionPatternView[] = [];
    let after: string | null = null;
    for (let page = 0; page < this.pages; page += 1) {
      const result = await client.initiativePatternsList({ characterId: ACTIVE_CHARACTER_ID, after, limit: 100 });
      patterns.push(...result.patterns);
      after = result.nextAfter;
      if (after === null || this.client !== client || !this.visible) break;
    }
    return { patterns, nextAfter: after };
  }

  private async readHistory(client: PatternClient, patternId: string): Promise<PatternDetail["history"]> {
    const revisions: PatternDetail["history"]["revisions"] = [];
    let before: number | null = null;
    for (let page = 0; page < this.historyPages; page += 1) {
      const result = await client.initiativePatternHistory({ characterId: ACTIVE_CHARACTER_ID, patternId, before, limit: 100 });
      revisions.push(...result.revisions);
      before = result.nextBefore;
      if (before === null || this.client !== client || !this.visible) break;
    }
    return { revisions, nextBefore: before };
  }

  private patch(patch: Partial<PatternState>): void {
    this.state = { ...this.state, ...patch };
    if (this.visible) this.publish(this.state);
  }
}
