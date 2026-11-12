import { describe, expect, it, vi } from "vitest";
import type { CharacterImportResult } from "@taki/shared";
import { createCharacterImportController } from "./character-import-controller.ts";

const RESULT: CharacterImportResult = { characterId: "taki", costumes: ["summer"], defaultCostume: "summer",
  settingsFilesByCostume: { summer: "model.json" }, warnings: ["Optional motion missing"] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const sink = { changed: vi.fn(), started: vi.fn(), succeeded: vi.fn(), failed: vi.fn() };
  return { sink, controller: createCharacterImportController(sink) };
}

describe("Character import attempt feedback", () => {
  it("clears an earlier success and warnings before a later unsupported pick is refused", async () => {
    const { controller, sink } = fixture();
    const client = { importCharacter: vi.fn(async () => RESULT) };
    controller.replace(client);
    await controller.importFile(new File(["archive"], "taki.zip"));
    expect(sink.succeeded).toHaveBeenCalledTimes(1);
    expect(sink.changed).toHaveBeenLastCalledWith({ isImporting: false, result: RESULT, error: null });
    await controller.importFile(new File(["wrong"], "readme.txt"));
    expect(sink.changed).toHaveBeenLastCalledWith({ isImporting: false, result: null, error: "「readme.txt」不是 .zip 或 .zst 归档" });
    expect(sink.failed).toHaveBeenCalledTimes(1);
    expect(client.importCharacter).toHaveBeenCalledTimes(1);
  });

  it("reports distinct identical successful attempts once each without replay on replacement", async () => {
    const { controller, sink } = fixture();
    const client = { importCharacter: vi.fn(async () => RESULT) };
    controller.replace(client);
    await controller.importFile(new File(["archive"], "taki.zip"));
    await controller.importFile(new File(["archive"], "taki.zip"));
    expect(sink.succeeded).toHaveBeenCalledTimes(2);
    expect(sink.succeeded.mock.calls[0]?.[1]).not.toBe(sink.succeeded.mock.calls[1]?.[1]);
    controller.replace(client);
    expect(sink.succeeded).toHaveBeenCalledTimes(2);
  });

  it("serializes a pending import and ignores a retired client's success and failure", async () => {
    for (const failed of [false, true]) {
      const { controller, sink } = fixture();
      const pending = deferred<CharacterImportResult>();
      const client = { importCharacter: vi.fn(() => pending.promise) };
      controller.replace(client);
      const done = controller.importFile(new File(["archive"], "taki.zip"));
      await vi.waitFor(() => expect(client.importCharacter).toHaveBeenCalledTimes(1));
      await controller.importFile(new File(["again"], "taki.zip"));
      expect(client.importCharacter).toHaveBeenCalledTimes(1);
      controller.replace(null);
      if (failed) pending.reject(new Error("retired")); else pending.resolve(RESULT);
      await done;
      expect(sink.succeeded).not.toHaveBeenCalled();
      expect(sink.failed).not.toHaveBeenCalled();
      expect(sink.changed.mock.lastCall?.[0]).toMatchObject({ isImporting: false, result: null });
    }
  });

  it("does not send bytes if the client retires while the file is being read", async () => {
    const { controller, sink } = fixture();
    const fileRead = deferred<ArrayBuffer>();
    const file = new File(["archive"], "taki.zip");
    vi.spyOn(file, "arrayBuffer").mockReturnValue(fileRead.promise);
    const client = { importCharacter: vi.fn(async () => RESULT) };
    controller.replace(client);
    const done = controller.importFile(file);
    controller.replace(null);
    fileRead.resolve(new ArrayBuffer(1));
    await done;
    expect(client.importCharacter).not.toHaveBeenCalled();
    expect(sink.succeeded).not.toHaveBeenCalled();
  });

  it.each([false, true])("retains an unconfirmed submitted import through reconnection and late failure=%s", async (failed) => {
    const { controller, sink } = fixture();
    const pending = deferred<CharacterImportResult>();
    const original = { importCharacter: vi.fn(() => pending.promise) };
    const replacement = { importCharacter: vi.fn(async () => RESULT) };
    controller.replace(original);
    const done = controller.importFile(new File(["archive"], "taki.zip"));
    await vi.waitFor(() => expect(original.importCharacter).toHaveBeenCalledTimes(1));
    controller.replace(null);
    const unconfirmed = sink.changed.mock.lastCall?.[0].error;
    expect(unconfirmed).toContain("导入结果尚未确认");
    controller.replace(replacement);
    if (failed) pending.reject(new Error("retired")); else pending.resolve(RESULT);
    await done;
    expect(sink.changed).toHaveBeenLastCalledWith({ isImporting: false, result: null, error: unconfirmed });
    expect(replacement.importCharacter).not.toHaveBeenCalled();
    expect(sink.succeeded).not.toHaveBeenCalled();
    expect(sink.failed).not.toHaveBeenCalled();
    await controller.importFile(new File(["archive"], "taki.zip"));
    expect(replacement.importCharacter).toHaveBeenCalledTimes(1);
    expect(sink.changed).toHaveBeenLastCalledWith({ isImporting: false, result: RESULT, error: null });
    controller.dispose();
  });
});
