/**
 * INPUT: one Home operator generation, its real identity and device IANA timezone
 * OUTPUT: disposable singleton view, explicit CAS settings and one designated reporter
 * POS: ui/presence — Home owns reporting; Chat/Pet never compete for the timezone source
 */
import type { UserTimezoneMethods } from "@/lib/ws-client-user-timezone.js";
import type { UserTimezoneReadResult, UserTimezoneMutationResult, UserTimezoneUpdateParams } from "@taki/shared";

export interface TimezoneView {
  data: UserTimezoneReadResult | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}
interface ControllerInput {
  client: UserTimezoneMethods;
  deviceId: string;
  timezone(): string;
}
const REFUSALS = { "revision-conflict": "时区设置已变化，请刷新后重试。", "unknown-authority": "此设备尚未获得时区报告资格。",
  "foreign-authority": "当前由其他设备提供时区。", "stale-source": "时区报告来源已更换，保留上次确认的时区。" };
type TimezoneChoice = { mode: "fixed"; timezone: string } | { mode: "follow-primary-device" };

export class HomeTimezoneOwner {
  private readonly input: ControllerInput;
  private view: TimezoneView = { data: null, loading: false, saving: false, error: null };
  private disposed = false;
  private epoch = 0;
  private sourceId: string | null = null;
  private retired = false;
  private reportedZone: string | null = null;
  private flight: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(input: ControllerInput) { this.input = input; }
  snapshot = () => this.view;
  private current(ticket: number) { return !this.disposed && ticket === this.epoch; }
  private publish(next: Partial<TimezoneView>) {
    if (this.disposed) return;
    this.view = { ...this.view, ...next }; this.listeners.forEach((notify) => notify());
  }
  private accept(result: UserTimezoneMutationResult, reported = false) {
    const reportStatus = result.state.mode === "fixed" ? "fixed"
      : result.status === "accepted" && reported ? "current" : "unavailable";
    this.publish({ data: { state: result.state, reportStatus },
      error: result.status === "refused" ? REFUSALS[result.reason] : null });
    if (result.status === "refused" && result.reason === "stale-source") { this.retired = true; this.sourceId = null; }
  }
  private resetSource() { this.sourceId = null; this.retired = false; this.reportedZone = null; }
  private async report(ticket: number): Promise<void> {
    const state = this.view.data?.state;
    if (!state || state.mode === "fixed" || state.authorityDeviceId !== this.input.deviceId || this.retired) return;
    if (!this.sourceId) {
      const claim = await this.input.client.userTimezoneRead({ claimReportSource: true });
      if (!this.current(ticket)) return;
      this.publish({ data: claim });
      if (claim.refusal) {
        this.retired = claim.refusal === "stale-source"; this.publish({ error: REFUSALS[claim.refusal] }); return;
      }
      this.sourceId = claim.reportSourceId ?? null;
    }
    const zone = this.input.timezone();
    const data = this.view.data;
    if (!this.sourceId || !data || this.reportedZone === zone) return;
    // A lost acknowledgement is not permission to replay the same observation as another mutation.
    this.reportedZone = zone;
    const result = await this.input.client.userTimezoneReport({ expectedRevision: data.state.revision, timezone: zone,
      reportSourceId: this.sourceId });
    if (!this.current(ticket)) return;
    this.accept(result, true);
  }
  private async read(ticket: number): Promise<void> {
    try {
      const data = await this.input.client.userTimezoneRead();
      if (!this.current(ticket)) return;
      // Settings invalidate the token; an ordinary current-source read alone never claims it from another window.
      if (data.reportStatus === "unavailable" && this.view.data?.state.revision !== data.state.revision) this.resetSource();
      this.publish({ data, error: this.retired ? REFUSALS["stale-source"] : null });
      await this.report(ticket);
    } catch (cause) { if (this.current(ticket)) this.publish({ error: String(cause) }); }
    finally { if (this.current(ticket)) this.publish({ loading: false }); }
  }
  refresh = (): Promise<void> => {
    if (this.disposed || this.view.saving) return Promise.resolve();
    if (this.flight) return this.flight;
    this.publish({ loading: true });
    const pending = this.read(this.epoch).finally(() => { if (this.flight === pending) this.flight = null; });
    this.flight = pending;
    return pending;
  };
  save = async (choice: TimezoneChoice): Promise<void> => {
    if (this.disposed || this.view.saving || !this.view.data) return;
    const ticket = ++this.epoch;
    this.flight = null;
    const params: UserTimezoneUpdateParams = choice.mode === "fixed" ? { ...choice, expectedRevision: this.view.data.state.revision }
      : { ...choice, expectedRevision: this.view.data.state.revision, authorityDeviceId: this.input.deviceId };
    this.publish({ saving: true, loading: false, error: null });
    try {
      const result = await this.input.client.userTimezoneUpdate(params);
      if (!this.current(ticket)) return;
      this.accept(result);
      if (result.status === "accepted") { this.resetSource(); await this.report(ticket); }
    } catch (cause) { if (this.current(ticket)) this.publish({ error: `保存结果未确认，请刷新核对：${String(cause)}` }); }
    finally { if (this.current(ticket)) this.publish({ saving: false }); }
  };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dispose = () => { this.disposed = true; this.epoch += 1; this.sourceId = null; this.listeners.clear(); };
}

export function createUserTimezoneController(input: ControllerInput): HomeTimezoneOwner { return new HomeTimezoneOwner(input); }
export type UserTimezoneController = ReturnType<typeof createUserTimezoneController>;
