/**
 * INPUT:  locked desktop/Host sources and explicit build mode on a supported Windows build machine
 * OUTPUT: get-only adapter invocation artifact, compiled helper tree and the real Tauri resource-map build
 * POS:    desktop/build — release packaging only; runtime/Host registration and credential provisioning stay explicit
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { run } from "@tauri-apps/cli";
import { buildHost } from "../../hindsight-host/scripts/build.ts";

const { values } = parseArgs({ options: {
  debug: { type: "boolean", default: false }, "prepare-only": { type: "boolean", default: false },
  "no-bundle": { type: "boolean", default: false },
} });
if (process.platform !== "win32" || !["x64", "arm64"].includes(process.arch) || !process.version.startsWith("v24.")) {
  throw new Error("Windows desktop packaging requires the explicit supported Node 24 build runtime");
}
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rust = join(desktop, "src-tauri");
const target = join(rust, "target");
// All builds share the existing target. This script never creates a second cache or downloads a dependency.
process.env.CARGO_TARGET_DIR = target;
process.env.CARGO_PROFILE_DEV_DEBUG = "0";
process.env.CARGO_PROFILE_TEST_DEBUG = "0";
process.env.CARGO_INCREMENTAL = "0";
const adapterBuild = spawnSync("cargo", ["build", "--manifest-path", join(rust, "Cargo.toml"),
  "--bin", "taki-secret-key", "--locked", "--offline", ...(values.debug ? [] : ["--release"])], {
  cwd: desktop, stdio: "inherit", windowsHide: true,
});
if (adapterBuild.error || adapterBuild.status !== 0) throw new Error("locked key adapter build failed");
mkdirSync(target, { recursive: true });
const stage = mkdtempSync(join(target, "hindsight-resources-"));
const payload = buildHost({ output: join(stage, "payload"), platform: "win32", architecture: process.arch as "x64" | "arm64",
  adapter: join(target, values.debug ? "debug" : "release", "taki-secret-key.exe") });
const config = join(stage, "tauri-resources.json");
writeFileSync(config, JSON.stringify({ bundle: { resources: { [payload.replaceAll("\\", "/")]: "hindsight-host/payload" } } }), { flag: "wx" });
if (values["prepare-only"]) process.stdout.write(`${JSON.stringify({ config, payload })}\n`);
else {
  process.chdir(desktop);
  await run(["build", "--ci", "--config", config, ...(values.debug ? ["--debug"] : []),
    ...(values["no-bundle"] ? ["--no-bundle"] : []), "--", "--locked", "--offline"], "pnpm desktop:build");
}
