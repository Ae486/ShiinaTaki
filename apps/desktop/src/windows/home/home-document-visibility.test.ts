import { describe, expect, it, vi } from "vitest";
import { observeHomeDocumentVisibility } from "./home-document-visibility.ts";

describe("Home document read visibility", () => {
  it("uses actual document visibility, never window focus, and cleans up the one listener", () => {
    let handler: () => void = () => undefined;
    const source = {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: vi.fn((_event: string, next: () => void) => { handler = next; }),
      removeEventListener: vi.fn(),
    };
    const publish = vi.fn();
    const dispose = observeHomeDocumentVisibility(source, publish);
    expect(source.addEventListener).toHaveBeenCalledExactlyOnceWith("visibilitychange", handler);
    expect(publish).toHaveBeenLastCalledWith(true);
    source.visibilityState = "hidden";
    handler();
    expect(publish).toHaveBeenLastCalledWith(false);
    source.visibilityState = "visible";
    handler();
    expect(publish).toHaveBeenLastCalledWith(true);
    dispose();
    expect(source.removeEventListener).toHaveBeenCalledWith("visibilitychange", handler);
  });
});
