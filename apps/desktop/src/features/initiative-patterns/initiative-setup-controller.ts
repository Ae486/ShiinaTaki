/**
 * INPUT: authenticated setup/config facade, invalidations and explicit install/seed/toggle actions.
 * OUTPUT: retained effective policy/source/Skill status with guarded serialized setup outcomes.
 * POS: Desktop setup controller; standard Core Skill import and Pattern proposal remain authoritative.
 */
import type { InitiativeSetupStatus } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator } from "@/lib/read-coordinator.js";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { PATTERN_REFUSALS } from "./pattern-labels.ts";

export type SetupClient = Pick<WsClient, "initiativeSetupRead" | "initiativeSetupInstallSkill" | "initiativeSetupProposeSeed"
  | "onInitiativeSetupChanged" | "configSet" | "subscribeConfig" | "onConfigChanged">;
export interface InitiativeSetupState {
  data: InitiativeSetupStatus | null;
  loading: boolean;
  fresh: boolean;
  pending: boolean;
  error: string | null;
  feedback: { tone: "ok" | "warn" | "danger"; message: string } | null;
}
export const INITIAL_SETUP_STATE: InitiativeSetupState = { data: null, loading: false, fresh: false, pending: false, error: null, feedback: null };

export class InitiativeSetupController {
  private state = INITIAL_SETUP_STATE;
  private client: SetupClient | null = null;
  private generation = 0;
  private visible = true;
  private mutation: object | null = null;
  private stop: (() => void) | null = null;
  private readonly reads = createReadCoordinator<InitiativeSetupStatus>({
    started: () => this.patch({ loading: true }),
    loaded: (data) => this.patch({ data, loading: false, fresh: true, error: null }),
    failed: () => this.patch({ loading: false, fresh: false, error: "读取全局限制与设置状态失败，已保留上次内容。" }),
    retired: () => this.patch({ loading: false }),
  });

  private readonly publish: (state: InitiativeSetupState) => void;
  constructor(publish: (state: InitiativeSetupState) => void) { this.publish = publish; }

  bind(client: SetupClient | null): void {
    if (this.client === client) return;
    this.stop?.();
    this.client = client;
    this.generation += 1;
    if (this.mutation) this.patch({ feedback: { tone: "warn", message: "设置操作结果尚未确认，请恢复连接后核对。不会自动重新提交。" } });
    this.mutation = null;
    this.patch({ pending: false, fresh: false });
    const generation = this.generation;
    this.reads.replace(client ? async () => {
      await client.subscribeConfig();
      if (this.client !== client || this.generation !== generation) throw new Error("retired");
      return client.initiativeSetupRead({ characterId: ACTIVE_CHARACTER_ID });
    } : null);
    const stops = client ? [
      client.onInitiativeSetupChanged((event) => { if (event.characterId === ACTIVE_CHARACTER_ID && this.client === client) this.invalidate(); }),
      client.onConfigChanged((event) => { if (event.key.startsWith("TAKI_INITIATIVE_") && this.client === client) this.invalidate(); }),
    ] : [];
    this.stop = () => stops.forEach((stop) => stop());
    if (client && this.visible) void this.refresh();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.reads.setActive(visible);
    if (visible) { this.publish(this.state); void this.refresh(); }
    else this.patch({ fresh: false });
  }
  refresh(): Promise<void> { return this.reads.demand(); }
  invalidate(): void { this.patch({ fresh: false }); void this.reads.invalidate(); }

  install(): Promise<void> {
    return this.mutate(async (client) => {
      const result = await client.initiativeSetupInstallSkill({ characterId: ACTIVE_CHARACTER_ID });
      if (result.status === "refused") return { tone: "warn", message: result.reason === "package-disabled"
        ? "现有技能已被停用，已保留该选择。请到 Skills 页面查看并自行决定是否启用。"
        : result.reason === "name-conflict" ? "已存在同名技能，未覆盖其内容。请到 Skills 页面检查。" : "导入技能失败，请重试或查看 Skills 页面。" };
      return { tone: "ok", message: result.status === "installed" ? "创作技能已导入。" : "创作技能已就绪，未替换现有内容。" };
    });
  }

  proposeSeed(seedId: InitiativeSetupStatus["seeds"][number]["seedId"]): Promise<void> {
    return this.mutate(async (client) => {
      const result = await client.initiativeSetupProposeSeed({ characterId: ACTIVE_CHARACTER_ID, commandId: crypto.randomUUID(), seedId });
      return result.status === "refused" ? { tone: "warn", message: PATTERN_REFUSALS[result.reason] }
        : { tone: "ok", message: "示例已生成待确认提案，请在规则列表查看并确认。" };
    });
  }

  setEnabled(enabled: boolean): Promise<void> {
    const entry = this.state.data?.settings.find((item) => item.key === "TAKI_INITIATIVE_ENABLED");
    if (!entry || entry.envLocked || entry.apply !== "live") return Promise.resolve();
    return this.mutate(async (client) => {
      await client.configSet({ key: entry.key, value: enabled });
      return { tone: "ok", message: enabled ? "主动互动已开启，仍需有已确认规则与有效信息。" : "主动互动已关闭。定时任务不受影响。" };
    });
  }

  private async mutate(run: (client: SetupClient) => Promise<NonNullable<InitiativeSetupState["feedback"]>>): Promise<void> {
    const client = this.client;
    if (!client || this.mutation || !this.visible || !this.state.fresh) return;
    const token = {};
    this.mutation = token;
    const generation = this.generation;
    this.patch({ pending: true, feedback: null });
    try {
      const feedback = await run(client);
      if (this.client !== client || this.generation !== generation) return;
      this.patch({ feedback });
      this.reads.acceptUpdate();
      this.invalidate();
    } catch {
      if (this.client === client && this.generation === generation) {
        this.patch({ feedback: { tone: "danger", message: "未能确认设置操作结果。请刷新核对后重试；不会自动重新提交。" } });
        this.invalidate();
      }
    } finally {
      if (this.mutation === token) { this.mutation = null; this.patch({ pending: false }); }
    }
  }

  private patch(patch: Partial<InitiativeSetupState>): void {
    this.state = { ...this.state, ...patch };
    if (this.visible) this.publish(this.state);
  }
}
