/**
 * INPUT:  one protected pre-provisioned registry, exact admitted plan and safe dispatch facts
 * OUTPUT: bounded original-resource records, flushed fences and atomic replacements
 * POS:    hindsight-host — sole mutable state writer under the Shell lifetime lock; no authority restoration
 */
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { HostOperationControlSchema } from "@taki/shared/host-control";
import { CapabilityAuthorizationLineageSchema } from "@taki/shared/host-control";
import {
  CustodyLinkV1Schema, DeploymentPlanV1Schema, DockerIdSchema, HINDSIGHT_DEPLOYMENT_LIMITS,
  canonicalDeploymentPlan,
} from "@taki/shared/hindsight-deployment";
import { directoryIdentity, readInstalledFile, sha256 } from "./installed-files.ts";
import { DeploymentError } from "./deployment-error.ts";

export const DeploymentAttemptSchema = z.strictObject({
  requestId: z.uuid(), control: HostOperationControlSchema, custody: CustodyLinkV1Schema,
  authorization: CapabilityAuthorizationLineageSchema.optional(), action: z.enum(["create", "start", "inject"]),
  startupId: z.uuid().optional(), checkpointId: z.uuid().optional(), startupAuthorizationId: z.uuid().optional(),
  startupDeadlineAt: z.iso.datetime({ offset: true }).optional(),
  phase: z.enum(["admitted", "checkpoint-dispatched", "grant-dispatched", "submit-dispatched", "observed"]),
});
export type DeploymentAttempt = z.infer<typeof DeploymentAttemptSchema>;
export const OwnedVolumeSchema = z.strictObject({ name: z.string().regex(/^taki-c2a-[a-f0-9-]{36}-data$/),
  driver: z.literal("local"), labels: z.record(z.string(), z.string().max(200)) });
const Step = z.enum(["dispatched", "verified"]);
const OwnedRecordSchema = z.strictObject({
  version: z.literal(1), state: z.literal("owned"), revision: z.number().int().positive(),
  plan: DeploymentPlanV1Schema, planDigest: z.string().regex(/^[0-9a-f]{64}$/),
  volume: OwnedVolumeSchema.optional(), containerId: DockerIdSchema.optional(),
  steps: z.strictObject({ volume: Step.optional(), container: Step.optional(), start: Step.optional() }),
  attempts: z.array(DeploymentAttemptSchema).max(HINDSIGHT_DEPLOYMENT_LIMITS.attempts),
}).refine((value) => sha256(canonicalDeploymentPlan(value.plan)) === value.planDigest
  && new Set(value.attempts.map((entry) => entry.requestId)).size === value.attempts.length
  && new Set(value.attempts.filter((entry) => entry.action === "inject").map((entry) => entry.startupId)).size
    === value.attempts.filter((entry) => entry.action === "inject").length, "invalid deployment history");
export type OwnedDeploymentRecord = z.infer<typeof OwnedRecordSchema>;
const RegistrySchema = z.union([
  z.strictObject({ version: z.literal(1), revision: z.literal(0), state: z.literal("vacant") }), OwnedRecordSchema,
]);
export type DeploymentRecord = z.infer<typeof RegistrySchema>;

export class DeploymentRegistry {
  readonly path: string;
  private readonly root: string;
  private readonly rootIdentity: string;
  private original: string;
  private value: DeploymentRecord;

  constructor(root: string) {
    this.root = root;
    this.rootIdentity = directoryIdentity(root);
    this.path = join(root, "deployment.json");
    const source = this.read();
    this.original = sha256(source);
    try { this.value = RegistrySchema.parse(JSON.parse(source.toString("utf8"))); }
    catch { throw new DeploymentError("registry-unavailable"); }
  }

  snapshot(): DeploymentRecord {
    this.validate();
    return structuredClone(this.value);
  }

  validate(): void {
    if (directoryIdentity(this.root) !== this.rootIdentity || sha256(this.read()) !== this.original) {
      throw new DeploymentError("registry-unavailable");
    }
  }

  publish(candidate: OwnedDeploymentRecord): void {
    this.validate();
    const value = OwnedRecordSchema.parse(candidate);
    if (value.revision !== this.value.revision + 1) throw new DeploymentError("registry-unavailable");
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    if (bytes.length > HINDSIGHT_DEPLOYMENT_LIMITS.registryBytes) throw new DeploymentError("registry-full");
    const staging = join(this.root, `.deployment-${randomUUID()}.staging`);
    const fd = openSync(staging, "wx", 0o600);
    let published = false;
    try {
      writeFileSync(fd, bytes); fsyncSync(fd);
      closeSync(fd);
      this.validate();
      renameSync(staging, this.path);
      published = true;
      this.original = sha256(bytes);
      this.value = value;
      this.validate();
    } finally {
      // No cleanup ever addresses an external resource or an unknown staging file.
      if (!published) {
        try { closeSync(fd); } catch { /* already closed before rename */ }
        unlinkSync(staging);
      }
    }
    // Windows file flush + atomic replacement proves process-crash recovery;
    // no directory-fsync fallback is presented as power-loss durability.
  }

  private read(): Buffer {
    try { return readInstalledFile(this.path, HINDSIGHT_DEPLOYMENT_LIMITS.registryBytes).bytes; }
    catch { throw new DeploymentError("registry-unavailable"); }
  }
}
