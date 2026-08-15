import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PermissionCellsState } from "@taki/shared";
import { PermissionCellsCard } from "./permission-cells-card.tsx";
import { requiresSecondConfirm } from "./permission-cell-row.tsx";
import { PermissionLevelCard } from "./permission-level-card.tsx";

const data: PermissionCellsState = {
  level: "standard",
  policyGeneration: 7,
  registryRevision: 1,
  cells: [
    { key: "exec:blocked", level: "standard", capabilityId: "exec", descriptorRevision: 1, factoryPosture: "deny", overridePosture: null, effectivePosture: "deny", approvalMemory: "once-only", overrideMode: "second-confirm" },
    { key: "fs-write:self-escalation", level: "standard", capabilityId: "fs-write", descriptorRevision: 1, factoryPosture: "deny", overridePosture: null, effectivePosture: "deny", approvalMemory: "once-only", overrideMode: "immutable" },
  ],
};

describe("permission Settings components", () => {
  it("renders one Core-authoritative level card with generation and Host-constrained truth", () => {
    const markup = renderToStaticMarkup(<PermissionLevelCard data={data} disabled={false} pending={false} onSetLevel={() => undefined} />);
    expect(markup).toContain("策略代次 7");
    expect(markup).toContain("Execution Host");
    expect(markup).toContain("disabled");
  });

  it("keeps advanced cells collapsed by default and renders second-confirm/immutable/Host facts", () => {
    const markup = renderToStaticMarkup(<PermissionCellsCard data={data} disabled={false} pending={null} onSet={() => undefined} />);
    expect(markup).toContain("<details");
    expect(markup).not.toContain("<details open");
    expect(markup).toContain("second-confirm");
    expect(markup).toContain("不可变");
  });

  it("requires a second confirmation only when a second-confirm cell is loosened", () => {
    expect(requiresSecondConfirm(data.cells[0]!, "auto")).toBe(true);
    expect(requiresSecondConfirm(data.cells[0]!, "deny")).toBe(false);
    expect(requiresSecondConfirm(data.cells[1]!, "auto")).toBe(false);
  });
});
