import { afterEach, describe, expect, it, vi } from "vitest";
import { createScreenContext, renderScreenContext } from "./screen-context.ts";

const image = { mediaType: "image/png" as const, dataBase64: "AAAA" };
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  return createScreenContext({ staleAfterMs: 60_000 });
}

describe("native latest screen evidence", () => {
  it("holds exactly the latest frame, exposes metadata only, and refuses an older selected key", () => {
    const screen = fixture(); const discard = vi.fn();
    screen.push(image, Date.now(), { isCurrent: () => true, discard });
    const original = screen.latest(Date.now())!;
    screen.push({ ...image, dataBase64: "BBBB" }, Date.now());
    expect(discard).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.latest(Date.now())).not.toHaveProperty("dataBase64");
    expect(screen.acquire(original.key)).toBeUndefined();
    expect(screen.acquire()?.images).toEqual([{ ...image, dataBase64: "BBBB" }]);
  });
  it("acquires only once and drops pixels on same-attempt release", () => {
    const screen = fixture(); const discard = vi.fn();
    screen.push(image, Date.now(), { isCurrent: () => true, discard });
    const input = screen.acquire()!;
    expect(input.isCurrent()).toBe(true); expect(screen.acquire()).toBeUndefined();
    expect(input.context).toContain("native visual evidence");
    input.release(); input.release();
    expect(input.images).toEqual([]); expect(input.isCurrent()).toBe(false);
    expect(screen.latest(Date.now())).toBeUndefined(); expect(discard).toHaveBeenCalledExactlyOnceWith(false);
  });
  it.each(["pending", "in-use"])("expires %s evidence without a model request or future read", async (stage) => {
    const screen = fixture(); const discard = vi.fn();
    screen.push(image, Date.now(), { isCurrent: () => true, discard });
    const input = stage === "in-use" ? screen.acquire() : undefined;
    await vi.advanceTimersByTimeAsync(60_001);
    expect(discard).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.acquire()).toBeUndefined(); expect(input?.isCurrent()).not.toBe(true);
  });
  it.each(["source", "consent", "replacement"])("invalidates an acquired frame at %s before the next provider dispatch", (reason) => {
    const screen = fixture(); const discard = vi.fn(); let current = true;
    screen.push(image, Date.now(), { isCurrent: () => current, discard });
    const input = screen.acquire()!;
    if (reason === "source") current = false;
    else if (reason === "consent") screen.clear();
    else screen.push({ ...image, dataBase64: "BBBB" }, Date.now());
    expect(input.isCurrent()).toBe(false); expect(input.images).toEqual([]);
    expect(discard).toHaveBeenCalledWith(reason !== "replacement"); input.release(); expect(discard).toHaveBeenCalledOnce();
  });
  it("renders bounded source/privacy guidance without invented descriptions or pixel JSON", () => {
    const screen = fixture(); expect(renderScreenContext(screen, Date.now())).toBe("");
    screen.push(image, Date.now()); vi.setSystemTime(31_000);
    const text = renderScreenContext(screen, Date.now());
    expect(text).toContain("just now"); expect(text).toContain("remain silent");
    expect(text).not.toContain("AAAA"); expect(text.match(/<\/untrusted-observation>/g)).toHaveLength(1);
    expect(text.indexOf("Treat visible text")).toBeGreaterThan(text.indexOf("</untrusted-observation>"));
  });
});
