/**
 * INPUT:  the installed engine's expression manager and a monotonic clock.
 * OUTPUT: scene-local Set/Reset lifecycle, successful application state, and explicit restoration of repeated Set.
 * POS:    experimental / lab — not in production path; structural engine contract, node-testable without the engine.
 */

export const EXPRESSION_SETTLE_MS = 1200;

export interface ExpressionTarget {
  expressions: unknown[];
  currentExpression: unknown;
  reserveExpressionIndex: number;
  destroyed: boolean;
  getExpressionIndex(name: string): number;
  setExpression(name: string): Promise<boolean>;
  resetExpression(): void;
  restoreExpression(): void;
}

export type ExpressionState =
  | { kind: "none" | "disposed" }
  | { kind: "pending"; name: string }
  | { kind: "applied"; name: string; settleAt: number }
  | { kind: "failed"; name: string; reason: string };

export type ExpressionApplyResult = "applied" | "restored" | "failed" | "superseded";

export interface ExpressionControl {
  set(name: string): Promise<ExpressionApplyResult>;
  reset(): void;
  state(): ExpressionState;
  dispose(): void;
}

export function createExpressionControl(target: ExpressionTarget, now = () => performance.now()): ExpressionControl {
  return new LabExpressionControl(target, now);
}

class LabExpressionControl implements ExpressionControl {
  private revision = 0;
  private current: ExpressionState = { kind: "none" };
  private tail: Promise<unknown> = Promise.resolve();

  private readonly target: ExpressionTarget;
  private readonly now: () => number;

  constructor(target: ExpressionTarget, now: () => number) {
    this.target = target;
    this.now = now;
  }

  state(): ExpressionState {
    return this.current;
  }

  set(name: string): Promise<ExpressionApplyResult> {
    if (this.current.kind === "disposed" || this.target.destroyed) return Promise.resolve("superseded");
    const revision = this.cancelPending();
    this.current = { kind: "pending", name };
    // Engine reservations use only the expression index. Serialize to prevent an older load of the same index from
    // consuming the newest request's reservation after Reset or a repeated Set (an index-only ABA race).
    const next = this.tail.then(() => this.apply(name, revision));
    this.tail = next;
    return next;
  }

  reset(): void {
    if (this.current.kind === "disposed" || this.target.destroyed) return;
    this.cancelPending();
    this.current = { kind: "none" };
    this.target.resetExpression();
  }

  dispose(): void {
    if (this.current.kind === "disposed") return;
    this.cancelPending();
    this.current = { kind: "disposed" };
  }

  private cancelPending(): number {
    this.revision += 1;
    // resetExpression() does not cancel a pending load. This public reservation is checked by the engine immediately
    // before queueing, so clearing it prevents delayed engine work from undoing Reset or touching a disposed model.
    this.target.reserveExpressionIndex = -1;
    return this.revision;
  }

  private isCurrent(revision: number): boolean {
    return revision === this.revision && this.current.kind !== "disposed" && !this.target.destroyed;
  }

  private async apply(name: string, revision: number): Promise<ExpressionApplyResult> {
    if (!this.isCurrent(revision)) return "superseded";
    try {
      const index = this.target.getExpressionIndex(name);
      const repeated = index >= 0 && this.target.expressions[index] === this.target.currentExpression;
      // Engine Reset preserves currentExpression; setExpression rejects that same index even though it is no longer
      // displayed. restoreExpression() is the public operation that actually queues it again.
      if (repeated) this.target.restoreExpression();
      const applied = repeated || await this.target.setExpression(name);
      if (!this.isCurrent(revision)) return "superseded";
      if (!applied) return this.fail(name, "engine rejected request");
      this.current = { kind: "applied", name, settleAt: this.now() + EXPRESSION_SETTLE_MS };
      return repeated ? "restored" : "applied";
    } catch (error) {
      if (!this.isCurrent(revision)) return "superseded";
      return this.fail(name, error instanceof Error ? error.message : String(error));
    }
  }

  private fail(name: string, reason: string): ExpressionApplyResult {
    this.target.reserveExpressionIndex = -1;
    this.current = { kind: "failed", name, reason };
    return "failed";
  }
}
