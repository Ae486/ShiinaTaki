/**
 * INPUT:  replaceable config client, current field metadata/change epochs and validated local write intent.
 * OUTPUT: serialized per-field saves with explicit saved/refused/failed/retired outcomes and current-only echoes.
 * POS:    Home Settings — local write lifetime, not server CAS; visibility never cancels or replays config.set.
 */
import type { ConfigEntry, ConfigSetResult, ConfigValue } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { configSaveVerdict, refusalMessage, refusalOf } from "./config-state.ts";

export type ConfigSaveOutcome =
  | { kind: "saved"; display: string; current: boolean }
  | { kind: "failed" | "refused"; message: string }
  | { kind: "retired" };

interface ConfigSaveInput {
  entry(key: string): ConfigEntry | undefined;
  versionOf(key: string): number;
  apply(result: ConfigSetResult): void;
  started?(key: string): void;
  notice(key: string, notice: { ok: boolean; message: string }): void;
}

export function createConfigSaveController(input: ConfigSaveInput) {
  return new ConfigSaves(input);
}

class ConfigSaves {
  private readonly input: ConfigSaveInput;
  private client: (Pick<WsClient, "configSet"> & Partial<Pick<WsClient, "configList">>) | null = null;
  private epoch = 0;
  private readonly pending = new Set<string>();

  constructor(input: ConfigSaveInput) { this.input = input; }

  replace(client: (Pick<WsClient, "configSet"> & Partial<Pick<WsClient, "configList">>) | null): void {
    if (this.client === client) return;
    this.client = client;
    this.epoch += 1;
    this.pending.clear();
  }

  async save(key: string, value: ConfigValue | null): Promise<ConfigSaveOutcome> {
    const client = this.client;
    const entry = this.input.entry(key);
    if (!client || !entry || entry.secret || entry.apply === "env-only" || this.pending.has(key)) {
      return { kind: "refused", message: "当前无法保存此配置，请确认连接、字段权限及进行中的保存。" };
    }
    const epoch = this.epoch;
    const version = this.input.versionOf(key);
    this.pending.add(key);
    this.input.started?.(key);
    try {
      const result = await resolveSaveEcho(client, await client.configSet({ key, value }));
      if (this.client !== client || this.epoch !== epoch) return { kind: "retired" };
      const effective = result.effectiveValue !== undefined ? result.effectiveValue : result.value;
      const latest = this.input.entry(key);
      const current = Boolean(latest && !latest.secret && latest.apply !== "env-only"
        && ((this.input.versionOf(key) === version && latest.value === entry.value) || latest.value === effective));
      if (current && this.input.versionOf(key) === version) this.input.apply(result);
      this.input.notice(key, { ok: true, message: current ? configSaveVerdict(result) : "已提交；检测到其他修改，请核对当前值。" });
      return { kind: "saved", display: effective === null ? "" : String(effective), current };
    } catch (cause) {
      if (this.client !== client || this.epoch !== epoch) return { kind: "retired" };
      const reason = refusalOf(cause);
      const message = reason ? refusalMessage(reason) : cause instanceof Error ? cause.message : String(cause);
      this.input.notice(key, { ok: false, message });
      return { kind: reason ? "refused" : "failed", message };
    } finally {
      if (this.epoch === epoch) this.pending.delete(key);
    }
  }
}

async function resolveSaveEcho(client: Partial<Pick<WsClient, "configList">>, result: ConfigSetResult): Promise<ConfigSetResult> {
  if (result.value !== null || result.effectiveValue !== undefined) return result;
  const entry = (await client.configList?.())?.entries.find((candidate) => candidate.key === result.key);
  if (!entry) throw new Error("配置已提交，恢复后的值尚未确认，请重新读取配置。");
  return { ...result, effectiveValue: entry.value, origin: entry.origin, application: entry.application };
}
