import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CostumePage } from "./costume-page.tsx";

vi.mock("../../home-client-context.ts", () => ({ useHomeClient: () => ({ client: {} }) }));
vi.mock("./use-costume-page.ts", () => ({ useCostumePage: () => ({
  connectionReady: true, hasSnapshot: true, loading: false, refreshing: false, error: null, listError: null,
  view: { rows: [], missingPacks: [], current: null }, selected: null, pending: null,
  refresh: vi.fn(), invalidate: vi.fn(), select: vi.fn(), cancel: vi.fn(),
}) }));
vi.mock("@/features/character-import/use-character-import.js", () => ({ useCharacterImport: () => ({
  isImporting: false, result: { costumes: [{ id: "old-costume" }] }, warnings: ["optional resource missing"],
  error: "文件格式不受支持", importFile: vi.fn(),
}) }));

describe("Costume import feedback", () => {
  it("keeps resource warnings and a new refusal without a persistent old import success", () => {
    const html = renderToStaticMarkup(<CostumePage />);
    expect(html).toContain("文件格式不受支持");
    expect(html).toContain("1 条可选资源警告");
    expect(html).not.toContain("导入成功");
  });
});
