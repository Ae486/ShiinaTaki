import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEDIA_METHODS } from "@taki/shared";
import { createAttachmentStore, type AttachmentStore } from "../../media/attachment-store.ts";
import type { Connection } from "../connection-registry.ts";
import type { MethodContext } from "../method-registry.ts";
import { mediaUsageMethod } from "./media-usage.ts";

const roots: string[] = [];
function freshStore(): AttachmentStore {
  const root = mkdtempSync(join(tmpdir(), "taki-media-usage-"));
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

describe("mediaUsageMethod (T9, D27)", () => {
  it("is operator-only and named media.usage", () => {
    const def = mediaUsageMethod(freshStore(), () => 0);
    expect(def.method).toBe(MEDIA_METHODS.usage);
    expect(def.roles).toEqual(["operator"]);
  });

  it("composes attachment usage with the injected memory-text byte total", () => {
    const store = freshStore();
    store.save(Buffer.from("hello").toString("base64"), "image/png"); // 5 bytes
    store.save(Buffer.from("world!").toString("base64"), "image/jpeg"); // 6 bytes

    expect(mediaUsageMethod(store, () => 4096).handler({}, ctx())).toEqual({
      attachmentCount: 2,
      attachmentBytes: 11,
      memoryTextBytes: 4096,
    });
  });

  it("reports zeros for an empty store", () => {
    expect(mediaUsageMethod(freshStore(), () => 0).handler({}, ctx())).toEqual({
      attachmentCount: 0,
      attachmentBytes: 0,
      memoryTextBytes: 0,
    });
  });
});
