/**
 * INPUT:  replaceable authenticated clients, visible extension demand and real projection invalidations.
 * OUTPUT: bounded extension.status reads with retained snapshots and separate connection/visibility lifetimes.
 * POS:    Home extension projection — in-memory only, with no mutation, replay or persisted cache.
 */
import type { ExtensionConvergenceResult } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator, type ReadCoordinator } from "@/lib/read-coordinator.js";
import { createReadObservation, type ReadObservation, type ReadObservationState } from "@/lib/read-observation.js";

export type ExtensionConvergenceClient = Pick<WsClient, "extensionStatus" | "subscribeExtensions" | "onExtensionChanged">;
type ExtensionReadState =
  | { kind: "idle"; previous: ExtensionConvergenceResult | null }
  | { kind: "loading"; previous: ExtensionConvergenceResult | null }
  | { kind: "ready"; data: ExtensionConvergenceResult }
  | { kind: "failure"; previous: ExtensionConvergenceResult | null; message: string };
export type ExtensionConvergenceState = ExtensionReadState & { observation: ReadObservationState };

export interface ExtensionConvergenceController {
  replace(client: ExtensionConvergenceClient | null): void;
  setVisible(visible: boolean): void;
  refresh(): Promise<void>;
  invalidate(): Promise<void>;
  invalidateLegacy(): Promise<void>;
  dispose(): void;
}

export function createExtensionConvergenceController(publish: (state: ExtensionConvergenceState) => void): ExtensionConvergenceController {
  return new ExtensionReads(publish);
}

class ExtensionReads implements ExtensionConvergenceController {
  private client: ExtensionConvergenceClient | null = null;
  private lastGood: ExtensionConvergenceResult | null = null;
  private visible = true;
  private readEpoch = 0;
  private needsRead = true;
  private state: ExtensionReadState = { kind: "idle", previous: null };
  private readonly publish: (state: ExtensionConvergenceState) => void;
  private readonly reads: ReadCoordinator<ExtensionConvergenceResult>;
  private readonly observation: ReadObservation;

  constructor(publish: (state: ExtensionConvergenceState) => void) {
    this.publish = publish;
    this.reads = createReadCoordinator<ExtensionConvergenceResult>({
      started: () => { this.needsRead = true; this.set({ kind: "loading", previous: this.lastGood }); },
      loaded: (data) => { this.needsRead = false; this.lastGood = data; this.set({ kind: "ready", data }); },
      failed: (cause) => this.fail(cause),
      retired: () => { if (this.needsRead) this.set({ kind: "idle", previous: this.lastGood }); },
    });
    this.observation = createReadObservation({
      changed: (observation) => {
        if (observation === "subscribing") this.state = { kind: "loading", previous: this.lastGood };
        if (this.visible) this.publish({ ...this.state, observation });
      },
      failed: (cause) => this.fail(cause),
      invalidated: () => { void this.invalidate(); },
    });
  }

  replace(client: ExtensionConvergenceClient | null): void {
    if (this.client === client) return;
    this.client = client;
    this.readEpoch += 1;
    this.needsRead = true;
    this.reads.setActive(false);
    this.reads.replace(client ? () => client.extensionStatus() : null);
    this.state = { kind: "idle", previous: this.lastGood };
    this.observation.replace(client ? {
      subscribe: () => client.subscribeExtensions(),
      onChanged: (changed) => client.onExtensionChanged((event) => { if (event.targets.includes("extension-status")) changed(event.revision); }),
    } : null);
    if (client) void this.refresh();
    else this.set(this.state);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.readEpoch += 1;
    this.reads.setActive(visible && this.observation.usable());
    if (visible) {
      this.set(this.state);
      if (this.needsRead || this.observation.state() !== "live") void this.refresh();
    }
  }

  async refresh(): Promise<void> {
    if (!this.client || !this.visible) return;
    const token = this.readEpoch;
    if (!this.observation.usable() && !await this.observation.prepare()) return;
    if (token !== this.readEpoch || !this.visible) return;
    this.reads.setActive(true);
    await this.reads.demand();
  }
  invalidate(): Promise<void> { this.needsRead = true; return this.reads.invalidate(); }
  invalidateLegacy(): Promise<void> { return this.observation.state() === "unsupported" ? this.invalidate() : Promise.resolve(); }
  dispose(): void { this.replace(null); }
  private set(state: ExtensionReadState): void {
    this.state = state;
    if (this.visible) this.publish({ ...state, observation: this.observation.state() });
  }
  private fail(cause: unknown): void {
    this.set({ kind: "failure", previous: this.lastGood, message: cause instanceof Error ? cause.message : "无法读取扩展状态" });
  }
}
