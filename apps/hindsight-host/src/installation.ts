/**
 * INPUT:  explicit protected registration, expected manifest digest and installed Node identity
 * OUTPUT: one verified compiled installation and a revalidation closure covering its consumed tree
 * POS:    hindsight-host — no PATH discovery; Windows requires the Rust-held token/file verification handoff
 */
import { isAbsolute, join, relative, resolve } from "node:path";
import { readdirSync } from "node:fs";
import {
  HindsightHostManifestSchema, HindsightHostRegistrationSchema,
  type HindsightHostManifest, type HindsightHostRegistration,
} from "@taki/shared/hindsight-installation";
import { HINDSIGHT_CUSTODY_LIMITS, type HindsightTrustedInvocation } from "@taki/shared/hindsight-custody";
import {
  digestInstalledFile, directoryIdentity, fileIdentity, readInstalledFile,
  requireProtectedPath, requireProtectedDirectory, sha256,
} from "./installed-files.ts";
import { CustodyError } from "./custody-error.ts";

export interface VerifiedInstallation {
  registration: HindsightHostRegistration;
  registrationPath: string;
  owner: HindsightTrustedInvocation["owner"];
  validate(): void;
}

export function openInstallation(registrationPath: string, owner?: HindsightTrustedInvocation["owner"]): VerifiedInstallation {
  const path = resolve(registrationPath);
  const source = readInstalledFile(path, HINDSIGHT_CUSTODY_LIMITS.requestBytes);
  const registration = HindsightHostRegistrationSchema.parse(JSON.parse(source.bytes.toString("utf8")));
  const identity = actualOwner(registration, owner);
  const root = registration.installationRoot;
  if (!isAbsolute(root) || relative(root, path) === "" || !relative(root, path).startsWith("..")) {
    throw new CustodyError("unsafe-installation");
  }
  const manifestPath = join(root, "manifest.json");
  const manifestSource = readInstalledFile(manifestPath, HINDSIGHT_CUSTODY_LIMITS.envelopeBytes);
  if (sha256(manifestSource.bytes) !== registration.manifestSha256) throw new CustodyError("unsafe-installation");
  const manifest = HindsightHostManifestSchema.parse(JSON.parse(manifestSource.bytes.toString("utf8")));
  if (manifest.platform !== process.platform || manifest.architecture !== process.arch) throw new CustodyError("unsupported-installation");
  if (resolve(process.execPath) !== resolve(registration.runtime.path) || process.version !== registration.runtime.version) {
    throw new CustodyError("unsafe-installation");
  }
  const validate = verifyArtifacts({ registration, manifest, path, identity,
    snapshots: new Map([[path, source.identity], [manifestPath, manifestSource.identity]]) });
  validate();
  return { registration, registrationPath: path, owner: identity, validate };
}

function verifyArtifacts(input: {
  registration: HindsightHostRegistration; manifest: HindsightHostManifest; path: string;
  identity: VerifiedInstallation["owner"]; snapshots: Map<string, string>;
}): () => void {
  const { registration, manifest, path, identity, snapshots } = input;
  const root = registration.installationRoot;
  const files = [path, join(root, "manifest.json"), registration.runtime.path, ...manifest.files.map((entry) => join(root, entry.path))];
  const directories = requireCompleteTree(root, manifest.files.map((entry) => entry.path));
  const parents = new Map<string, string>();
  const protect = () => {
    if (identity.kind !== "unix-user") return;
    const checked = [...files.flatMap((file) => requireProtectedPath(file, identity.uid)),
      ...directories.flatMap((directory) => requireProtectedDirectory(directory, identity.uid))];
    for (const parent of checked) {
      if (parents.has(parent.path) && parents.get(parent.path) !== parent.identity) throw new CustodyError("snapshot-stale");
      parents.set(parent.path, parent.identity);
    }
  };
  protect();
  for (const artifact of [registration.runtime, ...manifest.files.map((entry) => ({ ...entry, path: join(root, entry.path) }))]) {
    const digest = digestInstalledFile(artifact.path);
    if (digest.sha256 !== artifact.sha256) throw new CustodyError("unsafe-installation");
    snapshots.set(artifact.path, digest.identity);
  }
  if (!manifest.files.some((entry) => entry.path === manifest.entrypoint)) throw new CustodyError("unsafe-installation");
  return () => {
    if ([...snapshots].some(([file, original]) => fileIdentity(file) !== original)
      || [...parents].some(([directory, original]) => directoryIdentity(directory) !== original)) {
      throw new CustodyError("snapshot-stale");
    }
    protect();
  };
}

function actualOwner(registration: HindsightHostRegistration, owner?: HindsightTrustedInvocation["owner"]): HindsightTrustedInvocation["owner"] {
  if (process.platform === "win32" && registration.custody.kind === "windows-keyring"
    && owner?.kind === "windows-token" && owner.tokenUserSha256 === registration.custody.tokenUserSha256) return owner;
  if (process.platform === "linux" && registration.custody.kind === "systemd") {
    const uid = process.geteuid?.();
    if (uid === registration.custody.uid && (owner === undefined || (owner.kind === "unix-user" && owner.uid === uid))) {
      return { kind: "unix-user", uid };
    }
  }
  throw new CustodyError("unsafe-installation");
}

function requireCompleteTree(root: string, expected: string[]): string[] {
  const remaining = new Set([...expected, "manifest.json"]);
  const pending = [root];
  const directories: string[] = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    directories.push(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new CustodyError("unsafe-installation");
      if (entry.isDirectory()) pending.push(path);
      else if (!entry.isFile() || !remaining.delete(relative(root, path).replaceAll("\\", "/"))) throw new CustodyError("unsafe-installation");
    }
  }
  if (remaining.size > 0) throw new CustodyError("unsafe-installation");
  return directories;
}
