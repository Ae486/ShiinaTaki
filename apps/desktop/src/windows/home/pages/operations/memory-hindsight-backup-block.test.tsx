import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BACKUP_STATES, STAGED_ID } from "./memory-hindsight-backup-fixtures.ts";
import { HindsightBackupBlock } from "./memory-hindsight-backup-block.tsx";
import { hindsightBackupView } from "./memory-hindsight-backup-state.ts";
import { MemoryAuthorityCard } from "./memory-authority-card.tsx";
import { localStatus } from "./memory-authority-fixtures.ts";
import type { MemoryOperationsView } from "./use-memory-operations.ts";

const noop = async () => undefined;
type State = keyof typeof BACKUP_STATES;

function ops(state: State, patch: Partial<MemoryOperationsView> = {}): MemoryOperationsView {
  return { status: BACKUP_STATES[state], loading: false, error: null, busyKey: null, feedback: null, connectionReady: true,
    refresh: noop, submit: noop, submitSync: noop, cancel: noop, ...patch };
}

function block(state: State, locked = false, busyKey: string | null = null): string {
  const backup = hindsightBackupView(BACKUP_STATES[state]);
  if (!backup) throw new Error("fixture must carry a Hindsight section");
  return renderToStaticMarkup(<HindsightBackupBlock backup={backup} ops={ops(state, { busyKey })} locked={locked} />);
}

const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
const disabledCount = (markup: string) => markup.match(/<button[^>]*disabled=""/g)?.length ?? 0;
/** Everything before the collapsed diagnostics: the operator-facing part of the block. */
const primary = (markup: string) => markup.split("备份诊断")[0] ?? "";

describe("Hindsight backup block", () => {
  it("renders every fixture state", () => {
    expect(block("unknown")).toContain("未知");
    expect(block("none")).toContain("尚无已校验的备份");
    expect(block("verified")).toContain("2 小时前");
    expect(block("verified")).toContain("游标 40 → 52 · 未落定写入 1");
    expect(block("capturing")).toContain("进行中：创建备份 · 生成原生快照");
    expect(block("failed")).toContain("创建备份失败：Core 与原生快照不一致");
    expect(block("routeUnavailable")).toContain("原生备份接口不可用");
    expect(block("staged")).toContain(`backups/${STAGED_ID}.staged/native-request.json`);
    expect(block("staged")).toContain("backups/inbox");
    expect(block("rollback")).toContain('role="alert"');
    expect(block("rollback")).toContain("检测到 Hindsight 数据回退");
  });

  it("keeps closed codes and ids out of the primary rows", () => {
    for (const state of Object.keys(BACKUP_STATES) as State[]) {
      expect(primary(block(state))).not.toMatch(/HINDSIGHT_|44444444|77777777|character-/);
    }
    expect(block("failed").split("备份诊断")[1]).toContain("HINDSIGHT_BACKUP_PAIR_MISMATCH · receipt_missing@global");
  });

  it("offers capture, verify, the operator route and the admit form per state", () => {
    expect(buttons(block("none"))).toEqual(["创建备份"]);
    expect(buttons(block("verified"))).toEqual(["创建备份", "校验备份"]);
    expect(buttons(block("routeUnavailable"))).toEqual(["创建备份", "创建备份（手动导出原生数据）"]);
    const staged = block("staged");
    expect(buttons(staged)).toEqual(["导入备份", "创建备份"]);
    // An empty file name never reaches Core: only the admit button waits for input.
    expect(disabledCount(staged)).toBe(1);
    expect(staged).toContain("ZIP 文件名");
  });

  it("disables every action while a backup operation is open, the card is locked, or offline", () => {
    expect(disabledCount(block("capturing"))).toBe(buttons(block("capturing")).length);
    expect(disabledCount(block("verified", true, "backup:verify"))).toBe(2);
    expect([...block("verified", true, "backup:verify").matchAll(/<button[^>]*aria-busy="true"[^>]*>([^<]*)</g)].map((match) => match[1])).toEqual(["校验备份"]);
    expect(disabledCount(block("verified"))).toBe(0);
    const offline = renderToStaticMarkup(<MemoryAuthorityCard ops={ops("verified", { connectionReady: false })} />).split("Hindsight 备份")[1] ?? "";
    expect(disabledCount(primary(offline))).toBe(2);
  });

  it("sits in the memory authority card only under Hindsight authority", () => {
    expect(renderToStaticMarkup(<MemoryAuthorityCard ops={ops("verified")} />)).toContain("Hindsight 备份");
    expect(renderToStaticMarkup(<MemoryAuthorityCard ops={{ ...ops("verified"), status: localStatus() }} />)).not.toContain("Hindsight 备份");
  });
});
