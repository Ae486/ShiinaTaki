import { describe, expect, it, vi } from "vitest";
import type { ConfigEntry } from "@taki/shared";
import { createKnobDraftController, initialKnobDraft } from "./knob-draft-controller.ts";
import type { ConfigSaveOutcome } from "./config-save-controller.ts";

const ENTRY: ConfigEntry = {
  key: "TAKI_PROVIDER_MODEL", value: "old", stored: true, envLocked: false, default: null,
  apply: "restart", secret: false, secretSet: false, input: { kind: "string" }, description: "Model",
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
function fixture() {
  let state = initialKnobDraft(ENTRY);
  const save = vi.fn(async (_key: string, value: unknown): Promise<ConfigSaveOutcome> => ({ kind: "saved", display: String(value), current: true }));
  let input = { entry: ENTRY, connectionReady: true, onSave: save };
  const controller = createKnobDraftController(input, (next) => { state = next; });
  return {
    controller, save, state: () => state,
    update(entry: ConfigEntry, ready = true) {
      input = { ...input, entry, connectionReady: ready };
      controller.update(input);
    },
  };
}

describe("knob draft ownership", () => {
  it("sends no write on clean focus/blur, including a remote update while focused", () => {
    const f = fixture();
    f.controller.focus();
    f.controller.blur();
    expect(f.save).not.toHaveBeenCalled();
    f.controller.focus();
    f.update({ ...ENTRY, value: "remote" });
    expect(f.state().draft).toBe("old");
    f.controller.blur();
    expect(f.state().draft).toBe("remote");
    expect(f.save).not.toHaveBeenCalled();
  });

  it("preserves dirty same-field edits, blocks conflicted blur, and discards locally with use-latest", () => {
    const f = fixture();
    f.controller.focus();
    f.controller.change("draft");
    f.update({ ...ENTRY, value: "remote" });
    f.controller.blur();
    expect(f.state()).toMatchObject({ draft: "draft", latest: "remote", baseline: "old", dirty: true });
    expect(f.save).not.toHaveBeenCalled();
    f.controller.useLatest();
    expect(f.state()).toMatchObject({ draft: "remote", dirty: false });
    expect(f.save).not.toHaveBeenCalled();
  });

  it("requires an explicit overwrite for a known conflict", async () => {
    const f = fixture();
    f.controller.change("draft");
    f.update({ ...ENTRY, value: "remote" });
    await f.controller.save();
    expect(f.save).not.toHaveBeenCalled();
    await f.controller.save(true);
    expect(f.save).toHaveBeenCalledExactlyOnceWith(ENTRY.key, "draft");
    expect(f.state()).toMatchObject({ draft: "draft", latest: "draft", dirty: false });
  });

  it("does not submit a composing blur or replay it after compositionend", async () => {
    const f = fixture();
    f.controller.focus();
    f.controller.compositionStart();
    f.controller.change("zhong");
    f.controller.blur();
    f.controller.compositionEnd("中文");
    await flush();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.state()).toMatchObject({ draft: "中文", dirty: true, composing: false });
    await f.controller.save();
    expect(f.save).toHaveBeenCalledExactlyOnceWith(ENTRY.key, "中文");
  });

  it.each(["failed", "refused", "retired"] as const)("retains the draft after a %s outcome", async (kind) => {
    const f = fixture();
    f.save.mockResolvedValue(kind === "retired" ? { kind } : { kind, message: "denied" });
    f.controller.change("draft");
    await f.controller.save();
    expect(f.state()).toMatchObject({ draft: "draft", dirty: true, saving: false });
    expect(f.state().error).not.toBeNull();
  });

  it("serializes a save while retaining a newer edit for a deliberate later save", async () => {
    const f = fixture();
    const first = deferred<ConfigSaveOutcome>();
    f.save.mockReturnValueOnce(first.promise);
    f.controller.change("first");
    const done = f.controller.save();
    f.controller.change("newer");
    f.controller.blur();
    expect(f.save).toHaveBeenCalledTimes(1);
    first.resolve({ kind: "saved", display: "first", current: true });
    await done;
    expect(f.state()).toMatchObject({ draft: "newer", baseline: "first", dirty: true, saving: false });
    await flush();
    expect(f.save).toHaveBeenCalledTimes(1);
    await f.controller.save();
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(f.state().dirty).toBe(false);
  });

  it("rechecks field lock and connection at the commit boundary", async () => {
    const f = fixture();
    f.controller.change("draft");
    f.update({ ...ENTRY, envLocked: true });
    await f.controller.save(true);
    expect(f.save).not.toHaveBeenCalled();
    f.update(ENTRY, false);
    await f.controller.save(true);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.state().dirty).toBe(true);
  });

  it("does not write a semantically unchanged number or clear a superseded successful save", async () => {
    const f = fixture();
    const numeric = { ...ENTRY, value: 10, input: { kind: "int" as const } };
    f.update(numeric);
    f.controller.change("010");
    await f.controller.save();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.state().draft).toBe("10");
    f.controller.change("11");
    f.save.mockResolvedValue({ kind: "saved", display: "11", current: false });
    await f.controller.save();
    expect(f.state().dirty).toBe(true);
  });
});
