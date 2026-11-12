/** Start Desktop independently with the same explicit profile bootstrap inputs as the ordinary Core command. */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(repo, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.TAKI_DATA_DIR && !isAbsolute(process.env.TAKI_DATA_DIR)) {
  process.env.TAKI_DATA_DIR = resolve(repo, "packages/core", process.env.TAKI_DATA_DIR);
}
const packageManager = process.env.npm_execpath;
if (!packageManager) throw new Error("Start Desktop with pnpm desktop:dev");
const child = spawn(process.execPath, [packageManager, "--filter", "@taki/desktop", "tauri", "dev"],
  { cwd: repo, env: process.env, stdio: "inherit", windowsHide: true });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
