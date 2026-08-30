/**
 * INPUT:  one Core MCP server view (status phase + desired config + last candidate outcome)
 * OUTPUT: the human-facing MCP vocabulary (phase badge, failure reasons, stdio/http transport lines) and the
 *         dismiss-key derivation for the bounded diagnostics banner
 * POS:    ui/windows/home/pages/mcp — U2 presentation labels; opaque ids/revisions/generations/owners never pass
 *         through here as titles or badges, and secret values never render.
 */
import type { McpServerView } from "@taki/shared";

export const PHASE_LABEL: Record<McpServerView["status"]["phase"], { text: string; tone: "ok" | "warn" | "neutral" | "muted" }> = {
  connected: { text: "已连接", tone: "ok" },
  connecting: { text: "连接中", tone: "neutral" },
  failed: { text: "失败", tone: "warn" },
  draining: { text: "排空中", tone: "neutral" },
  disconnected: { text: "未连接", tone: "neutral" },
  disabled: { text: "已停用", tone: "muted" },
};

export const FAILURE_REASON_LABEL: Record<string, string> = {
  "connect-failed": "连接失败",
  "secret-unresolvable": "密钥无法解析（目录锁定或缺失）",
  "tools-list-failed": "工具列举失败",
  "deadline-exceeded": "候选超时",
  "tool-key-collision": "工具名冲突",
};

export function transportLine(server: McpServerView): string {
  if (server.config && "command" in server.config) {
    return `stdio · ${server.config.command} ${(server.config.args ?? []).join(" ")}`.trimEnd();
  }
  return `http · ${server.config.url}`;
}

/** The list-row one-line fact: transport kind + its shortest human anchor (command, host). */
export function transportShortLine(server: McpServerView): string {
  if (server.config && "command" in server.config) {
    return `stdio · ${server.config.command}`;
  }
  try {
    return `http · ${new URL(server.config.url).host}`;
  } catch {
    return "http";
  }
}

/**
 * Stable dismiss key for the bounded diagnostics banner: a NEW candidate outcome (different status/timestamp)
 * re-shows the banner after the operator dismissed the previous one.
 */
export function mcpDiagnosticKey(server: McpServerView): string {
  const outcome = server.status.lastOutcome;
  return outcome === null ? "" : `${server.serverId}:${outcome.status}:${outcome.at}`;
}
