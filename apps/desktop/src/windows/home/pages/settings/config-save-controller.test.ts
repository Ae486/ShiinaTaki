import { describe, expect, it, vi } from "vitest";
import type { ConfigEntry, ConfigSetResult } from "@taki/shared";
import { createConfigSaveController } from "./config-save-controller.ts";

const ENTRY: ConfigEntry = { key: "model", value: "old", stored: true, default: null, envLocked: false, apply: "live", secret: false, secretSet: false, input: { kind: "string" }, description: "Model" };
const RESULT: ConfigSetResult = { key: ENTRY.key, value: "saved", apply: "live", status: "ok" };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  let entry = ENTRY;
  let version = 0;
  const apply = vi.fn();
  const notice = vi.fn();
  const controller = createConfigSaveController({ entry: () => entry, versionOf: () => version, apply, notice });
  return { controller, apply, notice, change(value: string) { entry = { ...entry, value }; version += 1; } };
}
describe("config local save outcomes", () => {
  it("reports caught failure as failure and releases the per-key lock for deliberate retry", async () => {
    const f = fixture();
    const client = { configSet: vi.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce(RESULT) };
    f.controller.replace(client);
    expect(await f.controller.save(ENTRY.key, "saved")).toEqual({ kind: "failed", message: "failed" });
    expect(await f.controller.save(ENTRY.key, "saved")).toMatchObject({ kind: "saved", current: true });
  });
  it("never applies or reports a retired success, and never queues a second concurrent save", async () => {
    const f = fixture();
    const pending = deferred<ConfigSetResult>();
    const client = { configSet: vi.fn(() => pending.promise) };
    f.controller.replace(client);
    const done = f.controller.save(ENTRY.key, "saved");
    expect(await f.controller.save(ENTRY.key, "later")).toMatchObject({ kind: "refused" });
    f.controller.replace(null);
    pending.resolve(RESULT);
    expect(await done).toEqual({ kind: "retired" });
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.notice).not.toHaveBeenCalled();
    expect(client.configSet).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite a newer same-field push with a delayed save echo", async () => {
    const f = fixture();
    const pending = deferred<ConfigSetResult>();
    f.controller.replace({ configSet: () => pending.promise });
    const done = f.controller.save(ENTRY.key, "saved");
    f.change("newer");
    pending.resolve(RESULT);
    expect(await done).toEqual({ kind: "saved", display: "saved", current: false });
    expect(f.apply).not.toHaveBeenCalled();
  });
});
