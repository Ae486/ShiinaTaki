/**
 * INPUT: one restored operator generation, trusted own-input facts and self-window state
 * OUTPUT: sequenced expiring presence/exposure reports with immediate source retirement
 * POS: ui/presence — disposable source owner; renewing reachability never refreshes input age
 */
import type { PresenceReportParams, PresenceReportResult } from "@taki/shared";
import type { PresenceMethods } from "@/lib/ws-client-presence.js";
import type { OwnWindowState } from "./own-window-visibility.ts";

export interface CommittedTextTarget { characterId: string; timelineSeq: number }
interface SourceInput {
  client: PresenceMethods;
  surface: PresenceReportParams["surface"];
  now?: () => number;
  sourceId?: string;
}
type InputKind = NonNullable<PresenceReportParams["lastInput"]>["kind"];
interface InputFact { sequence: number; kind: InputKind; at: number }

interface ExposedText { target: CommittedTextTarget; owners: Set<object> }

export class SurfacePresenceOwner {
  private readonly options: SourceInput;
  private readonly now: () => number;
  private readonly sourceId: string;
  private sequence = 0;
  private inputSequence = 0;
  private lastInput: InputFact | null = null;
  private state: OwnWindowState = { visible: false, focused: false };
  private inputWindow: OwnWindowState = { visible: false, focused: false };
  private listening = false;
  private checkingWindow = false;
  private active = true;
  private started = false;
  private retired = false;
  private lastReportAt = -Infinity;
  private coalesced: ReturnType<typeof setTimeout> | undefined;
  private readonly exposed = new Map<string, ExposedText>();
  private readonly listeners = new Set<() => void>();

  constructor(options: SourceInput) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.sourceId = options.sourceId ?? crypto.randomUUID();
  }
  eligible = () => this.started && !this.retired && this.active && this.state.visible;
  private trackingInput = () => this.started && !this.retired && this.active && this.listening
    && this.inputWindow.visible && this.inputWindow.focused;
  private notify() { this.listeners.forEach((listener) => listener()); }
  private receive = (result: PresenceReportResult) => {
    if (result.status === "refused" && ["stale-source", "unauthorized"].includes(result.reason)) this.stop(false);
  };
  private report(status: "active" | "retired" = "active") {
    if (!this.started || this.retired) return;
    this.lastReportAt = this.now();
    const ageMs = this.lastInput ? Math.max(0, Math.floor(this.now() - this.lastInput.at)) : 0;
    void this.options.client.presenceReport({ sourceId: this.sourceId, sequence: ++this.sequence, observedAgeMs: 0,
      surface: this.options.surface, state: status, visible: status === "active" && this.active && this.state.visible,
      focused: status === "active" && this.active && this.state.focused,
      inputContinuity: status === "active" && this.trackingInput() ? "tracked" : "suspended",
      // Retain bounded original age for source-local inactivity; Core still expires presence at 60 seconds.
      lastInput: status === "active" && this.lastInput && ageMs <= 86_400_000
        ? { sequence: this.lastInput.sequence, kind: this.lastInput.kind, ageMs } : null,
    }).then(this.receive).catch(() => this.stop(false));
  }
  private exposure(target: CommittedTextTarget, exposed: boolean) {
    if (!this.started || this.retired) return;
    void this.options.client.timelinePresentationReport({ ...target, sourceId: this.sourceId,
      sequence: ++this.sequence, observedAgeMs: 0, exposed }).then(this.receive).catch(() => this.stop(false));
  }
  private stop(send: boolean) {
    if (this.retired) return;
    if (send) { this.exposed.forEach(({ target }) => this.exposure(target, false)); this.report("retired"); }
    this.retired = true;
    this.exposed.clear(); clearTimeout(this.coalesced); this.notify();
  }
  private update(next: OwnWindowState, enabled: boolean) {
    if (this.retired || (this.state.visible === next.visible && this.state.focused === next.focused && this.active === enabled)) return;
    this.state = next; this.active = enabled;
    if (!this.eligible()) { this.exposed.forEach(({ target }) => this.exposure(target, false)); this.exposed.clear(); }
    this.report(); this.notify();
  }
  start() { if (!this.started && !this.retired) { this.started = true; this.report(); this.notify(); } }
  setWindow = (next: OwnWindowState) => {
    const trackingBefore = this.trackingInput();
    this.checkingWindow = false; this.inputWindow = next;
    const unchanged = this.state.visible === next.visible && this.state.focused === next.focused;
    this.update(next, this.active);
    if (unchanged && trackingBefore !== this.trackingInput()) this.report();
  };
  /** Native queries withdraw exposure, while the already-attached trusted input listeners remain live. */
  beginWindowRefresh = () => { this.checkingWindow = true; this.update({ visible: false, focused: false }, this.active); };
  setInputTracking(listening: boolean) {
    if (this.listening === listening) return;
    this.listening = listening; this.report();
  }
  setActive(value: boolean) { this.update(this.state, value); }
  input(kind: InputKind, trusted: boolean) {
    const pendingInput = this.checkingWindow && this.listening && this.active && this.inputWindow.visible;
    if (!trusted || !this.listening || this.retired || !this.started || (!this.eligible() && !pendingInput)) return;
    this.lastInput = { sequence: ++this.inputSequence, kind, at: this.now() };
    if (this.now() - this.lastReportAt >= 1_000) this.report();
    else if (!this.coalesced) this.coalesced = setTimeout(() => {
      this.coalesced = undefined; this.report();
    }, 1_000 - (this.now() - this.lastReportAt));
  }
  expose(target: CommittedTextTarget, value: boolean, owner: object = this) {
    const key = `${target.characterId}:${target.timelineSeq}`;
    const existing = this.exposed.get(key);
    if (value && this.eligible()) {
      if (existing) existing.owners.add(owner);
      else if (this.exposed.size < 64) {
        this.exposed.set(key, { target, owners: new Set([owner]) }); this.exposure(target, true);
      }
    } else if (!value && existing) {
      existing.owners.delete(owner);
      // Several rendered language segments can reference one row; one leaving cannot hide the others.
      if (existing.owners.size === 0) { this.exposed.delete(key); this.exposure(target, false); }
    }
  }
  renew() { if (!this.retired) { this.report(); this.exposed.forEach(({ target }) => this.exposure(target, true)); } }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  dispose() { this.stop(true); }
}

export function createSurfacePresence(input: SourceInput): SurfacePresenceOwner { return new SurfacePresenceOwner(input); }
export type SurfacePresence = ReturnType<typeof createSurfacePresence>;
