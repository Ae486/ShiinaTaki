/**
 * INPUT: explicit tidy requests, the current Home client and affected read-model invalidation.
 * OUTPUT: serialized attempts with separate success, safe failure details and refresh diagnostics.
 * POS: Operations mutation owner; client replacement retires results without replaying or unlocking work.
 */
import { MemoryTidyFailureDetailsSchema, type MemoryTidyFailureDetails, type MemoryTidyResult } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { RpcDeadlineExceededError } from "@/lib/rpc-deadline.js";
import type { WsClient } from "@/lib/ws-client.js";

type TidyClient = Pick<WsClient, "memoryTidy">;
export interface MemoryTidyState {
  tidy: MemoryTidyResult | null;
  tidyFailure: MemoryTidyFailureDetails | null;
  tidying: boolean;
  error: string | null;
  refreshError: string | null;
}
interface TidySink {
  changed(state: MemoryTidyState): void;
  settled(): Promise<void>;
}

export function createMemoryTidyController(sink: TidySink) { return new MemoryTidyController(sink); }

class MemoryTidyController {
  private state: MemoryTidyState = { tidy: null, tidyFailure: null, tidying: false, error: null, refreshError: null };
  private client: TidyClient | null = null;
  private epoch = 0;
  private disposed = false;
  private readonly sink: TidySink;
  constructor(sink: TidySink) { this.sink = sink; }

  replace(client: TidyClient | null): void {
    this.disposed = false;
    if (client === this.client) return;
    this.client = client;
    this.epoch += 1;
    if (this.state.tidying && !this.state.tidy && !this.state.tidyFailure) {
      this.set({ ...this.state, error: "连接已变化，整理结果尚未确认；请刷新状态核对。" });
    }
  }

  dispose(): void { this.disposed = true; this.client = null; this.epoch += 1; }

  runTidy = async (): Promise<void> => {
    const client = this.client;
    if (!client || this.state.tidying) return;
    const epoch = this.epoch;
    this.set({ tidy: null, tidyFailure: null, tidying: true, error: null, refreshError: null });
    try {
      const result = await client.memoryTidy(ACTIVE_CHARACTER_ID);
      if (!this.current(client, epoch)) return;
      this.set({ ...this.state, tidy: result });
    } catch (cause) {
      if (!this.current(client, epoch)) return;
      const failure = tidyFailureDetails(cause);
      this.set({ ...this.state, tidyFailure: failure, error: failure ? null : tidyRequestError(cause) });
    } finally {
      // Refresh is a separate observation: its failure must not change a known mutation outcome.
      if (this.current(client, epoch) && (this.state.tidy || this.state.tidyFailure)) await this.refresh(client, epoch);
      this.set({ ...this.state, tidying: false });
    }
  };

  private async refresh(client: TidyClient, epoch: number): Promise<void> {
    try {
      await this.sink.settled();
    } catch {
      if (this.current(client, epoch)) this.set({ ...this.state, refreshError: "状态刷新失败；本次整理结果已保留，请使用下方“刷新状态”重新读取。" });
    }
  }

  private current(client: TidyClient, epoch: number): boolean {
    return !this.disposed && this.client === client && this.epoch === epoch;
  }
  private set(state: MemoryTidyState): void { this.state = state; if (!this.disposed) this.sink.changed(state); }
}

function tidyFailureDetails(cause: unknown): MemoryTidyFailureDetails | null {
  if (typeof cause !== "object" || cause === null || !("data" in cause)) return null;
  const parsed = MemoryTidyFailureDetailsSchema.safeParse(cause.data);
  return parsed.success ? parsed.data : null;
}

function tidyRequestError(cause: unknown): string {
  if (cause instanceof RpcDeadlineExceededError) return "等待整理结果超时，执行结果尚未确认；请刷新状态核对后再决定是否重新整理。";
  return cause instanceof Error ? cause.message : String(cause);
}
