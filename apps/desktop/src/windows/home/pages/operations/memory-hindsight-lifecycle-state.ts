/**
 * INPUT:  the `hindsight` section and authority epoch of a schema-validated MemoryAuthorityStatus
 * OUTPUT: hindsightLifecycleView() — connection rows, per-scope Bank readiness rows, diagnostics and the 重新校验连接 /
 *         创建 Bank action descriptors carrying their exact memory.operations.submit request and busy key
 * POS:    ui/windows/home/pages/operations — node-testable projection for the memory authority card; actions come only
 *         from Core `hindsight.actions` (no client allow rule); native Bank ids and error codes only in diagnostics
 */
import type { HindsightBankReadiness, MemoryAuthorityStatus, MemoryHindsightStatusSection, MemoryOperationRequest } from "@taki/shared";
import type { LabeledRow } from "../../page-card.tsx";
import { bankScopeLabel, MEMORY_OPERATION_KIND_LABEL, MEMORY_RUNTIME_UNAVAILABLE_LABEL } from "./memory-authority-state.ts";

export interface LifecycleAction { key: string; label: string; request: MemoryOperationRequest }

export interface HindsightLifecycleView {
  connection: LabeledRow[];
  banks: LabeledRow[];
  diagnostics: LabeledRow[];
  actions: LifecycleAction[];
}

type Connection = MemoryHindsightStatusSection["connection"];

const CONFIG_LABEL: Record<Connection["config"], string> = {
  ready: "已配置", disabled: MEMORY_RUNTIME_UNAVAILABLE_LABEL.connection_disabled, unconfigured: "未填写连接参数",
};
const DRIFT_LABEL: Record<Connection["drift"], string> = {
  none: "与已校验的配置一致", config_changed: MEMORY_RUNTIME_UNAVAILABLE_LABEL.config_changed, unreviewed: "当前配置尚未校验",
};
export const BANK_READINESS_LABEL: Record<HindsightBankReadiness, string> = {
  ready: "可用", syncing: "同步中", provisioning: "创建中", failed: "失败", not_provisioned: "未创建",
};
const NONE = "无";

export function hindsightLifecycleView(status: MemoryAuthorityStatus): HindsightLifecycleView | null {
  const section = status.hindsight;
  if (!section) return null;
  return {
    connection: connectionRows(section.connection),
    banks: section.banks.map((bank) => ({ label: bankScopeLabel(bank.scope, bank.characterId), value: BANK_READINESS_LABEL[bank.readiness] })),
    diagnostics: section.banks.map((bank) => ({
      label: `${bankScopeLabel(bank.scope, bank.characterId)} Bank`,
      value: `${bank.nativeBankId ?? NONE}${bank.errorCode ? ` · ${bank.errorCode}` : ""}`,
    })),
    actions: lifecycleActions(section.actions, status.authority.epochId),
  };
}

/** Drift and admission evidence exist only for a ready connection, so the other configs show one line. */
function connectionRows({ config, drift, admittedAt }: Connection): LabeledRow[] {
  const rows = [{ label: "连接配置", value: CONFIG_LABEL[config] }];
  if (config !== "ready") return rows;
  return [...rows, { label: "配置变更", value: DRIFT_LABEL[drift] }, { label: "上次校验通过", value: admittedAt ?? "无记录" }];
}

function lifecycleActions(actions: MemoryHindsightStatusSection["actions"], epochId: string | null): LifecycleAction[] {
  const revalidate: LifecycleAction[] = actions.revalidate && epochId
    ? [{ key: "revalidate", label: MEMORY_OPERATION_KIND_LABEL["connection.revalidate"], request: { kind: "connection.revalidate", expectedEpochId: epochId } }]
    : [];
  return [...revalidate, ...actions.provision.map((characterId): LifecycleAction => ({
    key: `provision:${characterId}`,
    label: `${MEMORY_OPERATION_KIND_LABEL["bank.provision"]}（${characterId}）`,
    request: { kind: "bank.provision", characterId },
  }))];
}
