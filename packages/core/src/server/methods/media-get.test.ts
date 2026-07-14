import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSONRPCErrorException } from "json-rpc-2.0";
import { JSON_RPC_APP_ERROR, MEDIA_METHODS } from "@taki/shared";
import { createAttachmentStore, type AttachmentStore } from "../../media/attachment-store.ts";
import type { Connection } from "../connection-registry.ts";
import type { MethodContext } from "../method-registry.ts";
import { mediaGetMethod } from "./media-get.ts";

const roots: string[] = [];
function freshStore(): AttachmentStore {
  const root = mkdtempSync(join(tmpdir(), "taki-media-get-"));
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

function catchFrom(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe("mediaGetMethod (T9)", () => {
  it("is operator-only and named media.get", () => {
    const def = mediaGetMethod(freshStore());
    expect(def.method).toBe(MEDIA_METHODS.get);
    expect(def.roles).toEqual(["operator"]);
  });

  it("returns the saved bytes + media type for a valid ref", () => {
    const store = freshStore();
    const bytes = Buffer.from("hello").toString("base64");
    const { ref } = store.save(bytes, "image/webp");

    expect(mediaGetMethod(store).handler({ ref }, ctx())).toEqual({ mediaType: "image/webp", dataBase64: bytes });
  });

  it("rejects a regex-invalid / traversal ref as a FORBIDDEN app error (the confinement is single-sourced in read)", () => {
    const def = mediaGetMethod(freshStore());
    for (const ref of ["../../etc/passwd", `attachments/${"A".repeat(64)}.png`]) {
      const thrown = catchFrom(() => def.handler({ ref }, ctx()));
      // The refusal must ride the app-error envelope (JSON_RPC_APP_ERROR + data.code) — never the INTERNAL_ERROR path.
      expect(thrown).toBeInstanceOf(JSONRPCErrorException);
      expect((thrown as JSONRPCErrorException).code).toBe(JSON_RPC_APP_ERROR);
      expect(((thrown as JSONRPCErrorException).data as { code: string }).code).toBe("FORBIDDEN");
      expect((thrown as JSONRPCErrorException).message).toMatch(/invalid attachment ref/);
    }
  });

  it("rejects a well-formed but missing ref (GC-swept / never existed)", () => {
    const def = mediaGetMethod(freshStore());
    expect(() => def.handler({ ref: `attachments/${"c".repeat(64)}.png` }, ctx())).toThrow(/attachment not found/);
  });
});
