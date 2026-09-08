import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StorageCard } from "./storage-card.tsx";

describe("attachment-clear feedback", () => {
  it("keeps a retryable failure without rendering an older transient success", () => {
    const clear = { phase: "idle" as const, notice: "已清除 3 个附件", error: "清除失败，请重试", onEvent: vi.fn() };
    const html = renderToStaticMarkup(<StorageCard usage={{ attachmentCount: 3, attachmentBytes: 90, memoryTextBytes: 20 }}
      clear={clear} connectionReady read={{ loading: false, error: null, retry: async () => undefined }} />);
    expect(html).toContain("清除失败，请重试");
    expect(html).toContain("清除全部附件字节");
    expect(html).not.toContain("已清除 3 个附件");
  });
});
