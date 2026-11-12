import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelProviderLogo } from "./model-provider-logo.tsx";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: vi.fn(actual.useState) };
});
const logoUrl = "https://models.dev/logos/deepseek.svg";
const setFailedUrl = vi.fn();
beforeEach(() => {
  setFailedUrl.mockClear();
  vi.mocked(React.useState).mockReturnValue([null, setFailedUrl]);
});

describe("provider image fallback", () => {
  it("uses readable brand alt text and does not send a referrer", () => {
    const html = renderToStaticMarkup(<ModelProviderLogo logoUrl={logoUrl} providerName="DeepSeek" />);
    expect(html).toContain(`src="${logoUrl}"`);
    expect(html).toContain('alt="DeepSeek标识"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  it("uses a local accessible generic symbol when no artwork exists", () => {
    const html = renderToStaticMarkup(<ModelProviderLogo logoUrl={null} providerName={null} />);
    expect(html).toContain('aria-label="通用模型图标"');
    expect(html).toContain("<svg");
    expect(html).not.toContain("<img");
  });

  it("retires a failed image source to the local symbol without retrying it on render", () => {
    const tree = ModelProviderLogo({ logoUrl, providerName: "DeepSeek" });
    expect(tree.type).toBe("img");
    if (!React.isValidElement<{ onError: () => void }>(tree)) throw new Error("image was not rendered");
    tree.props.onError();
    expect(setFailedUrl).toHaveBeenCalledExactlyOnceWith(logoUrl);
    vi.mocked(React.useState).mockReturnValue([logoUrl, setFailedUrl]);
    const html = renderToStaticMarkup(<ModelProviderLogo logoUrl={logoUrl} providerName="DeepSeek" />);
    expect(html).toContain('aria-label="通用模型图标"');
    expect(html).not.toContain("<img");
  });

  it("allows a replacement provider's image after an older URL failed", () => {
    vi.mocked(React.useState).mockReturnValue([logoUrl, setFailedUrl]);
    const html = renderToStaticMarkup(<ModelProviderLogo logoUrl="https://models.dev/logos/openai.svg" providerName="OpenAI" />);
    expect(html).toContain('src="https://models.dev/logos/openai.svg"');
    expect(html).toContain('alt="OpenAI标识"');
  });
});
