/**
 * INPUT:  protected sibling deployment registration and verified C1 installation
 * OUTPUT: pinned engine/client/state identities plus current-file validation
 * POS:    hindsight-host — Windows token/DACL and exclusive state lock remain Shell-owned
 */
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { HindsightDeploymentRegistrationV1Schema } from "@taki/shared/hindsight-deployment";
import type { VerifiedInstallation } from "./installation.ts";
import { digestInstalledFile, directoryIdentity, fileIdentity, readInstalledFile, sha256 } from "./installed-files.ts";
import { DeploymentError } from "./deployment-error.ts";

export function openDeploymentRegistration(path: string, installation: VerifiedInstallation) {
  const source = readInstalledFile(path, 32 * 1024);
  const registration = HindsightDeploymentRegistrationV1Schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source.bytes)));
  const c1 = installation.registration;
  if (process.platform !== "win32" || installation.owner.kind !== "windows-token"
    || registration.installationId !== c1.installationId || registration.coreHostId !== c1.coreHostId
    || registration.executionHostId !== c1.executionHostId || resolve(registration.stateDirectory) !== registration.stateDirectory
    || !relative(c1.installationRoot, registration.stateDirectory).startsWith("..")) throw new DeploymentError("unsafe-installation");
  const executable = digestInstalledFile(registration.docker.path);
  if (executable.sha256 !== registration.docker.sha256) throw new DeploymentError("artifact-mismatch");
  const rootIdentity = directoryIdentity(registration.stateDirectory);
  const configPath = join(registration.stateDirectory, "docker-config");
  const configIdentity = directoryIdentity(configPath);
  const validate = () => {
    installation.validate();
    if (fileIdentity(path) !== source.identity || fileIdentity(registration.docker.path) !== executable.identity
      || directoryIdentity(registration.stateDirectory) !== rootIdentity || directoryIdentity(configPath) !== configIdentity
      || readdirSync(configPath).length !== 0) throw new DeploymentError("unsafe-installation");
  };
  validate();
  return { registration, registrationSha256: sha256(source.bytes), validate };
}
