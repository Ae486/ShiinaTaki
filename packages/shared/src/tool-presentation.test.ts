import { describe, expect, it } from "vitest";
import { McpServerIdSchema, McpToolNameSchema } from "./mcp-lifecycle-schema.ts";
import { captureToolDisplayNames, formatMcpToolDisplayName, getKnownToolDisplayName, getValidToolDisplayName } from "./tool-presentation.ts";

describe("tool presentation names", () => {
  it.each([
    "get_current_time", "memory_search", "memory_write", "memory_archive", "recall", "reflect", "retain",
    "update_memory", "restore_memory", "invalidate_memory", "avatar_set_expression", "avatar_play_motion",
    "read_file", "write_file", "schedule_task", "screenshot", "process_list", "clipboard_read", "clipboard_write",
    "shell_open", "exec", "load_skill", "read_skill_resource", "extension_discover", "extension_describe", "extension_call", "manage_media_recommendations",
  ])("names the registered fixed tool %s", (key) => {
    expect(getKnownToolDisplayName(key)).toMatch(/\p{Script=Han}/u);
  });

  it("distinguishes memory operations that share the same governance capability", () => {
    const groups = [
      ["memory_search", "recall", "reflect"],
      ["memory_write", "retain", "update_memory", "restore_memory"],
      ["memory_archive", "invalidate_memory"],
    ];
    for (const group of groups) expect(new Set(group.map(getKnownToolDisplayName)).size).toBe(group.length);
  });

  it.each(["", "__proto__", "constructor", "github_search_issues", "unknown.internal-key"])(
    "does not guess a display name from an unknown routing key: %s", (key) => {
      expect(getKnownToolDisplayName(key)).toBeUndefined();
    },
  );

  it("preserves exact MCP names, including maximum valid lengths and meaningful punctuation", () => {
    const serverName = McpServerIdSchema.parse("s".repeat(64));
    const toolName = McpToolNameSchema.parse("工具".repeat(64));
    expect(formatMcpToolDisplayName({ serverName, toolName })).toBe(`${serverName} · ${toolName}`);
    expect(formatMcpToolDisplayName({ serverName, toolName })).toHaveLength(195);
    expect(formatMcpToolDisplayName({ serverName: "github", toolName: "issues.search" })).toBe("github · issues.search");
  });
});

describe("captured tool display names", () => {
  it("bounds names by UTF-16 units while preserving valid text verbatim", () => {
    for (const name of [" 工具名称 ", "x".repeat(240), "🛠".repeat(120)]) {
      expect(getValidToolDisplayName(name)).toBe(name);
    }
    for (const name of [undefined, null, 17, {}, "", " \t\n", "x".repeat(241), "🛠".repeat(121)]) {
      expect(getValidToolDisplayName(name)).toBeUndefined();
    }
  });

  it("freezes an own-key copy without dropping non-enumerable or prototype-named keys", () => {
    const names = Object.create({ inherited: "Inherited name" }) as Record<string, string>;
    names.route = "Original server · tool";
    Object.defineProperty(names, "constructor", { value: "Own constructor tool", enumerable: true });
    Object.defineProperty(names, "__proto__", { value: "Own prototype tool", enumerable: true });
    Object.defineProperty(names, "hidden", { value: "Non-enumerable tool" });
    names.invalid = "x".repeat(241);

    const captured = captureToolDisplayNames(names)!;
    names.route = "Replacement server · tool";

    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.getPrototypeOf(captured)).toBe(Object.prototype);
    expect(Object.getOwnPropertyNames(captured).sort()).toEqual(["__proto__", "constructor", "hidden", "route"]);
    expect(captured.route).toBe("Original server · tool");
    expect(captured.constructor).toBe("Own constructor tool");
    expect(captured.__proto__).toBe("Own prototype tool");
    expect(captured.hidden).toBe("Non-enumerable tool");
    expect(captureToolDisplayNames(undefined)).toBeUndefined();
  });
});
