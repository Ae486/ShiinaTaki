/**
 * INPUT:  replaceable authenticated clients, visibility and explicit operator intent
 * OUTPUT: disposable onboarding snapshots, subscribed reads and serialized durable actions
 * POS:    ui/windows/home/pages/operations — Core owns all work; hidden/retired replies never publish or replay
 */
import type { MemoryOnboardingStatus } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { onboardingActionAllowed, onboardingRequest, type OnboardingAction } from "./local-onboarding-actions.ts";
import { initialOnboardingState, onboardingError, onboardingRefusal, type LocalOnboardingState, type OnboardingFeedback } from "./local-onboarding-state.ts";

export type LocalOnboardingClient = Pick<WsClient, "memoryOnboardingStatus" | "memoryOnboardingPreview" |
  "memoryOnboardingExceptions" | "memoryOnboardingExclude" | "subscribeMemoryOnboarding" |
  "onMemoryOnboardingChanged" | "memoryOperationSubmit" | "memoryOperationCancel" |
  "subscribeMemoryOperations" | "onMemoryOperationChanged">;

export class LocalOnboardingController {
  private client: LocalOnboardingClient | null = null;
  private generation = 0;
  private version = 0;
  private visible = false;
  private dirty = true;
  private loading: Promise<void> | null = null;
  private subscription: Promise<void> | null = null;
  private listeners: (() => void)[] = [];
  private state = initialOnboardingState();
  private readonly sink: (state: LocalOnboardingState) => void;

  constructor(sink: (state: LocalOnboardingState) => void) { this.sink = sink; }
  snapshot(): LocalOnboardingState { return this.state; }
  matches(client: LocalOnboardingClient): boolean { return this.client === client; }

  replace(client: LocalOnboardingClient | null): void {
    this.generation += 1;
    this.version += 1;
    for (const off of this.listeners) off();
    this.listeners = [];
    this.loading = null;
    this.subscription = null;
    this.client = client;
    this.dirty = true;
    this.update({ stale: true, loading: !this.state.status, refreshing: false,
      preview: null, exceptions: null, busyKey: null, error: null, exceptionsError: null, feedback: null });
    if (!client) return;
    const generation = this.generation;
    this.listeners = [
      client.onMemoryOnboardingChanged((changed) => {
        if (this.current(client, generation)) this.invalidate(changed.reason === "candidate" || changed.reason === "binding");
      }),
      client.onMemoryOperationChanged((operation) => {
        if (this.current(client, generation) && operation.kind.startsWith("local.onboard.")) this.invalidate();
      }),
    ];
    void this.refresh();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.version += 1;
    this.dirty = true;
    this.update({ stale: true });
    if (visible) void this.refresh();
  }

  dispose(): void { this.visible = false; this.replace(null); }

  refresh(): Promise<void> {
    if (!this.client || !this.visible) return Promise.resolve();
    this.dirty = true;
    if (this.loading) return this.loading;
    const client = this.client;
    const generation = this.generation;
    this.loading = this.readLoop(client, generation).finally(() => {
      if (this.current(client, generation)) this.loading = null;
    });
    return this.loading;
  }

  async execute(action: OnboardingAction): Promise<void> {
    const status = this.state.status;
    if (!status || !this.usable() || !onboardingActionAllowed(status, action)) return;
    if (action === "preview") { await this.preview(); return; }
    if (action === "cancel" && status.actions.cancelOperationId) {
      const operationId = status.actions.cancelOperationId;
      await this.mutate(action, async (client) => {
        const operation = await client.memoryOperationCancel(operationId);
        return { tone: "ok", message: operation.state === "cancelled" ? "待开始操作已取消。" : "已收到 Core 结果，正在刷新状态。" };
      });
      return;
    }
    const request = onboardingRequest({ action, status, preview: this.state.preview });
    if (!request) return;
    await this.mutate(action, async (client) => {
      await client.memoryOperationSubmit(request);
      return { tone: "ok", message: "Core 已受理操作；是否完成以最新状态为准。" };
    });
  }

  async exclude(sourceId: string, reason: string): Promise<void> {
    const runId = this.state.status?.run?.runId;
    const source = this.state.exceptions?.items.find((item) => item.sourceId === sourceId);
    const trimmed = reason.trim();
    if (!runId || !source?.canExclude || this.state.exceptionsError || !this.usable() || !trimmed || trimmed.length > 512) return;
    await this.mutate(`exclude:${sourceId}`, async (client) => {
      await client.memoryOnboardingExclude({ runId, sourceId, reason: trimmed });
      return { tone: "ok", message: "已记录该来源的排除理由。请根据最新状态继续准备并校验。" };
    });
  }

  async loadMore(): Promise<void> {
    const client = this.client;
    const runId = this.state.status?.run?.runId;
    const cursor = this.state.exceptions?.nextCursor;
    if (!client || !runId || !cursor || !this.usable() || this.state.exceptionsError) return;
    const generation = this.generation;
    const version = this.version;
    this.update({ busyKey: "exceptions" });
    try {
      const page = await client.memoryOnboardingExceptions({ runId, cursor, limit: 100 });
      if (!this.readCurrent(client, generation, version)) return;
      const items = new Map(this.state.exceptions?.items.map((item) => [item.sourceId, item]));
      for (const item of page.items) items.set(item.sourceId, item);
      this.update({ exceptions: { items: [...items.values()], nextCursor: page.nextCursor } });
    } catch (cause) {
      if (this.readCurrent(client, generation, version)) this.update({ exceptionsError: onboardingError(cause) });
    } finally {
      if (this.current(client, generation)) this.update({ busyKey: null });
    }
  }

  private update(patch: Partial<LocalOnboardingState>): void {
    this.state = { ...this.state, ...patch };
    if (this.visible) this.sink(this.state);
  }

  private current(client: LocalOnboardingClient, generation: number): boolean {
    return this.client === client && this.generation === generation;
  }

  private readCurrent(client: LocalOnboardingClient, generation: number, version: number): boolean {
    return this.current(client, generation) && this.visible && this.version === version;
  }

  private usable(): boolean {
    return this.client !== null && this.visible && !this.state.stale && !this.state.refreshing && this.state.busyKey === null;
  }

  private invalidate(clearPreview = false): void {
    this.version += 1;
    this.dirty = true;
    this.update({ stale: true, ...(clearPreview ? { preview: null } : {}) });
    void this.refresh();
  }

  private subscribe(client: LocalOnboardingClient): Promise<void> {
    this.subscription ??= Promise.all([client.subscribeMemoryOnboarding(), client.subscribeMemoryOperations()]).then(() => undefined);
    return this.subscription;
  }

  private async readLoop(client: LocalOnboardingClient, generation: number): Promise<void> {
    while (this.current(client, generation) && this.visible && this.dirty) {
      this.dirty = false;
      const version = this.version;
      this.update({ loading: !this.state.status, refreshing: this.state.status !== null, stale: true });
      try {
        // Both handlers are installed before subscriptions; discovery starts only after both channels are ready.
        await this.subscribe(client);
        if (!this.readCurrent(client, generation, version)) continue;
        const status = await client.memoryOnboardingStatus();
        if (!this.readCurrent(client, generation, version)) continue;
        await this.readExceptions({ client, generation, version }, status);
      } catch (cause) {
        if (this.readCurrent(client, generation, version)) {
          this.subscription = null;
          this.update({ error: onboardingError(cause), loading: false, refreshing: false, stale: true });
        }
      }
    }
  }

  private async readExceptions(ticket: { client: LocalOnboardingClient; generation: number; version: number }, status: MemoryOnboardingStatus): Promise<void> {
    let exceptions: LocalOnboardingState["exceptions"] = null;
    let exceptionsError: string | null = null;
    try {
      if (status.run) exceptions = await ticket.client.memoryOnboardingExceptions({ runId: status.run.runId, limit: 100 });
    } catch (cause) { exceptionsError = onboardingError(cause); }
    if (!this.readCurrent(ticket.client, ticket.generation, ticket.version)) return;
    const preview = this.state.status?.run?.runId === status.run?.runId ? this.state.preview : null;
    this.update({ status, preview, exceptions, exceptionsError, error: null, stale: false, loading: false, refreshing: false });
  }

  private async preview(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const generation = this.generation;
    const version = this.version;
    this.update({ busyKey: "preview", preview: null, feedback: null });
    try {
      const preview = await client.memoryOnboardingPreview();
      if (this.readCurrent(client, generation, version)) this.update({ preview });
    } catch (cause) {
      if (this.readCurrent(client, generation, version)) this.update({ feedback: onboardingRefusal(cause) });
    } finally {
      if (this.current(client, generation)) this.update({ busyKey: null });
    }
  }

  private async mutate(key: string, work: (client: LocalOnboardingClient) => Promise<OnboardingFeedback>): Promise<void> {
    const client = this.client;
    if (!client || !this.usable()) return;
    const generation = this.generation;
    this.update({ busyKey: key, preview: null, feedback: null });
    try {
      const feedback = await work(client);
      if (this.current(client, generation)) this.update({ feedback });
    } catch (cause) {
      if (this.current(client, generation)) this.update({ feedback: onboardingRefusal(cause) });
    } finally {
      if (this.current(client, generation)) {
        this.update({ busyKey: null, stale: true });
        this.version += 1;
        // Discover both accepted and lost replies; a new generation never replays this intent.
        await this.refresh();
      }
    }
  }
}
