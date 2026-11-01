import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export async function subagentNativeManifest() {
  const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const paths = [fileURLToPath(import.meta.url), "test/s7-subagent-runtime-smoke.mjs", "test/s7-subagent-native-smoke.mjs",
    "test/s7-subagent-native-server.mjs", "test/s7-subagent-data.ts", "test/c2-native-driver.mjs", "test/c3-pattern-native-server.mjs",
    "test/c3-pattern-fixture.tsx", "test/c3-pattern-fixture.html", "package.json", "vite.config.ts", "tsconfig.json",
    "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/build.rs", "src-tauri/tauri.conf.json"].map((path) => resolve(desktop, path));
  paths.push(join(process.env.CARGO_TARGET_DIR || join(desktop, "src-tauri/target"), "debug/examples/c2-presence-fixture.exe"));
  const visit = async (path) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await visit(full);
      else paths.push(full);
    }
  };
  for (const directory of ["src", "src-tauri/src", "src-tauri/examples", "src-tauri/capabilities", "src-tauri/permissions"]) await visit(join(desktop, directory));
  const manifest = {};
  for (const path of paths.sort()) manifest[relative(desktop, path).replaceAll("\\", "/")] = createHash("sha256").update(await readFile(path)).digest("hex");
  return manifest;
}
