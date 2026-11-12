import type { ToolExecutionOptions } from "ai";
import { describe, expect, it, vi } from "vitest";
import { ExtensionDescribeResultSchema } from "@taki/shared";
import { createExtensionRegistry, type ExtensionCandidate } from "./extension-registry.ts";
import { createExtensionTools } from "./extension-tools.ts";

const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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

function registry(candidates: ExtensionCandidate[], budget = { maxEntries: 8, maxDescriptionChars: 128, maxSearchResults: 4, maxCalls: 2 }, runId = RUN) {
  return createExtensionRegistry({
    runId,
    primaryHostId: HOST_A,
    hosts: [{ hostId: HOST_A, available: true, connectionGeneration: 2, catalogGeneration: 3, extensionCount: candidates.length }],
    candidates,
    budget,
  });
}

describe("extension registry", () => {
  it("describes the exact captured direct MCP name without including schemas in metadata", () => {
    const built = registry([mcpCandidate()]);
    const extensionId = built.snapshot.entries[0]!.identity.extensionId;
    const result = built.describe({ extensionId });

    expect(ExtensionDescribeResultSchema.parse(result)).toEqual({
      runId: RUN, entry: built.snapshot.entries[0], toolName: "server_exact_echo",
    });
    expect(Object.keys(result).sort()).toEqual(["entry", "runId", "toolName"]);
    expect(Object.keys(built.discover({}).entries[0]!).sort())
      .toEqual(["available", "callMode", "displayName", "identity", "modelKey", "summary"]);
    expect(built.renderContext()).not.toContain("server_exact_echo");
    expect(built.describe({ extensionId: "ext:missing" })).toEqual({ runId: RUN, entry: null });
  });

  it("discloses no direct name after the captured MCP generation retires", () => {
    let current = true;
    const built = registry([mcpCandidate({ isCurrent: () => current })]);
    const extensionId = built.snapshot.entries[0]!.identity.extensionId;
    expect(built.describe({ extensionId }).toolName).toBe("server_exact_echo");

    current = false;
    expect(built.describe({ extensionId })).toEqual({ runId: RUN, entry: built.snapshot.entries[0] });
  });

  it.each([
    { available: false },
    { call: undefined },
    { isCurrent: undefined },
    { callMode: "capability" as const },
    { modelToolName: "../invalid" },
    { modelToolName: "x".repeat(257) },
  ])("does not disclose an unbound or invalid MCP name: %j", (overrides) => {
    const built = registry([mcpCandidate(overrides)]);
    expect(built.describe({ extensionId: built.snapshot.entries[0]!.identity.extensionId }).toolName).toBeUndefined();
  });

  it("detaches model names and governed callbacks from mutable caller candidates", async () => {
    const call = vi.fn(async () => ({ binding: "captured" }));
    const replacement = vi.fn(async () => ({ binding: "replacement" }));
    let current = true;
    const input = { ...mcpCandidate({ call, isCurrent: () => current }) };
    const built = registry([input]);
    const extensionId = built.snapshot.entries[0]!.identity.extensionId;
    input.modelToolName = "unrelated_tool";
    input.call = replacement;
    input.isCurrent = () => true;

    expect(built.describe({ extensionId }).toolName).toBe("server_exact_echo");
    await expect(built.call({ extensionId, input: {} }, options))
      .resolves.toMatchObject({ ok: true, output: { binding: "captured" } });
    current = false;
    expect(built.describe({ extensionId }).toolName).toBeUndefined();
    expect(call).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });

  it("reads the caller-owned direct name only once during capture", () => {
    const name = vi.fn(() => "server_exact_echo");
    const input = mcpCandidate();
    Object.defineProperty(input, "modelToolName", { enumerable: true, get: name });
    const built = registry([input]);
    const extensionId = built.snapshot.entries[0]!.identity.extensionId;
    name.mockReturnValue("replacement");

    expect(built.describe({ extensionId }).toolName).toBe("server_exact_echo");
    expect(built.describe({ extensionId }).toolName).toBe("server_exact_echo");
    expect(name).toHaveBeenCalledOnce();
  });

  it("refuses every descriptor that collides on an exact direct MCP name", () => {
    const first = mcpCandidate();
    const second = mcpCandidate({ identity: { ...first.identity, subjectId: "mcp.other" } });
    const built = registry([first, second]);

    expect(built.snapshot.entries).toEqual([]);
    expect(built.snapshot.collisions).toHaveLength(1);
    for (const input of [first, second]) {
      const extensionId = registry([input]).snapshot.entries[0]!.identity.extensionId;
      expect(built.describe({ extensionId })).toEqual({ runId: RUN, entry: null });
    }
  });

  it("keeps model context stable across Runs while preserving each captured authority", async () => {
    const firstCall = vi.fn(async () => ({ binding: "first" }));
    const secondCall = vi.fn(async () => ({ binding: "second" }));
    const first = registry([candidate({ call: firstCall })], undefined, RUN);
    const second = registry([candidate({ call: secondCall })], undefined, OTHER_RUN);
    const extensionId = first.snapshot.entries[0]!.identity.extensionId;

    expect(first.renderContext()).toBe(second.renderContext());
    expect(first.renderContext()).not.toContain(RUN);
    expect(second.renderContext()).not.toContain(OTHER_RUN);
    expect(first.snapshot.runId).toBe(RUN);
    expect(second.snapshot.runId).toBe(OTHER_RUN);
    expect(first.discover({}).runId).toBe(RUN);
    expect(second.describe({ extensionId }).runId).toBe(OTHER_RUN);

    await expect(first.call({ extensionId, input: { registry: "first" } }, options))
      .resolves.toMatchObject({ ok: true, output: { binding: "first" } });
    await expect(second.call({ extensionId, input: { registry: "second" } }, options))
      .resolves.toMatchObject({ ok: true, output: { binding: "second" } });
    expect(firstCall).toHaveBeenCalledOnce();
    expect(secondCall).toHaveBeenCalledOnce();
  });

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

function mcpCandidate(overrides: Partial<ExtensionCandidate> = {}): ExtensionCandidate {
  return candidate({
    identity: { ...candidate().identity, kind: "mcp-tool", subjectId: "mcp.echo" },
    callMode: "mcp-tool",
    modelToolName: "server_exact_echo",
    isCurrent: () => true,
    ...overrides,
  });
}
