/**
 * INPUT:  LabScene lifecycle, expression selection commands and findings/note sinks.
 * OUTPUT: expression Set/Reset/Sample actions with cancellable settling and successfully applied expression identity.
 * POS:    experimental / lab — not in production path; per-model control and timer ownership for the expression panel.
 */

import { createExpressionControl, EXPRESSION_SETTLE_MS, type ExpressionControl } from "../scene/expression-control.ts";
import { describeExpressionProbe, pickExpressionProbe } from "../scene/expression-probe.ts";
import type { LabScene, ModelContext } from "../scene/lab-scene.ts";
import type { LogLine } from "./controls.ts";

export interface ExpressionActions {
  set(name: string): Promise<void>;
  reset(): void;
  sample(): void;
}

export function createExpressionActions(scene: LabScene, log: LogLine, note: (value: string) => void): ExpressionActions {
  return new LabExpressionActions(scene, log, note);
}

class LabExpressionActions implements ExpressionActions {
  private control: ExpressionControl | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;

  private readonly scene: LabScene;
  private readonly log: LogLine;
  private readonly note: (value: string) => void;

  constructor(scene: LabScene, log: LogLine, note: (value: string) => void) {
    this.scene = scene;
    this.log = log;
    this.note = note;
    scene.onBeforeDispose(() => {
      this.revision += 1;
      this.cancelTimer();
      this.control?.dispose();
      this.control = null;
      this.note("");
    });
    scene.onModel((ctx) => {
      const manager = ctx.internal.motionManager.expressionManager;
      this.control = manager === undefined ? null : createExpressionControl(manager);
      this.note("probe: no successfully applied expression");
    });
  }

  async set(name: string): Promise<void> {
    const ctx = this.scene.current;
    const control = this.control;
    if (ctx === null || control === null || name === "") return;
    const revision = ++this.revision;
    this.cancelTimer();
    this.note(`probe: pending (${name})`);
    const result = await control.set(name);
    if (this.scene.current !== ctx || this.control !== control || revision !== this.revision || result === "superseded") return;
    const applied = result === "applied" || result === "restored";
    this.log(`expression(${name}) -> ${applied} (${result})`);
    if (!applied) {
      this.note("probe: unavailable (expression request failed)");
      return;
    }
    const probe = pickExpressionProbe(ctx.facts.faceParams[name] ?? []);
    this.note(probe === null ? "probe: no suitable nonzero parameter" : `single parameter: ${probe.id}, ${probe.calc} target ${probe.value}; settling`);
    if (probe === null) return;
    ctx.sampler.track([...ctx.sampler.ids(), probe.id]);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sample();
    }, EXPRESSION_SETTLE_MS);
  }

  reset(): void {
    this.revision += 1;
    this.cancelTimer();
    this.control?.reset();
    this.note("probe: no successfully applied expression");
    this.log("resetExpression() - pending Set cancelled");
  }

  sample(): void {
    const ctx = this.scene.current;
    const state = this.control?.state() ?? { kind: "none" };
    if (ctx === null) return;
    const probe = state.kind === "applied" ? pickExpressionProbe(ctx.facts.faceParams[state.name] ?? []) : null;
    const line = describeExpressionProbe({
      state,
      probe,
      sample: probe === null ? undefined : ctx.sampler.snapshot().samples[probe.id],
      available: probe !== null && ctx.params.has(probe.id),
      playing: isPlaying(ctx),
      nowMs: performance.now(),
    });
    this.log(line);
    this.note(line);
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

function isPlaying(ctx: ModelContext): boolean {
  return !ctx.internal.motionManager.isFinished() || ctx.internal.parallelMotionManager.some((m) => m.playing);
}
