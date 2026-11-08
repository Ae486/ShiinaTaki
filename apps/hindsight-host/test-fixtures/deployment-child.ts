/**
 * INPUT:  a marked fake fixture and test-parent-owned finite engine over inherited IPC
 * OUTPUT: the real resident protocol/DeploymentOwner/registry with only its Docker adapter substituted
 * POS:    hindsight-host/tests — no installed CLI switch, Windows trust claim or original key access
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HindsightHostRegistrationSchema } from "@taki/shared/hindsight-installation";
import { HindsightDeploymentRegistrationV1Schema, type NativeBootstrapStatus } from "@taki/shared/hindsight-deployment";
import { DeploymentOwner } from "../src/deployment-owner.ts";
import { DeploymentRegistry } from "../src/deployment-registry.ts";
import { serveDeploymentRequests } from "../src/deployment-host.ts";
import { DeploymentError } from "../src/deployment-error.ts";
import { sha256 } from "../src/installed-files.ts";
import type { DeploymentDockerAdapter, OwnedInspection } from "../src/docker-adapter.ts";

let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
process.on("message", (message: { id: number; value?: unknown; failed?: boolean }) => {
  const entry = pending.get(message.id);
  pending.delete(message.id);
  if (message.failed) entry?.reject(new DeploymentError("outcome-unknown"));
  else entry?.resolve(message.value);
});

async function engine(method: keyof DeploymentDockerAdapter, args: unknown[], signal: AbortSignal): Promise<unknown> {
  const id = sequence++;
  const controller = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  let abort: (() => void) | undefined;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => { pending.delete(id); reject(new DeploymentError("outcome-unknown")); };
      if (controller.aborted) { abort(); return; }
      controller.addEventListener("abort", abort, { once: true });
      pending.set(id, { resolve, reject });
      process.send?.({ id, method, args });
    });
  } finally { if (abort) controller.removeEventListener("abort", abort); }
}
const adapter: DeploymentDockerAdapter = {
  inspectEngine: async (signal) => { await engine("inspectEngine", [], signal); },
  inspectImage: async (signal) => { await engine("inspectImage", [], signal); },
  inspectOwned: async (plan, signal) => await engine("inspectOwned", [plan], signal) as OwnedInspection,
  createVolume: async (plan, signal) => { await engine("createVolume", [plan], signal); },
  createContainer: async (plan, signal) => { await engine("createContainer", [plan], signal); },
  startContainer: async (id, signal) => { await engine("startContainer", [id], signal); },
  control: async (id, request, signal) => await engine("control", [id, request], signal) as NativeBootstrapStatus,
  submit: async (id, bytes, signal) => await engine("submit", [id, bytes], signal) as NativeBootstrapStatus,
};

async function main(): Promise<void> {
  const root = process.argv[2];
  if (!root || readFileSync(join(root, ".c2a-owned-fixture"), "utf8") !== "C2A_FAKE_ONLY") throw new Error("fixture required");
  const registration = HindsightHostRegistrationSchema.parse(JSON.parse(readFileSync(join(root, "installation.json"), "utf8")));
  const content = readFileSync(join(root, "deployment-registration.json"));
  const deployment = HindsightDeploymentRegistrationV1Schema.parse(JSON.parse(content.toString("utf8")));
  await serveDeploymentRequests((request) => new DeploymentOwner({ registration: deployment, registrationSha256: sha256(content),
    installation: { registration, registrationPath: join(root, "installation.json"), owner: request.owner, validate() {
      if (readFileSync(join(root, ".c2a-owned-fixture"), "utf8") !== "C2A_FAKE_ONLY") throw new Error("fixture removed");
    } }, registry: new DeploymentRegistry(deployment.stateDirectory), adapter, validate() {
      if (sha256(readFileSync(join(root, "deployment-registration.json"))) !== sha256(content)) throw new Error("fixture changed");
    } }));
}
void main().catch(() => { process.exitCode = 1; }).finally(() => {
  // A rejected owner constructor leaves the resident iterator suspended on inherited stdin.
  process.stdin.destroy();
  process.disconnect?.();
});
