/**
 * INPUT:  resolved connection config, safe secret-generation marker, and a focused Hindsight client
 * OUTPUT: ordered read-only compatibility validation plus a normalized exact-build projection/fingerprint
 * POS:    core/memory/hindsight — fail-closed gate before any Bank/template mutation; independent of Memory Authority
 */
import { createHash } from "node:crypto";
import {
  HINDSIGHT_API_VERSION,
  HINDSIGHT_COMPATIBILITY_BUILD,
  HINDSIGHT_NATIVE_RESULT_BUILD,
  HINDSIGHT_CURRENT_STATE_BUILD,
  HINDSIGHT_APPLICATION_STATE_BUILD,
  HINDSIGHT_TRANSITION_BUILD,
  HINDSIGHT_CONFIGURATION_BUILD,
  HINDSIGHT_TEMPLATE_BUILD,
  HINDSIGHT_TEMPLATE_BACKUP_BUILD,
  HINDSIGHT_COMPATIBILITY_VERSION,
  HindsightCompatibilityProjectionSchema,
  type HindsightCompatibilityProjection,
  type HindsightConnectionProjection,
} from "@taki/shared";
import type { HindsightClient } from "./hindsight-client.ts";
import type { HindsightCompatibilityWire } from "./hindsight-contracts.ts";
import { hindsightError } from "./hindsight-errors.ts";

const CONTRACT_VERSION = "1.0.0";

export interface HindsightCompatibilityResult {
  fingerprint: string;
  compatibility: HindsightCompatibilityProjection;
}

export interface HindsightCompatibilityService {
  validate(input: {
    connection: HindsightConnectionProjection;
    secretMarker: string;
    client: HindsightClient;
    signal?: AbortSignal;
  }): Promise<HindsightCompatibilityResult>;
}

export function createHindsightCompatibilityService(): HindsightCompatibilityService {
  return { validate: validateCompatibility };
}

async function validateCompatibility(input: {
  connection: HindsightConnectionProjection;
  secretMarker: string;
  client: HindsightClient;
  signal?: AbortSignal;
}): Promise<HindsightCompatibilityResult> {
  const context = { timeoutMs: input.connection.requestTimeoutMs, signal: input.signal };
  const health = await input.client.health(context);
  if (health.status !== "healthy" || health.database !== "connected") throw hindsightError("HINDSIGHT_HEALTH_FAILED");
  const version = await input.client.version(context);
  if (version.apiVersion !== HINDSIGHT_API_VERSION) throw hindsightError("HINDSIGHT_VERSION_UNSUPPORTED");
  const manifest = await input.client.compatibility(context);
  const compatibility = projectHindsightCompatibilityManifest(manifest);
  return { fingerprint: fingerprint(input.connection, input.secretMarker), compatibility };
}

export function projectHindsightCompatibilityManifest(manifest: HindsightCompatibilityWire): HindsightCompatibilityProjection {
  const build = manifest.source_identity.compatibility_build;
  if (manifest.base_api_version !== HINDSIGHT_API_VERSION || manifest.compatibility_version !== HINDSIGHT_COMPATIBILITY_VERSION ||
      ![HINDSIGHT_COMPATIBILITY_BUILD, HINDSIGHT_NATIVE_RESULT_BUILD, HINDSIGHT_CURRENT_STATE_BUILD, HINDSIGHT_APPLICATION_STATE_BUILD, HINDSIGHT_TRANSITION_BUILD, HINDSIGHT_CONFIGURATION_BUILD, HINDSIGHT_TEMPLATE_BUILD, HINDSIGHT_TEMPLATE_BACKUP_BUILD].includes(build)) {
    throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  }
  if (manifest.provider.database_dialect !== "postgresql" || manifest.provider.storage_mode !== "sql_rows" || manifest.provider.lineage === null) {
    throw hindsightError("HINDSIGHT_DATABASE_UNSUPPORTED");
  }
  if (!supported(manifest.support) || manifest.journal.schema_version !== 1 || !manifest.journal.cursor_reset_supported || manifest.snapshot.schema_version !== 1) {
    throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  }
  const contracts = [manifest.contracts.change_journal, manifest.contracts.conditional_mutation, manifest.contracts.logical_snapshot,
    manifest.contracts.additive_observation_instructions, manifest.contracts.controlled_layer_projection];
  if (contracts.some((contract) => contract.version !== CONTRACT_VERSION || !supported(contract.support))) {
    throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  }
  return HindsightCompatibilityProjectionSchema.parse({
    baseApiVersion: manifest.base_api_version,
    compatibilityVersion: manifest.compatibility_version,
    compatibilityBuild: manifest.source_identity.compatibility_build,
    providerLineage: manifest.provider.lineage,
    databaseDialect: manifest.provider.database_dialect,
    storageMode: manifest.provider.storage_mode,
    support: manifest.support,
    journalVersion: manifest.journal.schema_version,
    snapshotVersion: manifest.snapshot.schema_version,
    contracts: {
      changeJournal: manifest.contracts.change_journal,
      conditionalMutation: manifest.contracts.conditional_mutation,
      logicalSnapshot: manifest.contracts.logical_snapshot,
      additiveObservationInstructions: manifest.contracts.additive_observation_instructions,
      controlledLayerProjection: manifest.contracts.controlled_layer_projection,
      ...(manifest.contracts.native_results ? { nativeResults: manifest.contracts.native_results } : {}),
      ...(manifest.contracts.current_state_transfer ? { currentStateTransfer: manifest.contracts.current_state_transfer } : {}),
      ...(manifest.contracts.cutover_verification ? { cutoverVerification: manifest.contracts.cutover_verification } : {}),
      ...(manifest.contracts.application_state ? { applicationState: {
        version: manifest.contracts.application_state.version, support: manifest.contracts.application_state.support } } : {}),
      ...(manifest.contracts.application_reflect ? { applicationReflect: {
        version: manifest.contracts.application_reflect.version, support: manifest.contracts.application_reflect.support } } : {}),
      ...(manifest.contracts.transitions ? { transitions: manifest.contracts.transitions } : {}),
      ...(manifest.contracts.configuration_observation ? { configurationObservation: manifest.contracts.configuration_observation } : {}),
      ...(manifest.contracts.template_lifecycle ? { templateLifecycle: manifest.contracts.template_lifecycle } : {}),
      ...(manifest.contracts.template_backup ? { templateBackup: manifest.contracts.template_backup } : {}),
    },
  });
}

function supported(value: { state: string; reason: string }): boolean {
  return value.state === "supported" && value.reason === "all_contracts_available";
}

export function hindsightConnectionFingerprint(connection: HindsightConnectionProjection, secretMarker: string): string {
  return fingerprint(connection, secretMarker);
}

function fingerprint(connection: HindsightConnectionProjection, secretMarker: string): string {
  // This is the established settings/secret identity, not a hash of the accepted-build list. New independently
  // negotiated cutover capabilities must not change already-frozen G1 dispatch or B3 configuration identities.
  return createHash("sha256").update(JSON.stringify({
    endpoint: connection.endpoint,
    deploymentMode: connection.deploymentMode,
    requestTimeoutMs: connection.requestTimeoutMs,
    setupTimeoutMs: connection.setupTimeoutMs,
    desiredTemplateRevision: connection.desiredTemplateRevision,
    model: connection.model,
    secretMarker,
    apiVersion: HINDSIGHT_API_VERSION,
    compatibilityVersion: HINDSIGHT_COMPATIBILITY_VERSION,
    compatibilityBuild: HINDSIGHT_COMPATIBILITY_BUILD,
    nativeResultBuild: HINDSIGHT_NATIVE_RESULT_BUILD,
  })).digest("hex");
}
