import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEDIA_METHODS } from "@taki/shared";
import { createAttachmentStore, type AttachmentStore } from "../../media/attachment-store.ts";
import type { Connection } from "../connection-registry.ts";
import type { MethodContext } from "../method-registry.ts";
import { mediaClearMethod } from "./media-clear.ts";

const roots: string[] = [];
function freshStore(): AttachmentStore {
  const root = mkdtempSync(join(tmpdir(), "taki-media-clear-"));
  roots.push(root);
  return createAttachmentStore({ attachmentsDir: join(root, "attachments") });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function ctx(): MethodContext {
  const connection: Connection = {
    state: { status: "authenticated", deviceId: "d1", role: "operator", capabilities: [] },
  };
  return { notify: () => undefined, connection, close: () => undefined, onClose: () => undefined };
}

describe("mediaClearMethod (T9)", () => {
  it("is operator-only and named media.clear", () => {
    const def = mediaClearMethod(freshStore());
    expect(def.method).toBe(MEDIA_METHODS.clear);
    expect(def.roles).toEqual(["operator"]);
  });

  it("purges every retained attachment and reports what it freed", () => {
    const store = freshStore();
    store.save(Buffer.from("hello").toString("base64"), "image/png"); // 5 bytes
    store.save(Buffer.from("world!").toString("base64"), "image/jpeg"); // 6 bytes

    expect(mediaClearMethod(store).handler({}, ctx())).toEqual({ removedCount: 2, freedBytes: 11 });
    expect(store.usage()).toEqual({ count: 0, bytes: 0 });
  });

  it("is a no-op on an empty store", () => {
    expect(mediaClearMethod(freshStore()).handler({}, ctx())).toEqual({ removedCount: 0, freedBytes: 0 });
  });
});
