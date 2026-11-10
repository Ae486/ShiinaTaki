/** Keep the ordinary Core process independent while preparing its native credential seam once. */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareNativeHelper } from "./prepare-native-helper.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helper = prepareNativeHelper();
const child = spawn(process.execPath, [
  ...(process.argv.includes("--watch") ? ["--watch"] : []),
  "--env-file-if-exists=../../.env.local", "src/main.ts",
], { cwd: resolve(repo, "packages/core"), stdio: "inherit", windowsHide: true,
  env: { ...process.env, ...(helper ? { TAKI_SECRET_KEY_HELPER: helper } : {}) } });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
