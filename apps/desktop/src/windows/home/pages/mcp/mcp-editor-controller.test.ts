import { describe, expect, it, vi } from "vitest";
import type { McpServerView } from "@taki/shared";
import type { McpEditorMutationResult } from "./mcp-controller.ts";
import { createMcpEditor, initialMcpEditor, type McpEditorState } from "./mcp-editor-controller.ts";

const server: McpServerView = {
  serverId: "github", ownerHostId: "11111111-1111-4111-8111-111111111111", config: { command: "node" },
  enabled: true, selectedTools: [], configRevision: 7,
  createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z",
  status: { serverId: "github", phase: "connected", runtimeGeneration: 1, leaseCount: 0, toolCount: 0, lastOutcome: null },
};

function fixture() {
  let state: McpEditorState = initialMcpEditor();
  const editor = createMcpEditor((next) => { state = next; });
  let resolve!: (result: McpEditorMutationResult) => void;
  const pending = new Promise<McpEditorMutationResult>((accept) => { resolve = accept; });
  const edit = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ ok: true, committedRevision: 9 });
  const add = vi.fn().mockReturnValueOnce(pending);
  return { editor, state: () => state, resolve, input: { servers: [server], add, edit } };
}

describe("MCP editor save ownership", () => {
  it("keeps edits made during a save and uses only that commit's revision on the next explicit save", async () => {
    const { editor, state, resolve, input } = fixture();
    editor.startEdit(server);
    editor.setDraft({ ...state().draft!, command: "submitted" });
    const done = editor.save(input);
    editor.setDraft({ ...state().draft!, command: "newer" });
    resolve({ ok: true, committedRevision: 8 });
    await done;
    expect(state()).toMatchObject({ draft: { command: "newer" }, editingRevision: 8 });
    expect(input.edit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ command: "submitted" }), 7);
    input.servers = [{ ...server, configRevision: 999 }];
    expect(state().editingRevision).toBe(8);
    await editor.save(input);
    expect(input.edit).toHaveBeenLastCalledWith(expect.objectContaining({ command: "newer" }), 8);
    expect(state().draft).toBeNull();
  });

  it.each([true, false])("does not clear or advance a newly opened editor from an older saved=%s result", async (ok) => {
    const { editor, state, resolve, input } = fixture();
    editor.startEdit(server);
    const done = editor.save(input);
    editor.clearEditor();
    editor.startEdit({ ...server, configRevision: 20 });
    editor.setDraft({ ...state().draft!, command: "new session" });
    resolve({ ok, committedRevision: 8 });
    await done;
    expect(state()).toMatchObject({ draft: { command: "new session" }, editingRevision: 20 });
  });

  it("keeps a retired result's draft and base revision without claiming persistence", async () => {
    const { editor, state, resolve, input } = fixture();
    editor.startEdit(server);
    const done = editor.save(input);
    resolve({ ok: false });
    await done;
    expect(state()).toMatchObject({ draft: { serverId: "github" }, editingRevision: 7 });
  });

  it("does not let an older completion acknowledge a later attempt with the same unchanged draft", async () => {
    const { editor, state, resolve, input } = fixture();
    input.edit.mockResolvedValueOnce({ ok: false });
    editor.startEdit(server);
    const older = editor.save(input);
    await editor.save(input);
    resolve({ ok: true, committedRevision: 8 });
    await older;
    expect(state()).toMatchObject({ draft: { serverId: "github" }, editingRevision: 7 });
  });

  it("retains further edits and the actual surviving revision after a partial commit", async () => {
    const { editor, state, resolve, input } = fixture();
    editor.startEdit(server);
    const done = editor.save(input);
    editor.setDraft({ ...state().draft!, command: "repair" });
    resolve({ ok: false, committedRevision: 8 });
    await done;
    expect(state()).toMatchObject({ draft: { command: "repair" }, editingRevision: 8 });
  });

  it.each(["same", "different"])("handles an add whose %s server draft is edited before completion", async (identity) => {
    const { editor, state, resolve, input } = fixture();
    editor.startAdd();
    editor.setDraft({ ...state().draft!, serverId: "new-server", command: "submitted" });
    const done = editor.save(input);
    const serverId = identity === "same" ? "new-server" : "other-server";
    editor.setDraft({ ...state().draft!, serverId, command: "later edit" });
    resolve({ ok: true, committedRevision: 1 });
    await done;
    expect(state()).toMatchObject({ draft: { serverId, command: "later edit" }, editingRevision: identity === "same" ? 1 : null });
    expect(input.add).toHaveBeenCalledTimes(1);
    expect(input.edit).not.toHaveBeenCalled();
  });
});
