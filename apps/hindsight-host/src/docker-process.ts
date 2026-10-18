/**
 * INPUT:  registered Docker executable/endpoint and code-owned fixed arguments/private stdin
 * OUTPUT: one bounded no-shell/no-TTY child exchange; raw diagnostics are discarded
 * POS:    hindsight-host — process boundary below the fixed adapter, never a public command runner
 */
import { spawn } from "node:child_process";
import type { HindsightDeploymentRegistrationV1 } from "@taki/shared/hindsight-deployment";
import { join } from "node:path";
import { sanitizedEnvironment } from "./credential-source.ts";
import { DeploymentError } from "./deployment-error.ts";

export interface DockerExchange { argv: string[]; input?: Uint8Array; signal: AbortSignal; maxBytes?: number }
export function dockerExchange(registration: HindsightDeploymentRegistrationV1, request: DockerExchange): Promise<Buffer> {
  if (request.signal.aborted) return Promise.reject(new DeploymentError("snapshot-stale"));
  return new Promise((resolve, reject) => {
    const child = spawn(registration.docker.path, ["--config", join(registration.stateDirectory, "docker-config"),
      "--host", registration.docker.endpoint, ...request.argv], {
      cwd: registration.stateDirectory, env: sanitizedEnvironment(), windowsHide: true, shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let bytes = 0;
    let errors = 0;
    let failed = false;
    const chunks: Buffer[] = [];
    const stop = () => { failed = true; child.kill(); };
    request.signal.addEventListener("abort", stop, { once: true });
    if (request.signal.aborted) stop();
    child.on("error", stop);
    child.stdin.on("error", stop);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (request.maxBytes ?? 1024 * 1024)) { stop(); return; }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => { errors += chunk.length; if (errors > 16 * 1024) stop(); });
    child.on("close", (code) => {
      request.signal.removeEventListener("abort", stop);
      if (failed || code !== 0) reject(new DeploymentError("outcome-unknown"));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(request.input);
  });
}
