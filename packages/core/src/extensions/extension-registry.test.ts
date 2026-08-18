import type { ToolExecutionOptions } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createExtensionRegistry, type ExtensionCandidate } from "./extension-registry.ts";
import { createExtensionTools } from "./extension-tools.ts";

const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOST_A = "11111111-1111-4111-8111-111111111111";
const HOST_B = "22222222-2222-4222-8222-222222222222";
const options = { toolCallId: "call-1", messages: [] } as unknown as ToolExecutionOptions<unknown>;

function candidate(overrides: Partial<ExtensionCandidate> = {}): ExtensionCandidate {
  return {
    identity: {
      kind: "capability",
      ownerHostId: HOST_A,
      subjectId: "screen.capture",
      subjectRevision: "descriptor.1",
      connectionGeneration: 2,
      catalogGeneration: 3,
    },
    displayName: "Screen capture",
    summary: "Capture the current screen",
    callMode: "capability",
    call: async (input) => ({ captured: input }),
    ...overrides,
  };
}

function registry(candidates: ExtensionCandidate[], budget = { maxEntries: 8, maxDescriptionChars: 128, maxSearchResults: 4, maxCalls: 2 }) {
  return createExtensionRegistry({
    runId: RUN,
    primaryHostId: HOST_A,
    hosts: [{ hostId: HOST_A, available: true, connectionGeneration: 2, catalogGeneration: 3, extensionCount: candidates.length }],
    candidates,
    budget,
  });
}

describe("extension registry", () => {
  it("builds deterministic host-qualified ids and rejects every colliding candidate", () => {
    const first = candidate();
    const duplicate = candidate({ displayName: "Duplicate" });
    const remote = candidate({ identity: { ...first.identity, ownerHostId: HOST_B } });
    const built = registry([first, duplicate, remote]);

    expect(built.snapshot.entries).toHaveLength(1);
    expect(built.snapshot.entries[0]?.identity.ownerHostId).toBe(HOST_B);
    expect(built.snapshot.collisions.length).toBeGreaterThan(0);
    expect(registry([remote]).snapshot.entries[0]?.identity.extensionId)
      .toBe(built.snapshot.entries[0]?.identity.extensionId);
  });

  it("freezes and bounds the Run snapshot while filtering only captured metadata", () => {
    const built = registry([
      candidate(),
      candidate({ identity: { ...candidate().identity, ownerHostId: HOST_B, subjectId: "process.list" }, displayName: "Processes" }),
    ], { maxEntries: 1, maxDescriptionChars: 12, maxSearchResults: 1, maxCalls: 1 });

    expect(Object.isFrozen(built.snapshot)).toBe(true);
    expect(Object.isFrozen(built.snapshot.entries)).toBe(true);
    expect(built.snapshot.entries).toHaveLength(1);
    expect(built.snapshot.entries[0]?.summary.length).toBeLessThanOrEqual(12);
    expect(built.discover({ query: "screen" }).truncated).toBe(true);
    const selectedHost = built.snapshot.entries[0]!.identity.ownerHostId;
    const absentHost = selectedHost === HOST_A ? HOST_B : HOST_A;
    expect(built.discover({ ownerHostId: selectedHost }).entries).toHaveLength(1);
    expect(built.discover({ ownerHostId: absentHost }).entries).toEqual([]);
  });

  it("calls only the captured binding and preserves bounded stale/failure outcomes", async () => {
    const call = vi.fn(async () => ({ ok: true, value: 7 }));
    let current = true;
    const built = registry([candidate({ call, isCurrent: () => current })]);
    const extensionId = built.snapshot.entries[0]!.identity.extensionId;

    await expect(built.call({ extensionId, input: { x: 1 } }, options)).resolves.toMatchObject({ ok: true, output: { ok: true, value: 7 } });
    current = false;
    await expect(built.call({ extensionId, input: {} }, options)).resolves.toMatchObject({ ok: false, code: "EXTENSION_STALE_GENERATION", owner: built.snapshot.entries[0]!.identity });
    expect(call).toHaveBeenCalledTimes(1);
    await expect(built.call({ extensionId: "ext:missing", input: {} }, options)).resolves.toEqual({
      ok: false,
      code: "EXTENSION_NOT_FOUND",
      message: "the extension id is not present in this Run snapshot",
    });
  });

  it("enforces one shared call budget and exposes exactly three bridge tools", async () => {
    const built = registry([candidate()], { maxEntries: 2, maxDescriptionChars: 64, maxSearchResults: 2, maxCalls: 1 });
    const extensionId = built.snapshot.entries[0]!.identity.extensionId;
    await built.call({ extensionId, input: {} }, options);
    await expect(built.call({ extensionId, input: {} }, options)).resolves.toMatchObject({ ok: false, code: "EXTENSION_CALL_LIMIT_EXCEEDED" });
    expect(Object.keys(createExtensionTools(built))).toEqual(["extension_discover", "extension_describe", "extension_call"]);
  });
});
