import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, FocusEvent, KeyboardEvent } from "react";
import { ToastCard } from "./toast-card.tsx";

const lifetime = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), hold: vi.fn() }));
vi.mock("./toast-lifetime.ts", () => ({ createToastLifetime: () => lifetime }));

function capture() {
  let props: ComponentProps<"div"> | undefined;
  function Probe() {
    const element = ToastCard({ toast: { id: "test-event", tone: "success", message: "Saved" } });
    props = element.props;
    return element;
  }
  const html = renderToStaticMarkup(<Probe />);
  if (!props) throw new Error("Card did not render");
  return { props, html };
}

beforeEach(() => vi.clearAllMocks());

describe("Toast keyboard reading controls", () => {
  it("makes the selectable notice and its close control keyboard reachable", () => {
    const { props, html } = capture();
    expect(props.tabIndex).toBe(0);
    expect(html).toContain("select-text");
    expect(html).toContain('aria-label="关闭通知"');
    props.onFocusCapture?.({} as FocusEvent<HTMLDivElement>);
    expect(lifetime.pause).toHaveBeenCalledWith("focus");
    const currentTarget = { contains: vi.fn(() => true) };
    props.onBlurCapture?.({ currentTarget, relatedTarget: {} } as unknown as FocusEvent<HTMLDivElement>);
    expect(lifetime.resume).not.toHaveBeenCalled();
    currentTarget.contains.mockReturnValue(false);
    props.onBlurCapture?.({ currentTarget, relatedTarget: null } as unknown as FocusEvent<HTMLDivElement>);
    expect(lifetime.resume).toHaveBeenCalledWith("focus");
  });

  it("holds on deliberate keyboard activation without intercepting a nested close button", () => {
    const { props } = capture();
    const target = {};
    const preventDefault = vi.fn();
    for (const key of ["Enter", " "]) {
      props.onKeyDown?.({ key, target, currentTarget: target, preventDefault } as unknown as KeyboardEvent<HTMLDivElement>);
    }
    expect(lifetime.hold).toHaveBeenCalledTimes(2);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    props.onKeyDown?.({ key: "Enter", target: {}, currentTarget: target, preventDefault } as unknown as KeyboardEvent<HTMLDivElement>);
    expect(lifetime.hold).toHaveBeenCalledTimes(2);
  });
});
