import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillPackageView } from "@taki/shared";
import { SkillsPage, resolveSelectedRow } from "./skills-page.tsx";
import { SkillCard, type SkillCardProps } from "./skill-card.tsx";
const useSkills = vi.hoisted(() => vi.fn()); vi.mock("./use-skills.ts", () => ({ useSkills }));
const ROW: SkillPackageView = { packageId: "11111111-1111-4111-8111-111111111111", skillName: "demo", description: "demo", ownerHostId: "22222222-2222-4222-8222-222222222222", contentHash: null, enabled: false, configRevision: 1, sourceKind: "directory", sourceLocator: "browser-directory", trust: "operator-local", scanVersion: "v1", scanVerdict: "passed", scanFindings: [], lifecycleState: "active", runtimeState: "disabled", catalogGeneration: null, createdAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z", failureReason: null };
const controller = { bind: vi.fn(), refresh: vi.fn(), inspect: vi.fn(), importPackage: vi.fn(), setEnabled: vi.fn(), remove: vi.fn(), reconcile: vi.fn() };
const noop = () => undefined;
const actions = { inspect: noop, setInspectionOpen: noop, toggle: noop, replaceDirectory: noop, replaceZip: noop, askRemove: noop, cancelRemove: noop, remove: noop };

function card(overrides: Partial<SkillCardProps> = {}): string {
  return renderToStaticMarkup(<SkillCard row={ROW} disabled={false} confirming={false} inspected={null}
    inspection={{ open: true, pending: false, stale: false, error: null }} actions={actions} {...overrides} />);
}

beforeEach(() => useSkills.mockReturnValue({ state: { kind: "loading", packages: null, inspected: null, pending: null, message: null }, controller, status: { kind: "connected" }, connectionReady: true }));
describe("Skills page states", () => {
  it("does not insert an empty result section while the first inspection is pending", () => {
    const html = card({ inspection: { open: true, pending: true, stale: false, error: null } });
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toMatch(/检查结果|正在检查/u);
  });

  it("keeps the expanded result during reinspection without a transient message row", () => {
    const html = card({ inspected: { package: ROW, metadata: null, files: ["SKILL.md", "references/a.txt"] },
      inspection: { open: true, pending: true, stale: false, error: null } });
    expect(html).toContain("SKILL.md\nreferences/a.txt");
    expect(html).toContain("收起");
    expect(html).toContain('aria-busy="true"');
    expect(html.replace(/<[^>]*>/g, "")).not.toContain("正在检查");
  });

  it.each([true, false])("exposes the retained inspection's actual disclosure state: %s", (open) => {
    const html = card({ inspected: { package: ROW, metadata: null, files: ["SKILL.md"] },
      inspection: { open, pending: true, stale: false, error: null } });
    const disclosure = html.match(/<button\b[^>]*aria-expanded="(?:true|false)"[^>]*>[\s\S]*?<\/button>/u)?.[0] ?? "";
    expect(disclosure).toContain(`aria-expanded="${String(open)}"`);
    expect(disclosure).toContain(open ? "收起" : "展开");
    expect(html.includes("SKILL.md")).toBe(open);
  });

  it("renders loading and empty states", () => { expect(renderToStaticMarkup(<SkillsPage />)).toContain("animate-pulse"); useSkills.mockReturnValue({ state: { kind: "ready", packages: [], inspected: null, pending: null, message: null }, controller, status: { kind: "connected" }, connectionReady: true }); expect(renderToStaticMarkup(<SkillsPage />)).toContain("尚未安装 Skill"); });
  it("renders reconnecting and rejected states truthfully in Chinese", () => { useSkills.mockReturnValue({ state: { kind: "failure", packages: [{ ...ROW, skillName: null, description: null, lifecycleState: "rejected", runtimeState: "invalid", scanVerdict: "rejected", failureReason: "invalid-package" }], inspected: null, pending: null, message: "read failed" }, controller, status: { kind: "reconnecting" }, connectionReady: false }); const html = renderToStaticMarkup(<SkillsPage />); expect(html).toContain("正在重新连接，暂时无法更改技能"); expect(html).toContain("未通过验证的包"); expect(html).toContain("invalid-package"); expect(html).toContain("扫描拒绝"); expect(html).toContain("不可用"); });
  it("renders curated package declarations, relative files and actions without bookkeeping or custom metadata", () => {
    const row = { ...ROW, contentHash: `sha256.${"a".repeat(64)}`, configRevision: 914731, catalogGeneration: 825462 };
    const inspected = {
      package: row,
      metadata: {
        name: "demo", description: "demo", license: "MIT", compatibility: "Requires Python 3.11",
        "allowed-tools": "Read Bash(python:*)", metadata: { team: "custom-metadata-team", version: "9.4.1" },
      },
      files: ["SKILL.md", "references/a.txt"],
    };
    const html = card({ row, inspected, confirming: true });
    expect(html).toContain("许可协议");
    expect(html).toContain("MIT");
    expect(html).toContain("兼容性");
    expect(html).toContain("Requires Python 3.11");
    expect(html).toContain("声明使用的工具");
    expect(html).toContain("Read Bash(python:*)");
    expect(html).toContain("包文件（2）");
    expect(html).toContain("SKILL.md\nreferences/a.txt");
    expect(html).toContain("检查结果");
    expect(html).toContain("收起");
    expect(html).toContain("替换目录");
    expect(html).toContain("替换 ZIP");
    expect(html).toContain("确认移除");
    expect(html).toContain("取消");
    // Full markup covers expanded content, copy controls, titles and accessible names.
    expect(html).not.toMatch(/技术详情|Owner|哈希|修订|Catalog|代次|复制|Metadata/u);
    expect(html).not.toContain(row.packageId);
    expect(html).not.toContain(row.ownerHostId);
    expect(html).not.toContain(row.contentHash);
    expect(html).not.toContain(String(row.configRevision));
    expect(html).not.toContain(String(row.catalogGeneration));
    expect(html).not.toContain("custom-metadata-team");
    expect(html).not.toContain("9.4.1");
  });

  it("keeps package identity, trust, state and available actions before inspection", () => {
    const html = card();
    expect(html).toContain("demo");
    expect(html).toContain("目录导入 / 操作员本地");
    expect(html).toContain("生效中 / 已停用");
    expect(html).toContain("扫描通过");
    expect(html).toContain("检查");
    expect(html).toContain("启用");
    expect(html).toContain("移除");
    expect(html).not.toContain("检查结果");
    expect(html).not.toContain("<details");
  });

  it.each([null, { name: "demo", description: "demo", license: "", "allowed-tools": " " }])(
    "keeps an empty-file inspection useful without inventing missing declarations: %j", (metadata) => {
      const html = card({ inspected: { package: ROW, metadata, files: [] } });
      expect(html).toContain("检查结果");
      expect(html).toContain("收起");
      expect(html).toContain("包文件（0）");
      expect(html).toContain("无可展示文件");
      expect(html).not.toMatch(/许可协议|兼容性|声明使用的工具|版本/u);
    },
  );
  it("resolves the detail-pane target: the operator's selection, else the first row (L2)", () => { const rows = [ROW, { ...ROW, packageId: "33333333-3333-4333-8333-333333333333", skillName: "other" }]; expect(resolveSelectedRow(rows, "33333333-3333-4333-8333-333333333333")?.skillName).toBe("other"); expect(resolveSelectedRow(rows, null)?.skillName).toBe("demo"); expect(resolveSelectedRow([], ROW.packageId)).toBeNull(); expect(resolveSelectedRow(null, null)).toBeNull(); });
});
