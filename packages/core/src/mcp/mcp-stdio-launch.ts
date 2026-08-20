/**
 * INPUT:  portable stdio command/args plus the runtime platform
 * OUTPUT: an SDK-compatible launch tuple using the Windows cross-spawn relay only when required
 * POS:    core/mcp transport boundary; persistence stays platform-neutral and operators never see adapters
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StdioServerConfig } from "./mcp-config.ts";

const WINDOWS_RELAY = fileURLToPath(new URL("./mcp-stdio-relay.mjs", import.meta.url));
const WINDOWS_SHIM_NAMES = new Set(["bun", "bunx", "npx", "npm", "npmx", "pnpm", "yarn", "yarnpkg"]);

export interface StdioLaunch {
  command: string;
  args: string[];
}

interface LaunchRuntime {
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  relayPath?: string;
  environment?: NodeJS.ProcessEnv;
}

/** Unix launches stay direct; Windows delegates argv/shim handling to cross-spawn in a transparent relay. */
export function resolveStdioLaunch(
  config: Pick<StdioServerConfig, "command" | "args">,
  runtime: LaunchRuntime = {},
): StdioLaunch {
  const args = config.args ?? [];
  if ((runtime.platform ?? process.platform) !== "win32") return { command: config.command, args };
  if (!requiresWindowsRelay(config.command, runtime.environment ?? process.env)) return { command: config.command, args };
  return {
    command: runtime.nodeExecutable ?? process.execPath,
    args: [runtime.relayPath ?? WINDOWS_RELAY, config.command, ...args],
  };
}

function requiresWindowsRelay(command: string, environment: NodeJS.ProcessEnv): boolean {
  const normalized = command.toLowerCase();
  if (normalized.endsWith(".cmd") || normalized.endsWith(".bat")) return true;
  if (normalized.endsWith(".exe") || normalized.endsWith(".com")) return false;
  const baseName = normalized.split(/[\\/]/u).pop() ?? normalized;
  if (WINDOWS_SHIM_NAMES.has(baseName)) return true;
  const pathValue = Object.entries(environment).find(([key]) => key.toLowerCase() === "path")?.[1];
  const pathExtValue = Object.entries(environment).find(([key]) => key.toLowerCase() === "pathext")?.[1] ?? ".COM;.EXE;.BAT;.CMD";
  for (const root of pathValue?.split(";").filter(Boolean) ?? []) {
    for (const extension of pathExtValue.split(";").filter(Boolean)) {
      const candidate = path.win32.join(root, `${command}${extension}`);
      if (existsSync(candidate)) return candidate.toLowerCase().endsWith(".cmd") || candidate.toLowerCase().endsWith(".bat");
    }
  }
  return false;
}
