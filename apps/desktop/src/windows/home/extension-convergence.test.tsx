import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExtensionConvergenceResult } from "@taki/shared";
import { ExtensionConvergenceStrip } from "./extension-convergence.tsx";

const HOST = "11111111-1111-4111-8111-111111111111";
const OTHER_HOST = "22222222-2222-4222-8222-222222222222";
const hosts = [
  { hostId: HOST, available: true, connectionGeneration: 1, catalogGeneration: 2, extensionCount: 1 },
  { hostId: OTHER_HOST, available: false, connectionGeneration: 1, catalogGeneration: 1, extensionCount: 1 },
];
const data: ExtensionConvergenceResult = {
  observedAt: "2026-08-18T00:00:00.000Z",
  coreHostId: HOST,
  hosts,
  entries: hosts.map((host, index) => ({
    identity: {
      extensionId: `capability:${index}`,
      kind: "capability",
      ownerHostId: host.hostId,
      subjectId: "screenshot",
      subjectRevision: "1",
      connectionGeneration: host.connectionGeneration,
      catalogGeneration: host.catalogGeneration,
    },
    displayName: "Screenshot",
    summary: "Capture a screenshot",
    callMode: "capability",
    modelKey: "screenshot",
    available: host.available,
  })),
  collisions: [{ key: "screenshot", firstExtensionId: "capability:0", secondExtensionId: "capability:1" }],
};

describe("ExtensionConvergenceStrip", () => {
  it("renders actual availability and extension/conflict counts without Host identity or copy controls", () => {
    const html = renderToStaticMarkup(<ExtensionConvergenceStrip state={{ kind: "ready", data }} />);
    expect(html).not.toContain(HOST);
    expect(html).not.toContain(OTHER_HOST);
    expect(html).not.toContain("11111111…1111");
    expect(html).not.toContain("复制");
    expect(html).toContain('aria-label="扩展状态"');
    expect(html).toContain("可用主机 1/2");
    expect(html).toContain("扩展 2");
    expect(html).toContain('class="text-warn-strong">名称冲突 1');
  });

  it.each([
    { kind: "idle", notice: "等待连接，显示上次结果" },
    { kind: "loading", notice: "刷新中" },
    { kind: "failure", notice: "刷新失败，显示上次结果" },
  ] as const)("keeps previous counts explicitly qualified during $kind", ({ kind, notice }) => {
    const state = kind === "failure"
      ? { kind, previous: data, message: "读取失败" }
      : { kind, previous: data };
    const html = renderToStaticMarkup(<ExtensionConvergenceStrip state={state} />);
    expect(html).toContain("可用主机 1/2");
    expect(html).toContain("扩展 2");
    expect(html).toContain("名称冲突 1");
    expect(html).toContain(notice);
    expect(html).not.toContain(HOST);
    expect(html).not.toContain("复制");
  });

  it.each([
    { kind: "idle", notice: "等待连接以读取扩展状态…" },
    { kind: "loading", notice: "正在读取扩展状态…" },
    { kind: "failure", notice: "扩展状态不可用：读取失败" },
  ] as const)("does not invent availability without a snapshot during $kind", ({ kind, notice }) => {
    const state = kind === "failure"
      ? { kind, previous: null, message: "读取失败" }
      : { kind, previous: null };
    const html = renderToStaticMarkup(<ExtensionConvergenceStrip state={state} />);
    expect(html).toContain('role="status"');
    expect(html).toContain(notice);
    expect(html).not.toContain("可用主机");
    expect(html).not.toContain("名称冲突");
  });
});
