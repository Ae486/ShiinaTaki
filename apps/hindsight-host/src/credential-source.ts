/**
 * INPUT:  verified installation, original Host deadline and this systemd service's private credential directory
 * OUTPUT: get-only master-key reads and separate paired Node credential reads
 * POS:    hindsight-host — no key creation, alternate account, source discovery or persistent secret cache
 */
import { spawn } from "node:child_process";
import { basename, join } from "node:path";
import { HINDSIGHT_CUSTODY_LIMITS } from "@taki/shared/hindsight-custody";
import { HindsightNodeCredentialSchema, type HindsightNodeCredential } from "@taki/shared/hindsight-installation";
import type { VerifiedInstallation } from "./installation.ts";
import { readInstalledFile, requireProtectedPath } from "./installed-files.ts";
import { CustodyError } from "./custody-error.ts";

export function sanitizedEnvironment(): NodeJS.ProcessEnv {
  return {
    ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}),
    WS_NO_BUFFER_UTIL: "1", WS_NO_UTF_8_VALIDATE: "1",
  };
}

export async function readCatalogKey(installation: VerifiedInstallation, signal: AbortSignal): Promise<Uint8Array> {
  installation.validate();
  const custody = installation.registration.custody;
  if (custody.kind === "systemd") {
    const key = readCredential(installation, custody.keyCredential, 32);
    if (key.length !== 32) throw new CustodyError("custody-locked");
    return key;
  }
  return readWindowsKey(installation, signal);
}

export function readNodeCredential(installation: VerifiedInstallation): HindsightNodeCredential {
  if (installation.registration.custody.kind !== "systemd") throw new CustodyError("unsupported-installation");
  const bytes = readCredential(installation, installation.registration.custody.nodeCredential, HINDSIGHT_CUSTODY_LIMITS.requestBytes);
  try {
    const credential = HindsightNodeCredentialSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (credential.deviceId !== installation.registration.executionHostId) throw new CustodyError("unsafe-installation");
    return credential;
  } finally {
    bytes.fill(0);
  }
}

function readCredential(installation: VerifiedInstallation, name: string, maxBytes: number): Buffer {
  const custody = installation.registration.custody;
  const directory = process.env.CREDENTIALS_DIRECTORY;
  if (custody.kind !== "systemd" || process.geteuid?.() !== custody.uid || !directory
    || basename(directory) !== custody.service) throw new CustodyError("custody-locked");
  const path = join(directory, name);
  requireProtectedPath(path, custody.uid, true);
  const result = readInstalledFile(path, maxBytes);
  requireProtectedPath(path, custody.uid, true);
  return result.bytes;
}

function readWindowsKey(installation: VerifiedInstallation, parentSignal: AbortSignal): Promise<Uint8Array> {
  const custody = installation.registration.custody;
  if (custody.kind !== "windows-keyring" || parentSignal.aborted) return Promise.reject(new CustodyError("custody-locked"));
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(HINDSIGHT_CUSTODY_LIMITS.keyCallMs)]);
  return new Promise((resolve, reject) => {
    const child = spawn(custody.adapter.path, ["get", "--account", custody.account], {
      cwd: installation.registration.installationRoot, env: sanitizedEnvironment(),
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const frame = Buffer.alloc(36);
    let bytes = 0;
    let stderrBytes = 0;
    let failed = false;
    const stop = () => { failed = true; child.kill(); };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    child.stdout.on("data", (chunk: Buffer) => {
      if (bytes + chunk.length > frame.length) return stop();
      chunk.copy(frame, bytes); bytes += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > HINDSIGHT_CUSTODY_LIMITS.resultBytes) stop();
    });
    child.on("error", () => { failed = true; });
    child.on("close", (code) => {
      signal.removeEventListener("abort", stop);
      if (failed || code !== 0 || bytes !== 36 || frame.readUInt32LE(0) !== 32) {
        frame.fill(0); reject(new CustodyError("custody-locked")); return;
      }
      const key = Uint8Array.from(frame.subarray(4));
      frame.fill(0);
      resolve(key);
    });
  });
}
