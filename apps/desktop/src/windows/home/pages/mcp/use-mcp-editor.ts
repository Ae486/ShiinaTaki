/**
 * INPUT:  the MCP page's typed actions and disposable list view.
 * OUTPUT: local editor state/actions backed by session- and draft-aware save completion.
 * POS:    Home MCP React adapter — draft lifetime is independent of list refresh and command read-back.
 */
import { useEffect, useMemo, useState } from "react";
import { createMcpEditor, initialMcpEditor } from "./mcp-editor-controller.ts";
import { previousMcpData } from "./mcp-state.ts";
import type { McpServersView } from "./use-mcp.ts";

export function useMcpEditor(mcp: McpServersView) {
  const [state, setState] = useState(initialMcpEditor);
  const editor = useMemo(() => createMcpEditor(setState), []);
  useEffect(() => () => editor.retire(), [editor]);
  return {
    ...state,
    setDraft: editor.setDraft,
    startAdd: editor.startAdd,
    startEdit: editor.startEdit,
    clearEditor: editor.clearEditor,
    saveDraft: () => editor.save({ servers: previousMcpData(mcp.state), add: mcp.add, edit: mcp.edit }),
  };
}
