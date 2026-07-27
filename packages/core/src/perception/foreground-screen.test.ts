import { describe, expect, it, vi } from "vitest";
import type { RouteResult } from "../capabilities/route-capability.ts";
import { foregroundKey, screenForegroundNow, FOREGROUND_CAPABILITY } from "./foreground-screen.ts";
import { createSensitiveProcessCheck } from "./sensitive-processes.ts";

const isSensitive = createSensitiveProcessCheck();

function screen(result: RouteResult) {
  const route = vi.fn(async (): Promise<RouteResult> => result);
  return { route, run: () => screenForegroundNow({ route, isSensitive }) };
}

const sample = (processName: string | null, windowTitle: string | null, available = true) => ({
  ok: true as const,
  output: { available, processName, windowTitle, idleSeconds: 0 },
});

describe("screenForegroundNow", () => {
  it("routes the EXISTING foreground-window capability (no new collection) and reports the live identity", async () => {
    const { route, run } = screen(sample("Code.exe", "main.ts"));
    await expect(run()).resolves.toEqual({ status: "clear", key: foregroundKey("Code.exe", "main.ts") });
    expect(route).toHaveBeenCalledWith(FOREGROUND_CAPABILITY, {});
  });

  it("scrubs the live title into the identity, so it matches the entry T3a stores and carries no PII", async () => {
    const { run } = screen(sample("Thunderbird", "Re: invoice — alice@example.com"));
    const screened = await run();
    expect(screened).toEqual({ status: "clear", key: foregroundKey("Thunderbird", "Re: invoice — [redacted:email]") });
    expect(JSON.stringify(screened)).not.toContain("alice@example.com");
  });

  it("reports a sensitive app WITHOUT naming it", async () => {
    const { run } = screen(sample("1Password", "Chase Visa"));
    const screened = await run();
    expect(screened).toEqual({ status: "sensitive" });
    expect(JSON.stringify(screened)).not.toContain("1Password");
  });

  it("fails closed on every shape it cannot read", async () => {
    // No focused window, no process name, a schema miss and a routed failure are ONE outcome: we did not look.
    await expect(screen(sample("Code.exe", "main.ts", false)).run()).resolves.toEqual({ status: "unscreenable" });
    await expect(screen(sample(null, "main.ts")).run()).resolves.toEqual({ status: "unscreenable" });
    await expect(screen({ ok: true, output: { nope: 1 } }).run()).resolves.toEqual({ status: "unscreenable" });
    await expect(
      screen({ ok: false, code: "CAPABILITY_TIMEOUT", message: "timeout" }).run(),
    ).resolves.toEqual({ status: "unscreenable" });
    await expect(screen({ ok: false, code: "NO_NODE", message: "offline" }).run()).resolves.toEqual({
      status: "unscreenable",
    });
  });

  it("reports a denial distinctly — the caller can never satisfy its precondition again", async () => {
    await expect(screen({ ok: false, code: "DENIED", message: "denied" }).run()).resolves.toEqual({
      status: "denied",
    });
  });

  it("keeps a null title and a titled window apart, and cannot be spoofed by a title that mimics the separator", async () => {
    const { run } = screen(sample("Code.exe", null));
    await expect(run()).resolves.toEqual({ status: "clear", key: foregroundKey("Code.exe", "") });
    expect(foregroundKey("app", "a b")).not.toBe(foregroundKey("app a", "b"));
  });
});
