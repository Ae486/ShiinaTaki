/** Prepare the existing native credential helper and discover its actual Cargo artifact path. */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function prepareNativeHelper() {
  if (process.env.TAKI_SECRET_KEY_HELPER) return process.env.TAKI_SECRET_KEY_HELPER;
  if (process.platform !== "win32") return undefined;
  const metadata = spawnSync("cargo", ["metadata", "--no-deps", "--format-version=1", "--manifest-path",
    resolve(repo, "apps/desktop/src-tauri/Cargo.toml")], { cwd: repo, encoding: "utf8", windowsHide: true });
  const target = metadata.status === 0 ? JSON.parse(metadata.stdout).target_directory
    : process.env.CARGO_TARGET_DIR ?? resolve(repo, "apps/desktop/src-tauri/target");
  const expected = resolve(target, "debug/taki-secret-key.exe");
  const result = spawnSync("cargo", ["build", "--locked", "--manifest-path",
    resolve(repo, "apps/desktop/src-tauri/Cargo.toml"), "--bin", "taki-secret-key", "--message-format=json"],
  { cwd: repo, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    console.warn("Native credential helper is unavailable; Core control services will still start.");
    return expected;
  }
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    const item = JSON.parse(line);
    if (item.reason === "compiler-artifact" && item.target?.name === "taki-secret-key" && item.executable) return item.executable;
  }
  console.warn("Cargo did not report the credential helper; local connection will retry after repair.");
  return expected;
}
