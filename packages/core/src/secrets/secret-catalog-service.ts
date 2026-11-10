/**
 * INPUT:  <dataDir>/secret-catalog.bin + a MasterKeySource (or none) + the owning Core storeId (hostId)
 * OUTPUT: createSecretCatalogService() -> async factory (awaits the Wasm load); set/clear/presence/list (operator
 *         surface shapes), resolve/verifyEntries (internal non-WS seam), rotateToKey/backup/restore, health()
 * POS:    core/secrets — the owning-Host catalog authority: writes are whole-file re-seals through the staged
 *         fsync/rename publication (old-or-new, never half), a locked or unreadable store fails every mutation
 *         closed WITHOUT rewriting the file, and no API returns a value except the internal resolver
 */
import { existsSync, readFileSync } from "node:fs";
import type { Logger } from "../logging/logger.ts";
import { SecretRefSchema, type SecretCatalogHealth, type SecretProvenance } from "@taki/shared";
import type { MasterKeySource } from "./master-key.ts";
import { publishFileAtomically } from "./catalog-publication.ts";
import {
  SECRET_CATALOG_FORMAT_VERSION,
  SecretCatalogError,
  generateCatalogKey,
  isSecretCatalogKey,
  openCatalog,
  sealCatalog,
  sodiumReady,
  type SecretCatalogPlain,
} from "./secret-catalog-envelope.ts";

export type { SecretCatalogHealth };

/** Bounded refusal reason riding SECRET_REFUSED; storage failures stay sanitized categories, never causes. */
export type SecretRefusalReason = "store-locked" | "store-unreadable" | "store-unsupported" | "store-write-failed";

export class SecretRefusalError extends Error {
  readonly reason: SecretRefusalReason;

  constructor(reason: SecretRefusalReason) {
    super(`secret catalog refused the operation (${reason})`);
    this.reason = reason;
    this.name = "SecretRefusalError";
  }
}

export interface SecretCatalogService {
  health(): SecretCatalogHealth;
  set(secretRef: string, value: string): { present: true; provenance: SecretProvenance };
  clear(secretRef: string): { present: false };
  presence(secretRef: string): { secretRef: string; present: boolean; provenance: SecretProvenance | null; health: SecretCatalogHealth };
  list(): { health: SecretCatalogHealth; entries: Array<{ secretRef: string; present: boolean; provenance: SecretProvenance | null; health: SecretCatalogHealth }> };
  /** Internal non-WS resolver — MCP connect resolution and migration verification only; NEVER a WS result. */
  resolve(secretRef: string): string | null;
  /** Verifies stored values against expectations WITHOUT returning them (migration read-back proof). */
  verifyEntries(expected: Record<string, string>): boolean;
  /** Re-seal the whole catalog under a new key (keyVersion + 1), atomically; the caller owns key provisioning. */
  rotateToKey(newKey: Uint8Array): { keyVersion: number };
  /** The durable envelope bytes plus public metadata — the backup artifact (never the master key). */
  backup(): { envelope: Uint8Array; version: number; keyVersion: number };
  /** Accepts a backup envelope only after full open/verification against the current key and store. */
  restore(envelope: Uint8Array): void;
}

export interface SecretCatalogDeps {
  filePath: string;
  /** The owning Core host UUID — bound into the envelope AAD so ciphertext cannot be repurposed between stores. */
  storeId: string;
  keySource: MasterKeySource | null;
  logger: Logger;
  now?: () => string;
}

/** The mutable single-writer state every operation below closes over (synchronous ops = serialized by design). */
interface CatalogState {
  deps: SecretCatalogDeps;
  health: SecretCatalogHealth;
  key: Uint8Array | null;
  data: SecretCatalogPlain | null;
}

export async function createSecretCatalogService(deps: SecretCatalogDeps): Promise<SecretCatalogService> {
  await sodiumReady; // one Wasm load per process; every op below is then synchronous (single-writer by construction)
  const state: CatalogState = { deps, health: "locked", key: null, data: null };
  loadInitialState(state);
  deps.logger.child({ mod: "secrets" }).info({ health: state.health, keySource: deps.keySource?.kind ?? "none" }, "secret catalog opened");
  return {
    health: () => state.health,
    set: (secretRef, value) => setSecret(state, secretRef, value),
    clear: (secretRef) => clearSecret(state, secretRef),
    presence: (secretRef) => presenceOf(state, secretRef),
    list: () => listAll(state),
    resolve: (secretRef) => (state.health === "ok" && state.data !== null ? state.data.entries[secretRef]?.value ?? null : null),
    verifyEntries: (expected) =>
      state.health === "ok" &&
      state.data !== null &&
      Object.entries(expected).every(([ref, value]) => state.data?.entries[ref]?.value === value),
    rotateToKey: (newKey) => rotateKey(state, newKey),
    backup: () => backupOf(state),
    restore: (envelope) => restoreEnvelope(state, envelope),
  };
}

function loadInitialState(state: CatalogState): void {
  const { deps } = state;
  const catalogExists = existsSync(deps.filePath);
  if (deps.keySource === null) return; // stays locked
  try {
    state.key = deps.keySource.read();
    if (state.key === null && deps.keySource.canCreate && !catalogExists) {
      // Another native creator may win. Only the durable read-back key can open this Host's catalog.
      try { deps.keySource.create(generateCatalogKey()); } catch { /* Re-read a concurrent create-only winner. */ }
      state.key = deps.keySource.read();
    }
  } catch { state.key = null; }
  if (state.key === null) return; // absent key + existing catalog = LOCKED, not a fresh store (never mint-over)
  if (!catalogExists) {
    // Fresh store: in-memory empty catalog; the file appears only on the first durable write.
    state.data = {
      version: SECRET_CATALOG_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      keyVersion: 1,
      storeId: deps.storeId,
      entries: {},
    };
    state.health = "ok";
    return;
  }
  try {
    state.data = openCatalog(readFileSync(deps.filePath), state.key, deps.storeId);
    state.health = "ok";
  } catch (error) {
    state.data = null;
    state.health = error instanceof SecretCatalogError && error.reason === "unsupported-version" ? "unsupported" : "unreadable";
    // The file is preserved verbatim for inspection — never rewritten, never mangled (PRD AC2).
  }
}

function requireOk(state: CatalogState): SecretCatalogPlain {
  if (state.health !== "ok" || state.data === null) {
    throw new SecretRefusalError(
      state.health === "locked" ? "store-locked" : state.health === "unsupported" ? "store-unsupported" : "store-unreadable",
    );
  }
  return state.data;
}

function publish(state: CatalogState, next: SecretCatalogPlain, mode: "create-only" | "replace"): void {
  try {
    const sealed = sealCatalog(next, state.key as Uint8Array);
    // create-only EEXIST means another process published first — fail closed rather than clobber their secrets.
    if (publishFileAtomically(state.deps.filePath, sealed, mode) === "already-exists") {
      throw new SecretRefusalError("store-write-failed");
    }
    state.data = next; // last-known-good swap only after durable publication
  } catch (error) {
    if (error instanceof SecretRefusalError || error instanceof SecretCatalogError) throw error;
    throw new SecretRefusalError("store-write-failed");
  }
}

function setSecret(state: CatalogState, secretRef: string, value: string): { present: true; provenance: SecretProvenance } {
  SecretRefSchema.parse(secretRef); // ref charset enforced at the service boundary too
  if (state.health === "locked") loadInitialState(state);
  const current = requireOk(state);
  const updatedAt = new Date().toISOString();
  const next: SecretCatalogPlain = { ...current, entries: { ...current.entries, [secretRef]: { value, updatedAt } } };
  publish(state, next, existsSync(state.deps.filePath) ? "replace" : "create-only");
  state.deps.logger.child({ mod: "secrets" }).info({ secretRef }, "secret stored"); // ref only — never values (AC1)
  return { present: true, provenance: { source: "catalog", keyVersion: next.keyVersion, updatedAt } };
}

function clearSecret(state: CatalogState, secretRef: string): { present: false } {
  if (state.health === "locked") loadInitialState(state);
  const current = requireOk(state);
  if (current.entries[secretRef] === undefined) return { present: false };
  const next: SecretCatalogPlain = { ...current, entries: { ...current.entries } };
  delete next.entries[secretRef];
  publish(state, next, "replace");
  state.deps.logger.child({ mod: "secrets" }).info({ secretRef }, "secret cleared");
  return { present: false };
}

function presenceOf(
  state: CatalogState,
  secretRef: string,
): { secretRef: string; present: boolean; provenance: SecretProvenance | null; health: SecretCatalogHealth } {
  if (state.health !== "ok" || state.data === null) {
    return { secretRef, present: false, provenance: null, health: state.health };
  }
  const entry = state.data.entries[secretRef];
  return {
    secretRef,
    present: entry !== undefined,
    provenance: entry === undefined ? null : { source: "catalog", keyVersion: state.data.keyVersion, updatedAt: entry.updatedAt },
    health: state.health,
  };
}

function listAll(state: CatalogState): ReturnType<SecretCatalogService["list"]> {
  if (state.health !== "ok" || state.data === null) return { health: state.health, entries: [] };
  return { health: state.health, entries: Object.keys(state.data.entries).map((ref) => presenceOf(state, ref)) };
}

function rotateKey(state: CatalogState, newKey: Uint8Array): { keyVersion: number } {
  const current = requireOk(state);
  if (!isSecretCatalogKey(newKey)) throw new SecretRefusalError("store-write-failed");
  const next: SecretCatalogPlain = { ...current, keyVersion: current.keyVersion + 1 };
  try {
    const sealed = sealCatalog(next, newKey);
    if (publishFileAtomically(state.deps.filePath, sealed, "replace") === "already-exists") {
      throw new SecretRefusalError("store-write-failed");
    }
  } catch (error) {
    if (error instanceof SecretRefusalError) throw error;
    throw new SecretRefusalError("store-write-failed");
  }
  state.key = newKey;
  state.data = next;
  return { keyVersion: next.keyVersion };
}

function backupOf(state: CatalogState): { envelope: Uint8Array; version: number; keyVersion: number } {
  const current = requireOk(state);
  return { envelope: readFileSync(state.deps.filePath), version: current.version, keyVersion: current.keyVersion };
}

function restoreEnvelope(state: CatalogState, envelope: Uint8Array): void {
  requireOk(state);
  // Validate fully against the CURRENT key + store BEFORE accepting — a bad backup is refused, not published.
  const restored = openCatalog(envelope, state.key as Uint8Array, state.deps.storeId);
  publishFileAtomically(state.deps.filePath, envelope, "replace");
  state.data = restored;
  state.deps.logger.child({ mod: "secrets" }).info(
    { keyVersion: restored.keyVersion, entries: Object.keys(restored.entries).length },
    "secret catalog restored",
  );
}
