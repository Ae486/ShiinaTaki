/**
 * INPUT: finite Home page demand, correlated Pet observations and scene/switch invalidations.
 * OUTPUT: nullable current costume; retired replies cannot overwrite a newer read or successful switch.
 * POS: Home Costume — disposable presentation read owner, without a cache, polling or mutation authority.
 */
import { parseCostumeSceneSnapshot } from "@/lib/costume-scene-event.js";

interface ObserverDeps {
  request(requestId: string): Promise<void>;
  observe(costumeId: string | null): void;
  error(message: string | null): void;
  timeoutMs(): number;
}

export class CostumeSceneObserver {
  private readonly deps: ObserverDeps;
  private active = false;
  private requestId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: ObserverDeps) { this.deps = deps; }

  start(): void {
    this.active = true;
    this.refresh();
  }

  refresh(): void {
    this.retire();
    if (!this.active) return;
    this.deps.observe(null);
    this.deps.error(null);
    const requestId = crypto.randomUUID();
    this.requestId = requestId;
    this.timer = setTimeout(() => this.fail(requestId, "读取当前服装超时，请刷新重试"), this.deps.timeoutMs());
    void this.deps.request(requestId).catch(() => this.fail(requestId, "无法读取宠物窗口当前服装，请刷新重试"));
  }

  receive(payload: unknown): void {
    const snapshot = parseCostumeSceneSnapshot(payload);
    if (!this.active || !snapshot || snapshot.requestId !== this.requestId) return;
    this.retire();
    this.deps.error(null);
    this.deps.observe(snapshot.costumeId);
  }

  stop(): void {
    this.active = false;
    this.retire();
    this.deps.observe(null);
  }

  unavailable(): void {
    this.retire();
    if (!this.active) return;
    this.deps.observe(null);
    this.deps.error("宠物窗口已关闭，当前服装不可用");
  }

  private fail(requestId: string, message: string): void {
    if (!this.active || this.requestId !== requestId) return;
    this.retire();
    this.deps.error(message);
  }

  private retire(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.requestId = null;
  }
}
