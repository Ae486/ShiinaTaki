/**
 * INPUT:  protected Linux launcher/unit, explicit registration and a cleared Node 24 startup environment
 * OUTPUT: import of the complete verified installed payload; bounded refusal before any payload code executes
 * POS:    hindsight-host/packaging — installer-protected trust root outside the payload, using only Node builtins
 */
import process from "node:process";
import { Buffer } from "node:buffer";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const files = new Map();
const parents = new Map();
const fail = () => { throw new Error("unavailable installation"); };
const isDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function absolute(path) {
  if (typeof path !== "string" || path.length > 4096 || path.includes("\0") || !isAbsolute(path) || resolve(path) !== path) fail();
  return path;
}

function protect(path, uid, directory = false) {
  absolute(path);
  let candidate = path;
  let leaf = true;
  for (;;) {
    const stat = lstatSync(candidate, { bigint: true });
    if (stat.isSymbolicLink() || (stat.uid !== BigInt(uid) && stat.uid !== 0n) || (stat.mode & 0o022n) !== 0n) fail();
    if (leaf && !directory) {
      if (!stat.isFile() || stat.nlink !== 1n) fail();
    } else {
      if (!stat.isDirectory()) fail();
      const identity = `${stat.dev}:${stat.ino}`;
      if (parents.has(candidate) && parents.get(candidate) !== identity) fail();
      parents.set(candidate, identity);
    }
    if (candidate === parse(candidate).root) break;
    candidate = dirname(candidate);
    leaf = false;
  }
}

function identity(stat) { return `${stat.dev}:${stat.ino}:${stat.ctimeNs}:${stat.size}`; }

function consume(path, options) {
  protect(path, options.uid);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(options.limit)) fail();
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(65_536);
    const chunks = [];
    let total = 0;
    let count;
    while ((count = readSync(fd, chunk, 0, chunk.length, null)) !== 0) {
      total += count;
      if (total > options.limit) fail();
      hash.update(chunk.subarray(0, count));
      if (options.json) chunks.push(Buffer.from(chunk.subarray(0, count)));
    }
    const original = identity(before);
    const current = lstatSync(path, { bigint: true });
    if (BigInt(total) !== before.size || identity(fstatSync(fd, { bigint: true })) !== original
      || current.isSymbolicLink() || current.nlink !== 1n || identity(current) !== original) fail();
    files.set(path, original);
    return { sha256: hash.digest("hex"), value: options.json ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined };
  } finally { closeSync(fd); }
}

function registration(path, uid) {
  const source = consume(path, { uid, limit: 32 * 1024, json: true });
  const value = source.value;
  // This is only the pre-import trust check. The verified Shared schemas still validate the full protocol.
  if (!object(value) || value.version !== 1 || !object(value.runtime) || !object(value.custody)
    || value.custody.kind !== "systemd" || value.custody.uid !== uid
    || value.custody.service !== "taki-hindsight-host.service" || !isDigest(value.manifestSha256)
    || !isDigest(value.runtime.sha256) || !/^v24\.[0-9]+\.[0-9]+$/.test(value.runtime.version)) fail();
  const root = absolute(value.installationRoot);
  const relativeRegistration = relative(root, path);
  if (relativeRegistration !== ".." && !relativeRegistration.startsWith("../")) fail();
  if (absolute(value.runtime.path) !== process.execPath || value.runtime.version !== process.version) fail();
  if (consume(value.runtime.path, { uid, limit: MAX_ARTIFACT_BYTES }).sha256 !== value.runtime.sha256) fail();
  return value;
}

function manifest(root, expected, uid) {
  const source = consume(join(root, "manifest.json"), { uid, limit: MAX_MANIFEST_BYTES, json: true });
  const value = source.value;
  if (source.sha256 !== expected || !object(value) || value.version !== 1 || value.build !== "taki-hindsight-host-c1-v1"
    || value.platform !== "linux" || value.architecture !== process.arch || value.entrypoint !== "app/main.js"
    || !Array.isArray(value.files) || value.files.length === 0) fail();
  const expectedFiles = new Set(["manifest.json"]);
  for (const entry of value.files) {
    if (!object(entry) || typeof entry.path !== "string" || entry.path.length > 1024
      || !/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/.test(entry.path)
      || entry.path.split("/").some((part) => part === "." || part === "..")
      || expectedFiles.has(entry.path) || !isDigest(entry.sha256)) fail();
    expectedFiles.add(entry.path);
    if (consume(join(root, entry.path), { uid, limit: MAX_ARTIFACT_BYTES }).sha256 !== entry.sha256) fail();
  }
  if (!expectedFiles.has(value.entrypoint)) fail();
  completeTree(root, expectedFiles, uid);
}

function completeTree(root, remaining, uid) {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    protect(directory, uid, true);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail();
      if (entry.isDirectory()) pending.push(path);
      else if (!entry.isFile() || !remaining.delete(relative(root, path))) fail();
    }
  }
  if (remaining.size !== 0) fail();
}

function recheck(uid) {
  for (const [path, expected] of files) {
    protect(path, uid);
    if (identity(lstatSync(path, { bigint: true })) !== expected) fail();
  }
  for (const path of parents.keys()) protect(path, uid, true);
}

async function launch() {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)
    || JSON.stringify(process.execArgv) !== JSON.stringify(["--no-addons", "--no-global-search-paths"])
    || process.env.NODE_OPTIONS || process.env.NODE_PATH || process.env.LD_PRELOAD || process.env.LD_LIBRARY_PATH
    || process.env.WS_NO_BUFFER_UTIL !== "1" || process.env.WS_NO_UTF_8_VALIDATE !== "1") fail();
  const uid = process.geteuid();
  protect(fileURLToPath(import.meta.url), uid);
  const { values, positionals } = parseArgs({ allowPositionals: true,
    options: { registration: { type: "string" }, "credential-output": { type: "string" } } });
  if (positionals.length !== 1 || !["serve", "enroll", "inspect-installation"].includes(positionals[0])) fail();
  const admitted = registration(absolute(values.registration), uid);
  manifest(admitted.installationRoot, admitted.manifestSha256, uid);
  recheck(uid);
  await import(pathToFileURL(join(admitted.installationRoot, "app/main.js")).href);
}

void launch().catch(() => {
  process.stdout.write(`${JSON.stringify({ version: 1, state: "unavailable", reason: "unsafe-installation", deploymentReady: false })}\n`);
  process.exitCode = 1;
});
