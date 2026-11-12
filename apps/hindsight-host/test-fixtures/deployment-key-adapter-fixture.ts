/**
 * INPUT: a freshly owned fixture root and the installed local Windows MSVC toolchain
 * OUTPUT: compiled get-only fake-key adapter plus non-secret source/compiler/binary provenance
 * POS: hindsight-host/tests — no keyring, network, package install or historical-temp dependency
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileDigest } from "../src/installed-files.ts";

let compiled: ReturnType<typeof compileAdapter> | undefined;

export function prepareDeploymentKeyAdapter(root: string): string {
  const directory = join(root, "test-key-adapter");
  // Exclusive creation prevents a fixture retry from overwriting an unknown or historical executable.
  mkdirSync(directory);
  const adapter = join(directory, "fake-key-adapter.exe");
  // Each worker compiles this fixed source once; every test gets its own exclusive binary and real frame probe.
  if (compiled) writeFileSync(adapter, compiled.bytes, { flag: "wx" });
  else compiled = compileAdapter(directory);
  const probe = spawnSync(adapter, ["get", "--account", "secret-catalog-master-key-v1"], {
    input: Buffer.alloc(0), env: { SystemRoot: process.env.SystemRoot }, windowsHide: true, timeout: 5_000,
  });
  if (probe.error || probe.status !== 0 || probe.stdout.length !== 36 || probe.stdout.readUInt32LE() !== 32
    || !probe.stdout.subarray(4).equals(Buffer.alloc(32, 0xa5)) || probe.stderr.length !== 0) {
    throw new Error("compiled fake-key adapter rejected its fixed framed protocol", { cause: probe.error });
  }
  writeFileSync(join(directory, "build-receipt.json"), JSON.stringify({
    ...compiled.provenance, adapter, adapterSha256: fileDigest(adapter),
    protocolProbe: { status: probe.status, frameBytes: probe.stdout.length, keyBytes: 32, fixedFakeKeyMatched: true },
  }, null, 2) + "\n", { flag: "wx" });
  return adapter;
}

function compileAdapter(directory: string) {
  const source = fileURLToPath(new URL("./fake-key-adapter.rs", import.meta.url));
  const toolchain = "stable-x86_64-pc-windows-msvc";
  const lookup = spawnSync("rustup", ["which", "--toolchain", toolchain, "rustc"], {
    env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" }, encoding: "utf8", windowsHide: true, timeout: 10_000,
  });
  if (lookup.error || lookup.status !== 0) throw new Error("local fake-key adapter Rust toolchain unavailable", { cause: lookup.error });
  const compiler = lookup.stdout.trim();
  const version = spawnSync(compiler, ["--version", "--verbose"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (version.error || version.status !== 0) throw new Error("local fake-key adapter compiler probe failed", { cause: version.error });
  const adapter = join(directory, "fake-key-adapter.exe");
  const args = [source, "--edition=2021", "-C", "debuginfo=0", "-o", adapter];
  const built = spawnSync(compiler, args, {
    env: { ...process.env, CARGO_NET_OFFLINE: "true" }, encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  if (built.error || built.status !== 0) throw new Error(`fake-key adapter compile failed: ${built.stderr}`, { cause: built.error });
  return { bytes: readFileSync(adapter), provenance: {
    toolchain, compiler, compilerVersion: version.stdout.trim(), compilerSha256: fileDigest(compiler),
    source, sourceSha256: fileDigest(source), args,
  } };
}
