/**
 * INPUT:  scene.current (costume, motion state incl. parallel channels, lipSyncIds, face-set size, sampler snapshot) + the
 *         findings-log ring.
 * OUTPUT: createFindingsLog(capacity) -> { log, lines }; mountPanelReadout(deps, findings) -> { dispose } — a <pre>
 *         refreshed at 10 Hz by setInterval (deliberately NOT the Pixi ticker: the readout must keep updating while the
 *         engine is paused or a load is in flight).
 * POS:    experimental / lab — not in production path; read-only over the scene.
 */

import type { ModelContext } from "../scene/lab-scene.ts";
import type { SamplerSnapshot } from "../scene/param-sampler.ts";
import { type PanelDeps, section } from "./controls.ts";

const REFRESH_MS = 100;

export interface FindingsLog {
  log: (line: string) => void;
  lines: () => readonly string[];
}

export function createFindingsLog(capacity = 40): FindingsLog {
  const ring: string[] = [];
  return {
    log(line) {
      ring.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
      if (ring.length > capacity) ring.splice(0, ring.length - capacity);
    },
    lines: () => ring,
  };
}

export function mountPanelReadout({ host, scene }: PanelDeps, findings: FindingsLog): { dispose: () => void } {
  const root = section(host, "Readout");
  const pre = document.createElement("pre");
  root.append(pre);
  const timer = setInterval(() => {
    pre.textContent = [render(scene.current), "", "findings:", ...findings.lines()].join("\n");
  }, REFRESH_MS);
  return { dispose: () => clearInterval(timer) };
}

function render(ctx: ModelContext | null): string {
  if (ctx === null) return "no model loaded";
  const manager = ctx.internal.motionManager;
  return [
    `costume: ${ctx.entry.characterId}/${ctx.entry.costume}  [${ctx.facts.generation}]`,
    `motion: ${manager.isFinished() ? "finished" : "playing"}  priority=${manager.state.currentPriority}`,
    `parallel: ${ctx.internal.parallelMotionManager.map((m, i) => `[${i}] ${m.playing ? "playing" : "idle"}`).join("  ") || "(none)"}`,
    `lipSyncIds: ${ctx.facts.lipSyncIds.join(", ")}  faceSet: ${ctx.facts.faceSet.length} ids`,
    renderSamples(ctx.sampler.snapshot()),
  ].join("\n");
}

export function renderSamples({ samples, drift }: SamplerSnapshot): string {
  const ids = Object.keys(samples);
  if (ids.length === 0) return "sampled params: (none tracked)";
  const rows = ids.map((id) => {
    const s = samples[id];
    return `  ${id}\n    before ${fmt(s?.before)}  after ${fmt(s?.after)}  final ${fmt(s?.final)}${drift[id] ? "  DRIFT" : ""}`;
  });
  return ["sampled params:", ...rows].join("\n");
}

function fmt(value: unknown): string {
  return (typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "n/a").padStart(8);
}
