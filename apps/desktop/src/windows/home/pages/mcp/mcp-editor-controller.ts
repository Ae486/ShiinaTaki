/**
 * INPUT:  local editor sessions, immutable draft changes and current-client MCP mutation outcomes.
 * OUTPUT: retained drafts with matching-session completion and commit-derived retry revisions.
 * POS:    Home MCP editing owner — background list snapshots never advance the expected write revision.
 */
import type { McpServerView } from "@taki/shared";
import type { McpEditorMutationResult } from "./mcp-controller.ts";
import { draftFromView, emptyDraft, validateDraft, type McpServerDraft } from "./mcp-state.ts";

export interface McpEditorState {
  draft: McpServerDraft | null;
  editingRevision: number | null;
  formError: string | null;
}

interface SaveInput {
  servers: McpServerView[] | null;
  add(draft: McpServerDraft): Promise<McpEditorMutationResult>;
  edit(draft: McpServerDraft, expectedRevision: number): Promise<McpEditorMutationResult>;
}

export function initialMcpEditor(): McpEditorState {
  return { draft: null, editingRevision: null, formError: null };
}

export function createMcpEditor(publish: (state: McpEditorState) => void) {
  return new McpEditor(publish);
}

class McpEditor {
  private state = initialMcpEditor();
  private session = 0;
  private attempt = 0;
  private readonly publish: (state: McpEditorState) => void;

  constructor(publish: (state: McpEditorState) => void) { this.publish = publish; }

  setDraft = (draft: McpServerDraft): void => { this.set({ ...this.state, draft }); };

  startAdd = (): void => {
    this.session += 1;
    this.set({ draft: emptyDraft(), editingRevision: null, formError: null });
  };

  startEdit = (server: McpServerView): void => {
    this.session += 1;
    this.set({ draft: draftFromView(server), editingRevision: server.configRevision, formError: null });
  };

  clearEditor = (): void => {
    this.session += 1;
    this.set(initialMcpEditor());
  };

  retire = (): void => { this.session += 1; };

  save = async (input: SaveInput): Promise<void> => {
    const { draft, editingRevision } = this.state;
    if (draft === null) return;
    const session = this.session;
    const attempt = ++this.attempt;
    const existing = new Set((input.servers ?? [])
      .filter((server) => editingRevision === null || server.serverId !== draft.serverId)
      .map((server) => server.serverId));
    const formError = validateDraft(draft, existing);
    this.set({ ...this.state, formError });
    if (formError !== null) return;
    try {
      const result = editingRevision === null ? await input.add(draft) : await input.edit(draft, editingRevision);
      if (this.session === session && this.attempt === attempt) this.finish(draft, result);
    } catch (cause) {
      if (this.session === session && this.attempt === attempt) {
        this.set({ ...this.state, formError: cause instanceof Error ? cause.message : String(cause) });
      }
    }
  };

  private finish(submitted: McpServerDraft, result: McpEditorMutationResult): void {
    if (result.ok && this.state.draft === submitted) {
      this.clearEditor();
      return;
    }
    // Typing may continue while the command or its read-back is pending. Keep those edits, but the
    // same editor's next explicit save may use this actual commit (including a surviving partial commit).
    // Cancelling/reopening or changing an add's server ID must never inherit another draft's revision.
    if (result.committedRevision !== undefined && this.state.draft?.serverId === submitted.serverId) {
      this.set({ ...this.state, editingRevision: result.committedRevision });
    }
  }

  private set(state: McpEditorState): void {
    this.state = state;
    this.publish(state);
  }
}
