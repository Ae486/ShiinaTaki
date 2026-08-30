/**
 * INPUT:  raw Core Skill wire values (lifecycle/runtime state, scan verdict, source kind, trust)
 * OUTPUT: Simplified Chinese skills labels + badge tones with a raw-string fallback for unknown values
 * POS:    ui/windows/home/pages/skills — U3 presentation labels; opaque package ids/hashes/revisions/owners never
 *         render here (they ride the detail disclosure's CopyableRows).
 */
import type { BadgeTone } from "../../badge.tsx";

const LIFECYCLE: Record<string, string> = { active: "生效中", quarantined: "已隔离", rejected: "已拒绝" };
const RUNTIME: Record<string, string> = { available: "可用", disabled: "已停用", invalid: "不可用" };
const SCAN: Record<string, string> = { passed: "扫描通过", review: "需人工复核", rejected: "扫描拒绝" };
const SOURCE: Record<string, string> = { directory: "目录导入", zip: "ZIP 导入", "legacy-directory": "旧版目录" };
const TRUST: Record<string, string> = {
  "bundled-reviewed": "内置审阅", "operator-local": "操作员本地",
  "external-archive": "外部归档", "legacy-local": "旧版本地", blocked: "已屏蔽",
};

export const REJECTED_PACKAGE_TITLE = "未通过验证的包";

export function lifecycleLabel(value: string): string {
  return LIFECYCLE[value] ?? value;
}
export function runtimeLabel(value: string): string {
  return RUNTIME[value] ?? value;
}
export function scanLabel(value: string): string {
  return SCAN[value] ?? value;
}
export function sourceLabel(value: string): string {
  return SOURCE[value] ?? value;
}
export function trustLabel(value: string): string {
  return TRUST[value] ?? value;
}

export function runtimeTone(value: string): BadgeTone {
  return value === "available" ? "ok" : value === "invalid" ? "warn" : "muted";
}
export function scanTone(value: string): BadgeTone {
  return value === "rejected" ? "warn" : "neutral";
}
