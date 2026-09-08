/**
 * INPUT: MCP snapshots/mutations/errors and stdio/http drafts with write-only secret fields
 * OUTPUT: generation-safe transitions, error classification, validation, and canonical secret-ref derivation
 * POS: Home MCP testable state core; component memory only, with no transport, React, cache, or policy inference
 */
import { ErrorCodeSchema, MCP_SECRET_REF_MARKER, type McpServerConfig, type McpServerView } from "@taki/shared";

export type McpFeedback =
  | { kind: "saved"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "refused"; reason: string | null; message: string }
  | { kind: "tested"; message: string }
  | { kind: "test-failed"; message: string }
  | { kind: "error"; message: string };

export type McpViewState =
  | { kind: "idle"; token: number; previous: McpServerView[] | null }
  | { kind: "loading"; token: number; previous: McpServerView[] | null }
  | { kind: "ready"; token: number; data: McpServerView[]; feedback: McpFeedback | null; pending: string | null }
  | { kind: "failure"; token: number; previous: McpServerView[] | null; failureKind: "read" | "validation"; message: string };

export function beginMcpLoad(token: number, previous: McpServerView[] | null): McpViewState {
  return { kind: "loading", token, previous };
}

export function applyMcpLoad(state: McpViewState, input: { token: number; servers: McpServerView[]; feedback?: McpFeedback | null }): McpViewState {
  if (state.token !== input.token) return state;
  return { kind: "ready", token: input.token, data: input.servers, feedback: input.feedback ?? null, pending: null };
}

export function failMcpLoad(state: McpViewState, token: number, cause: unknown): McpViewState {
  if (state.token !== token) return state;
  return {
    kind: "failure",
    token,
    previous: previousMcpData(state),
    failureKind: cause instanceof Error && cause.name === "ZodError" ? "validation" : "read",
    message: errorMessage(cause),
  };
}

export function beginMcpMutation(state: McpViewState, token: number, pending: string): McpViewState {
  if (state.kind !== "ready" || state.token !== token) return state;
  return { ...state, feedback: null, pending };
}

export function applyMcpMutation(state: McpViewState, input: { token: number; server: McpServerView; message: string }): McpViewState {
  if (state.kind !== "ready" || state.token !== input.token) return state;
  const exists = state.data.some((server) => server.serverId === input.server.serverId);
  const data = exists
    ? state.data.map((server) => (server.serverId === input.server.serverId ? input.server : server))
    : [...state.data, input.server];
  return { ...state, data, feedback: { kind: "saved", message: input.message }, pending: null };
}

export function applyMcpRemoved(state: McpViewState, token: number, serverId: string): McpViewState {
  if (state.kind !== "ready" || state.token !== token) return state;
  return { ...state, data: state.data.filter((server) => server.serverId !== serverId), feedback: { kind: "saved", message: `已移除 ${serverId}` }, pending: null };
}

export function failMcpMutation(state: McpViewState, token: number, cause: unknown): McpViewState {
  if (state.kind !== "ready" || state.token !== token) return state;
  return { ...state, feedback: mcpMutationFeedback(cause), pending: null };
}

export function mcpMutationFeedback(cause: unknown): McpFeedback {
  const app = mcpAppError(cause);
  const feedback: McpFeedback =
    app.code === ErrorCodeSchema.enum.MCP_CONFIG_CONFLICT
      ? { kind: "conflict", message: "配置已在别处修改；已从 Core 重新读取" }
      : app.code === ErrorCodeSchema.enum.MCP_REFUSED
        ? { kind: "refused", reason: app.reason, message: refusalMessage(app.reason, errorMessage(cause)) }
        : { kind: "error", message: errorMessage(cause) };
  return feedback;
}

export function applyMcpFeedback(state: McpViewState, token: number, feedback: McpFeedback): McpViewState {
  if (state.kind !== "ready" || state.token !== token) return state;
  return { ...state, feedback, pending: null };
}

export function mcpAppError(cause: unknown): { code: string | null; reason: string | null } {
  if (typeof cause !== "object" || cause === null || !("data" in cause)) return { code: null, reason: null };
  const data = cause.data;
  if (typeof data !== "object" || data === null) return { code: null, reason: null };
  const record = data as Record<string, unknown>;
  const code = ErrorCodeSchema.safeParse(record.code);
  return { code: code.success ? code.data : null, reason: typeof record.reason === "string" ? record.reason : null };
}

export function previousMcpData(state: McpViewState): McpServerView[] | null {
  return state.kind === "ready" ? state.data : state.previous;
}

/** Batch-4 L2: the detail-pane target — the operator's selection, else the first row; null when no list is shown. */
export function resolveSelectedServer(servers: McpServerView[] | null, selectedId: string | null): McpServerView | null {
  if (servers === null || servers.length === 0) return null;
  return servers.find((server) => server.serverId === selectedId) ?? servers[0]!;
}

// --- editor draft model ---

export interface McpFieldDraft {
  id: number;
  name: string;
  /** Write-only: never rendered back from Core; a kept secret stays empty and retains only its opaque ref. */
  value: string;
  /** Exact marker target read from Core; an empty value may keep it only while name + transport kind still match. */
  storedSecretRef: string | null;
}

export interface McpServerDraft {
  serverId: string;
  kind: "stdio" | "http";
  command: string;
  args: string;
  cwd: string;
  url: string;
  fields: McpFieldDraft[];
  selectedTools: string;
}

let fieldId = 0;
export function nextFieldId(): number {
  fieldId += 1;
  return fieldId;
}

export function emptyDraft(kind: "stdio" | "http" = "stdio"): McpServerDraft {
  return { serverId: "", kind, command: "", args: "", cwd: "", url: "", fields: [], selectedTools: "" };
}

export function draftFromView(view: McpServerView): McpServerDraft {
  const config = view.config;
  const map = "command" in config ? config.env : config.headers;
  const fields: McpFieldDraft[] = Object.entries(map ?? {}).map(([name, value]) => ({
    id: nextFieldId(),
    name,
    value: "",
    storedSecretRef: value.startsWith(MCP_SECRET_REF_MARKER)
      ? value.slice(MCP_SECRET_REF_MARKER.length)
      : null,
  }));
  return {
    serverId: view.serverId,
    kind: "command" in config ? "stdio" : "http",
    command: "command" in config ? config.command : "",
    args: "command" in config ? (config.args ?? []).join("\n") : "",
    cwd: "command" in config ? (config.cwd ?? "") : "",
    url: "command" in config ? "" : config.url,
    fields,
    selectedTools: view.selectedTools.join("\n"),
  };
}

/**
 * Client-side parity of core's `mcpEnvRef`/`mcpHeaderRef` fold (secrets/secret-ref.ts owns the format). The
 * serverId/field charsets validated below are already the folded charset, so the derivation is identity-safe.
 */
export function mcpFieldSecretRef(serverId: string, kind: "env" | "headers", field: string): string {
  return `mcp.${serverId}.${kind === "env" ? "env" : "header"}.${field}`;
}

/** New/updated secret values for secret.set, the only value-carrying path; the controller owns operation ordering. */
export function secretValuesToStore(draft: McpServerDraft): Array<{ secretRef: string; value: string }> {
  const kind = draft.kind === "stdio" ? "env" : "headers";
  return draft.fields
    .filter((field) => field.value.length > 0)
    .map((field) => ({ secretRef: mcpFieldSecretRef(draft.serverId, kind, field.name), value: field.value }));
}

export function draftToConfig(draft: McpServerDraft): McpServerConfig {
  const kind = draft.kind === "stdio" ? "env" : "headers";
  const map: Record<string, string> = {};
  for (const field of draft.fields) {
    if (field.name.length === 0) continue;
    map[field.name] = `${MCP_SECRET_REF_MARKER}${mcpFieldSecretRef(draft.serverId, kind, field.name)}`;
  }
  if (draft.kind === "stdio") {
    const args = splitLines(draft.args);
    return { command: draft.command, ...(args.length > 0 ? { args } : {}), env: map, ...(draft.cwd ? { cwd: draft.cwd } : {}) };
  }
  return { url: draft.url, ...(Object.keys(map).length > 0 ? { headers: map } : {}) };
}

export function draftSelectedTools(draft: McpServerDraft): string[] {
  return splitLines(draft.selectedTools);
}

/** Returns the first validation error (Chinese operator wording), or null when the draft may be saved. */
export function validateDraft(draft: McpServerDraft, existingServerIds: ReadonlySet<string>): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(draft.serverId)) return "服务器 ID 需以字母或数字开头，仅含字母/数字/下划线/连字符（≤64 字符）";
  if (existingServerIds.has(draft.serverId)) return `服务器 ID ${draft.serverId} 已存在`;
  if (draft.kind === "stdio" && draft.command.trim().length === 0) return "stdio 服务器需要可执行命令";
  if (draft.kind === "http" && !isHttpUrl(draft.url)) return "http 服务器需要合法的 http(s) URL";
  const names = new Set<string>();
  for (const field of draft.fields) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(field.name)) return `字段名 ${field.name || "(空)"} 不合法（需以字母/数字/下划线开头，仅含字母/数字/下划线/连字符）`;
    if (names.has(field.name)) return `字段名 ${field.name} 重复`;
    names.add(field.name);
    const expectedRef = mcpFieldSecretRef(draft.serverId, draft.kind === "stdio" ? "env" : "headers", field.name);
    if (field.value.length === 0 && field.storedSecretRef !== expectedRef) {
      return `密钥字段 ${field.name} 已更名或更换传输类型，需要输入新值`;
    }
  }
  return null;
}

function splitLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function refusalMessage(reason: string | null, fallback: string): string {
  if (reason === "duplicate-server") return "该服务器 ID 已存在";
  if (reason === "unknown-server") return "Core 已不认识该服务器；请刷新后重试";
  if (reason === "key-collision") return "该 ID 与现有服务器的工具前缀冲突；请换一个 ID";
  if (reason === "invalid-config") return "Core 拒绝了该配置";
  return fallback;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
