/**
 * INPUT:  current Home client, explicit durable Approval list demand and exact revoke intent.
 * OUTPUT: bounded current-generation reads, retained display state and a visibility-independent revoke lock.
 * POS:    Home Settings — disposable decision management; Core remains authoritative and writes never replay.
 */
import type { ApprovalListResult } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator, type ReadCoordinator } from "@/lib/read-coordinator.js";

export type ApprovalDecisionsState =
  | { kind: "idle" | "loading"; data: ApprovalListResult | null; message: string | null }
  | { kind: "ready"; data: ApprovalListResult; message: string | null; revokingId: string | null }
  | { kind: "error"; data: ApprovalListResult | null; message: string };

export interface ApprovalDecisionsController {
  replace(client: ApprovalDecisionsClient | null): void;
  setVisible(visible: boolean): void;
  refresh(): Promise<void>;
  revoke(decisionId: string): Promise<void>;
  dispose(): void;
}
type ApprovalDecisionsClient = Pick<WsClient, "approvalList" | "approvalRevoke">;

export function createApprovalDecisionsController(publish: (state: ApprovalDecisionsState) => void): ApprovalDecisionsController {
  return new ApprovalDecisions(publish);
}

class ApprovalDecisions implements ApprovalDecisionsController {
  private client: ApprovalDecisionsClient | null = null;
  private generation = 0;
  private lastGood: ApprovalListResult | null = null;
  private message: string | null = null;
  private visible = true;
  private fresh = false;
  private revoking = false;
  private restoreAfterRevoke = false;
  private readonly publish: (state: ApprovalDecisionsState) => void;
  private readonly reads: ReadCoordinator<ApprovalListResult>;

  constructor(publish: (state: ApprovalDecisionsState) => void) {
    this.publish = publish;
    this.reads = createReadCoordinator<ApprovalListResult>({
      started: () => publish({ kind: "loading", data: this.lastGood, message: this.message }),
      loaded: (data) => { this.lastGood = data; this.fresh = true; publish({ kind: "ready", data, message: this.message, revokingId: null }); },
      failed: () => { this.fresh = false; publish({ kind: "error", data: this.lastGood, message: "审批请求失败，请检查连接后重试。" }); },
      retired: () => publish({ kind: "idle", data: this.lastGood, message: this.message }),
    });
  }

  replace(client: ApprovalDecisionsClient | null): void {
    if (this.client === client) return;
    this.generation += 1;
    this.client = client;
    this.fresh = false;
    this.revoking = false;
    this.restoreAfterRevoke = false;
    this.message = null;
    this.reads.replace(client ? () => client.approvalList() : null);
    this.reads.setActive(this.visible);
    if (client) void this.reads.demand();
    else this.publish({ kind: "idle", data: this.lastGood, message: null });
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.fresh = false;
    this.reads.setActive(visible && !this.revoking);
    if (visible && !this.revoking) void this.reads.demand();
    else if (visible) this.restoreAfterRevoke = true;
  }

  refresh(): Promise<void> { return this.reads.demand(); }

  async revoke(decisionId: string): Promise<void> {
    const client = this.client;
    const data = this.lastGood;
    if (!client || !data || !this.fresh || this.revoking) return;
    const generation = this.generation;
    this.revoking = true;
    this.reads.setActive(false);
    this.publish({ kind: "ready", data, message: null, revokingId: decisionId });
    try {
      const result = await client.approvalRevoke({ decisionId, expectedApprovalGeneration: data.approvalGeneration });
      if (!this.current(client, generation)) return;
      this.message = result.status === "stale_generation" ? "审批状态已变化，请核对当前列表后重试。" : null;
      this.reads.acceptUpdate();
      this.reads.setActive(this.visible);
      if (this.visible) this.restoreAfterRevoke = false;
      if (this.visible) await this.reads.demand();
      else this.publish({ kind: "idle", data: this.lastGood, message: this.message });
    } catch {
      if (this.current(client, generation)) this.publish({ kind: "error", data: this.lastGood, message: "审批请求失败，请检查连接后重试。" });
    } finally {
      if (this.current(client, generation)) {
        this.revoking = false;
        this.reads.setActive(this.visible);
        if (this.visible && this.restoreAfterRevoke) {
          this.restoreAfterRevoke = false;
          await this.reads.demand();
        }
      }
    }
  }

  dispose(): void { this.replace(null); }
  private current(client: ApprovalDecisionsClient, generation: number): boolean { return this.client === client && this.generation === generation; }
}
