/**
 * INPUT:  protected operator registration and versioned compiled C1 artifact manifests
 * OUTPUT: fixed installation/runtime/custody identities; no request-selectable path or key adapter
 * POS:    shared/protocol — schemas describe identities; actual OS handles establish installation trust
 */
import { z } from "zod";
import { HindsightCustodyDigestSchema } from "./hindsight-custody-schema.ts";

export const HINDSIGHT_HOST_BUILD = "taki-hindsight-host-c1-v1";
const path = z.string().min(1).max(4096).refine((value) => !value.includes("\0"));
const relativePath = z.string().min(1).max(1024).regex(/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/)
  .refine((value) => value.split("/").every((part) => part !== "." && part !== ".."));
const artifact = z.strictObject({ path: relativePath, sha256: HindsightCustodyDigestSchema });

export const HindsightHostManifestSchema = z.strictObject({
  version: z.literal(1),
  build: z.literal(HINDSIGHT_HOST_BUILD),
  platform: z.enum(["win32", "linux"]),
  architecture: z.enum(["x64", "arm64"]),
  entrypoint: z.literal("app/main.js"),
  files: z.array(artifact).min(1).refine((files) => new Set(files.map((entry) => entry.path)).size === files.length, "duplicate artifact"),
});
export type HindsightHostManifest = z.infer<typeof HindsightHostManifestSchema>;

const executable = z.strictObject({ path, sha256: HindsightCustodyDigestSchema });
const runtime = executable.extend({ version: z.string().regex(/^v24\.[0-9]+\.[0-9]+$/) });
const windowsCustody = z.strictObject({
  kind: z.literal("windows-keyring"),
  tokenUserSha256: HindsightCustodyDigestSchema,
  service: z.literal("TakiAgent"),
  account: z.literal("secret-catalog-master-key-v1"),
  adapter: executable,
});
const ubuntuCustody = z.strictObject({
  kind: z.literal("systemd"),
  uid: z.number().int().nonnegative(),
  service: z.literal("taki-hindsight-host.service"),
  keyCredential: z.literal("taki-secret-catalog-master-key"),
  nodeCredential: z.literal("taki-hindsight-host-node"),
});

export const HindsightHostRegistrationSchema = z.strictObject({
  version: z.literal(1),
  installationId: HindsightCustodyDigestSchema,
  manifestSha256: HindsightCustodyDigestSchema,
  installationRoot: path,
  runtime,
  coreHostId: z.uuid(),
  executionHostId: z.uuid(),
  catalogStoreId: z.uuid(),
  coreDataDirectory: path,
  catalogKeyVersion: z.number().int().positive(),
  custody: z.discriminatedUnion("kind", [windowsCustody, ubuntuCustody]),
});
export type HindsightHostRegistration = z.infer<typeof HindsightHostRegistrationSchema>;

// This separate credential never shares an account/file with the Catalog key. Pairing produces its token.
export const HindsightNodeCredentialSchema = z.strictObject({
  version: z.literal(1), deviceId: z.uuid(), token: z.string().min(1).max(4096),
  coreUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (url.protocol === "ws:" || url.protocol === "wss:") && url.username === "" && url.password === "";
  }),
});
export type HindsightNodeCredential = z.infer<typeof HindsightNodeCredentialSchema>;

export const HindsightNodeEnrollmentSchema = z.strictObject({
  coreUrl: HindsightNodeCredentialSchema.shape.coreUrl,
  pairingCode: z.string().regex(/^[0-9]{6}$/).optional(),
});
export const HindsightHostDiagnosticSchema = z.strictObject({
  version: z.literal(1), state: z.literal("diagnostic"), installationId: HindsightCustodyDigestSchema, deploymentReady: z.literal(false),
});
export const HindsightHostEnrolledSchema = z.strictObject({
  version: z.literal(1), state: z.literal("enrolled"), deploymentReady: z.literal(false),
});
