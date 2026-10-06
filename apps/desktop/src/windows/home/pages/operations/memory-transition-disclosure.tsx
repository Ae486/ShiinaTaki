/**
 * INPUT: original emergency preview or sealed incident coverage, with nullable local coordinates.
 * OUTPUT: known surviving evidence and explicit unknown remote loss; no implied fresh backup.
 * POS: ui/operations — shared by emergency confirmation and historical progress.
 */
import type { MemoryTransitionOverview } from "@taki/shared";
import { LabeledRows } from "../../page-card.tsx";
type Props = { disclosure: NonNullable<MemoryTransitionOverview["entries"][number]["emergency"]> };
const EVIDENCE = { "paired-replica": "成对副本", "native-only": "仅原生副本", missing: "缺少副本", unreadable: "无法读取", incompatible: "证据不兼容" };

export function MemoryTransitionDisclosure({ disclosure }: Props) {
  return <div className="flex flex-col gap-2 text-xs text-text-body">
    <p>紧急接管只使用本机保全证据。远端最新状态及可能丢失的区间未知；游标相等也不能证明没有丢失。</p>
    <p>{disclosure.lastVerifiedBackupId === null ? "没有已验证备份；仍可能存在下列本地副本和待处理证据。"
      : `已验证备份距证据采集约 ${disclosure.backupAgeSeconds ?? "未知"} 秒；这不是完整恢复保证。`}</p>
    {disclosure.banks.map((bank, index) => <div key={bank.bankId ?? index} className="rounded-md border border-border-subtle p-2">
      <p className="mb-1 font-medium">{bank.scope.kind === "global" ? "Global" : `Character · ${bank.scope.characterId}`} · {EVIDENCE[bank.evidence]}</p>
      <LabeledRows rows={[
        { label: "副本 / 应用原生游标", value: `${bank.replicaCursor ?? "未知"} / ${bank.applicationNativeCursor ?? "未知"}` },
        { label: "应用状态游标", value: String(bank.applicationStateCursor ?? "未知") },
        { label: "待处理写入", value: String(bank.pendingCount ?? "未知") },
        { label: "备份原生 / 应用状态游标", value: `${bank.backupNativeCursor ?? "不可比较"} / ${bank.backupApplicationStateCursor ?? "不可比较"}` },
      ]} />
    </div>)}
  </div>;
}
