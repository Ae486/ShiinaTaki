/**
 * INPUT:  authenticated client generations, selected scope and Core evidence lifetime
 * OUTPUT: disposable configuration reads with retired-response rejection and one expiry read
 * POS:    ui/windows/home/pages/operations — no evidence persistence, polling or model probes
 */
import type { HindsightConfigurationScope, HindsightConfigurationStatus } from "@taki/shared";
import type { HindsightConfigurationMethods } from "@/lib/ws-client-hindsight-configuration.js";

export type ConfigurationViewState =
  | { kind: "idle" | "loading" | "observing" | "expired"; data: null }
  | { kind: "ready"; data: HindsightConfigurationStatus }
  | { kind: "failed"; data: null };

export interface ConfigurationController {
  replace(client: HindsightConfigurationMethods | null, scope: HindsightConfigurationScope): void;
  refresh(): Promise<void>;
  observe(): Promise<void>;
  dispose(): void;
}

export const INITIAL_CONFIGURATION: ConfigurationViewState = { kind: "idle", data: null };

class ConfigurationControllerImpl implements ConfigurationController {
  private client: HindsightConfigurationMethods | null = null;
  private scope: HindsightConfigurationScope = { kind: "global" };
  private generation = 0;
  private request = 0;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private expiredObservation: string | null = null;

  private readonly emit: (state: ConfigurationViewState) => void;

  constructor(emit: (state: ConfigurationViewState) => void) { this.emit = emit; }

  replace(client: HindsightConfigurationMethods | null, scope: HindsightConfigurationScope): void {
    this.retire();
    this.client = client;
    this.scope = scope;
    this.expiredObservation = null;
    this.emit(INITIAL_CONFIGURATION);
    if (client) void this.refresh();
  }

  refresh(): Promise<void> { return this.read(false); }
  observe(): Promise<void> { return this.read(true); }
  dispose(): void { this.retire(); this.client = null; }

  private retire(): void {
    this.generation += 1;
    this.pending = false;
    this.clearExpiry();
  }

  private clearExpiry(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private current(generation: number, request: number): boolean {
    return generation === this.generation && request === this.request;
  }

  private async read(observe: boolean): Promise<void> {
    const client = this.client;
    if (!client || this.pending) return;
    const generation = this.generation;
    const request = ++this.request;
    const scope = this.scope;
    const startedAt = performance.now();
    this.pending = true;
    this.clearExpiry();
    // Hide comparisons immediately: a failed explicit refresh must never leave an earlier green match.
    this.emit({ kind: observe ? "observing" : "loading", data: null });
    try {
      const data = await (observe ? client.hindsightConfigurationObserve({ scope }) : client.hindsightConfigurationStatus({ scope }));
      if (!this.current(generation, request)) return;
      if (!sameScope(scope, data.scope)) { this.emit({ kind: "failed", data: null }); return; }
      this.publish(data, Math.max(0, data.validForMs - (performance.now() - startedAt)));
    } catch {
      // Transport/validation errors may contain raw fields. The view receives only a fixed failure state.
      if (this.current(generation, request)) this.emit({ kind: "failed", data: null });
    } finally {
      if (this.current(generation, request)) this.pending = false;
    }
  }

  private publish(data: HindsightConfigurationStatus, remainingMs: number): void {
    if (data.status !== "observed") { this.emit({ kind: "ready", data }); return; }
    if (remainingMs <= 0 || (data.observationId !== null && data.observationId === this.expiredObservation)) {
      this.emit({ kind: "expired", data: null });
      return;
    }
    this.emit({ kind: "ready", data });
    const generation = this.generation;
    this.timer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.expiredObservation = data.observationId;
      this.timer = null;
      this.emit({ kind: "expired", data: null });
      // One read per published evidence lifetime. The same expired evidence cannot re-arm this timer.
      void this.refresh();
    }, remainingMs);
  }
}

function sameScope(left: HindsightConfigurationScope, right: HindsightConfigurationScope): boolean {
  return left.kind === "global" ? right.kind === "global"
    : right.kind === "character" && left.characterId === right.characterId;
}

export function createConfigurationController(emit: (state: ConfigurationViewState) => void): ConfigurationController {
  return new ConfigurationControllerImpl(emit);
}
