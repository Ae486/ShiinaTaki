import { describe, expect, it, vi } from "vitest";
import { HINDSIGHT_APPLICATION_PART_BYTES, HINDSIGHT_APPLICATION_UPLOAD_BYTES, HINDSIGHT_APPLICATION_RESPONSE_BYTES,
  type TakiApplicationBodyPartReceipt, type TakiApplicationBodyRef } from "@taki/shared";
import { APPLICATION_TEST_SCOPE, APPLICATION_TEST_AT, applicationTestBody } from "../../testing/hindsight-application-fixtures.ts";
import { createHindsightClient, type HindsightTransport } from "./hindsight-client.ts";
import { type HindsightApplicationClient, HindsightApplicationRefusal } from "./hindsight-application-client.ts";
import { prepareHindsightApplicationBody, loadHindsightApplicationBody, uploadHindsightApplicationBody } from "./hindsight-application-body-transfer.ts";
import { hindsightApplicationBytesHash, hindsightApplicationHash, withoutApplicationHash, type HindsightApplicationBody } from "./hindsight-application-integrity.ts";

const scope = APPLICATION_TEST_SCOPE;
const context = { timeoutMs: 5000 };
const block = (content = "fixture") => ({ block_id: "user-card", scope: { kind: "global", characterId: null },
  content, block_revision: 1, updated_at: APPLICATION_TEST_AT, writer: "user", block_contract_version: 1 });

function server(body: HindsightApplicationBody, options: { preload?: boolean; losePartAck?: boolean } = {}) {
  const parts = new Map<number, Uint8Array>(); let sealed = options.preload ?? false; let lost = false;
  if (options.preload) for (let i = 0; i < body.ref.total_parts; i++) parts.set(i, body.bytes.subarray(i * body.ref.part_bytes, (i + 1) * body.ref.part_bytes));
  const transport = vi.fn<HindsightTransport>(async (url, init, limit) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-key");
    expect(limit).toBe(HINDSIGHT_APPLICATION_RESPONSE_BYTES);
    const path = new URL(url).pathname; const method = init?.method ?? "GET";
    const respond = (value: unknown) => ({ status: 200, body: JSON.stringify(value) });
    const partMatch = /\/parts\/(\d+)$/.exec(path);
    if (partMatch) {
      const index = Number(partMatch[1]);
      if (method === "PUT") {
        const request = JSON.parse(String(init?.body)); const bytes = Buffer.from(request.data_base64, "base64");
        expect(request.namespace).toEqual(scope.namespace);
        expect(request.part_sha256).toBe(hindsightApplicationBytesHash(bytes));
        if (parts.has(index)) expect(bytes).toEqual(Buffer.from(parts.get(index)!));
        parts.set(index, bytes);
        if (options.losePartAck && !lost) { lost = true; throw new Error("fixture ACK lost"); }
      }
      const bytes = parts.get(index); if (!bytes) return { status: 404, body: JSON.stringify(refusal("body_not_found")) };
      const receipt = makeReceipt(body.ref, index, bytes);
      return respond(method === "PUT" ? receipt : { ...receipt, data_base64: Buffer.from(bytes).toString("base64") });
    }
    if (path.endsWith("/seal")) {
      expect(parts.size).toBe(body.ref.total_parts); sealed = true; return respond(body.ref);
    }
    return respond({ namespace: scope.namespace, bank_id: scope.bankId, descriptor: body.ref,
      state: sealed ? "sealed" : "uploading", received_parts: parts.size, expires_at: null });
  });
  const client = createHindsightClient({ endpoint: "http://127.0.0.1:18999", resolveApiKey: () => "fixture-key", transport }) as HindsightApplicationClient;
  return { client, transport, parts };
}
function refusal(code: "body_not_found" | "artifact_conflict") {
  return { error: "application_state_error", code, detail: "private provider detail", checkpoint: null, minimum_state_cursor: null };
}
function makeReceipt(ref: TakiApplicationBodyRef, index: number, bytes: Uint8Array): TakiApplicationBodyPartReceipt {
  const receipt = { namespace: scope.namespace, bank_id: scope.bankId, body_id: ref.body_id, part_number: index,
    part_sha256: hindsightApplicationBytesHash(bytes), total_bytes: bytes.byteLength, part_hash: "" };
  receipt.part_hash = hindsightApplicationHash({ ...scope, domain: "part", value: withoutApplicationHash(receipt, "part_hash") });
  return receipt;
}

describe("D77 authenticated multipart transfer", () => {
  it("round-trips a body larger than one HTTP response with exact original characters and complete parts", async () => {
    const value = block("😀".repeat(140000) + "\0\ud800");
    const body = applicationTestBody("application-block.v1", value);
    expect(body.ref.total_bytes).toBeGreaterThan(HINDSIGHT_APPLICATION_RESPONSE_BYTES);
    const remote = server(body);
    await expect(uploadHindsightApplicationBody({ ...scope, client: remote.client, body, context })).resolves.toEqual(body.ref);
    const loaded = await loadHindsightApplicationBody({ ...scope, client: remote.client, ref: body.ref, context });
    expect(loaded.content.value).toEqual(value);
    expect(Buffer.from(loaded.bytes)).toEqual(Buffer.from(body.bytes));
    expect([...remote.parts.values()].every((part) => part.byteLength <= HINDSIGHT_APPLICATION_PART_BYTES)).toBe(true);
    for (const [, init] of remote.transport.mock.calls) {
      if (typeof init?.body === "string") expect(Buffer.byteLength(init.body)).toBeLessThanOrEqual(HINDSIGHT_APPLICATION_RESPONSE_BYTES);
    }
  });

  it("replays immutable parts after an ACK loss using the same body identity", async () => {
    const body = applicationTestBody("application-block.v1", block("x".repeat(400000)));
    const remote = server(body, { losePartAck: true });
    await expect(uploadHindsightApplicationBody({ ...scope, client: remote.client, body, context })).rejects.toThrow("HINDSIGHT_UNREACHABLE");
    expect(remote.parts.size).toBe(1);
    await expect(uploadHindsightApplicationBody({ ...scope, client: remote.client, body, context })).resolves.toEqual(body.ref);
    expect(remote.parts.size).toBe(body.ref.total_parts);
  });

  it("refuses oversized preparation before any transport call and never trims content", () => {
    expect(() => prepareHindsightApplicationBody({ ...scope, schema: "application-block.v1",
      value: block("x".repeat(HINDSIGHT_APPLICATION_UPLOAD_BYTES)) })).toThrow("HINDSIGHT_APPLICATION_PAYLOAD_TOO_LARGE");
  });

  it.each(["namespace", "checksum", "size", "scope-hash", "part-number", "noncanonical-base64"])("rejects a corrupted %s part", async (kind) => {
    const body = applicationTestBody("application-block.v1", block());
    const remote = server(body, { preload: true }); const get = remote.client.applicationBodyPart;
    remote.client.applicationBodyPart = async (input) => {
      const part = await get(input);
      if (kind === "namespace") part.namespace = { ...part.namespace, bank_generation: "33333333-3333-4333-8333-333333333333" };
      if (kind === "checksum") part.part_sha256 = "0".repeat(64);
      if (kind === "size") part.total_bytes++;
      if (kind === "scope-hash") part.part_hash = "0".repeat(64);
      if (kind === "part-number") part.part_number++;
      if (kind === "noncanonical-base64") part.data_base64 += "\n";
      return part;
    };
    await expect(loadHindsightApplicationBody({ ...scope, client: remote.client, ref: body.ref, context })).rejects.toThrow();
  });

  it("refuses supplied typed content that disagrees with its immutable bytes", async () => {
    const body = applicationTestBody("application-block.v1", block());
    const remote = server(body);
    const tampered = { ...body, content: { body_schema: "application-block.v1" as const, value: { ...block(), content: "replacement" } } };
    await expect(uploadHindsightApplicationBody({ ...scope, client: remote.client, body: tampered as HindsightApplicationBody, context })).rejects.toThrow("HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR");
    expect(remote.transport).not.toHaveBeenCalled();
  });

  it("does not publish a completed download after an abort-ignoring callback", async () => {
    const body = applicationTestBody("application-block.v1", block()); const remote = server(body, { preload: true });
    const controller = new AbortController(); const get = remote.client.applicationBodyPart;
    remote.client.applicationBodyPart = async (input) => { const result = await get(input); controller.abort(); return result; };
    await expect(loadHindsightApplicationBody({ ...scope, client: remote.client, ref: body.ref,
      context: { ...context, signal: controller.signal } })).rejects.toThrow("HINDSIGHT_CANCELLED");
  });

  it("keeps typed remote refusals distinct from network failure and drops unsafe detail", async () => {
    const transport = vi.fn<HindsightTransport>(async () => ({ status: 409, body: JSON.stringify(refusal("artifact_conflict")) }));
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:18999", resolveApiKey: () => "fixture-key", transport }) as HindsightApplicationClient;
    const error = await client.initializeApplication({ ...scope, context }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HindsightApplicationRefusal);
    expect((error as HindsightApplicationRefusal).refusal.detail).toBe("artifact_conflict");
    expect(String(error)).not.toContain("private provider detail");
  });

  it("rejects missing authentication before dispatch", async () => {
    const transport = vi.fn<HindsightTransport>();
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:18999", resolveApiKey: () => null, transport }) as HindsightApplicationClient;
    await expect(client.initializeApplication({ ...scope, context })).rejects.toThrow("HINDSIGHT_SECRET_UNAVAILABLE");
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects redirects and a wrong Bank response through the real common client", async () => {
    const body = applicationTestBody("application-block.v1", block());
    const transport = vi.fn<HindsightTransport>(async () => ({ status: 307, body: "" }));
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:18999", resolveApiKey: () => "fixture-key", transport }) as HindsightApplicationClient;
    await expect(client.applicationBody({ ...scope, bodyId: body.ref.body_id, context })).rejects.toThrow("HINDSIGHT_UNREACHABLE");
    transport.mockImplementation(async () => ({ status: 200, body: JSON.stringify({ namespace: scope.namespace, bank_id: "wrong",
      descriptor: body.ref, state: "sealed", received_parts: 1, expires_at: null }) }));
    await expect(client.applicationBody({ ...scope, bodyId: body.ref.body_id, context })).rejects.toThrow("HINDSIGHT_RESPONSE_INVALID");
  });
});
