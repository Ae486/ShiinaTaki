/**
 * INPUT:  current Core config/secret custody, sole operation owner identity and composed memory runtime
 * OUTPUT: healthy return/reentry service using the actual authenticated native transport and W4 handoff
 * POS:    core/boot — construction is offline; capability probes happen only on explicit preview/execution
 */
import type { ConfigSource } from "../config/config-source.ts";
import { resolveHindsightConfig } from "../config/hindsight-config.ts";
import type { Database } from "../db/sqlite.ts";
import type { Logger } from "../logging/logger.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import { createHindsightConnectionSecret } from "../memory/hindsight/hindsight-secret-refs.ts";
import { createHindsightClient, type HindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { hindsightConnectionFingerprint } from "../memory/hindsight/hindsight-compatibility-service.ts";
import type { composeMemoryRuntime } from "../memory/runtime-composition.ts";
import { createHealthyTransitionService } from "../memory/transitions/transition-healthy-service.ts";
import { createTransitionPublicationObserver } from "../db/memory-transition-publication-reader.ts";
import type { TransitionEvidenceContext } from "../memory/transitions/transition-evidence-context.ts";
import type { MemoryTransitionPreview, MemoryHealthyTransitionPreview, MemoryEmergencyTransitionPreview } from "@taki/shared";
import type { MemoryTransitionDriver } from "../memory/operations/memory-operation-transition-storage.ts";
import { createEmergencyTransitionService } from "../memory/transitions/transition-emergency-service.ts";
import { createHindsightBackupStore } from "../memory/hindsight-backup/hindsight-backup-store.ts";
import type { HindsightBackupService } from "../memory/hindsight-backup/hindsight-backup-service.ts";
import type { HindsightLifecycleService } from "../memory/hindsight-lifecycle/hindsight-lifecycle-service.ts";

export function composeMemoryTransitions(input: { db: Database; config: ConfigSource; secrets: SecretCatalogService;
  runtime: ReturnType<typeof composeMemoryRuntime>; ownerId: string; actorId: string; logger: Logger;
  client?: HindsightClient; now?: () => string; maintenanceTimeoutMs?: number; backup?: HindsightBackupService; lifecycle?: HindsightLifecycleService }) {
  const secret = createHindsightConnectionSecret(input.secrets);
  const connection = () => { const value = resolveHindsightConfig(input.config); return value.state === "ready" ? value.projection : null; };
  const readiness = createReadiness(input.db, input.runtime);
  const service = createHealthyTransitionService({ db: input.db, ownerId: input.ownerId, actorId: input.actorId,
    runtime: input.runtime.transitions, now: input.now ?? (() => new Date().toISOString()), logger: input.logger,
    requestTimeoutMs: connection()?.requestTimeoutMs ?? 60_000, maintenanceTimeoutMs: input.maintenanceTimeoutMs ?? 600_000,
    fingerprint: () => { const value = connection(); return value ? hindsightConnectionFingerprint(value, secret.marker()) : null; },
    client: () => { const value = connection(); if (!value) throw new Error("MEMORY_TRANSITION_UNAVAILABLE");
      return input.client ?? createHindsightClient({ endpoint: value.endpoint, resolveApiKey: secret.resolve }); },
    ready: readiness.ready, observeReady: readiness.observe,
  });
  const emergency = createEmergencyTransitionService({ db: input.db, ownerId: input.ownerId, actorId: input.actorId,
    runtime: input.runtime.transitions, now: input.now ?? (() => new Date().toISOString()), ready: readiness.ready,
    store: createHindsightBackupStore(input.runtime.dataDir), backup: input.backup, logger: input.logger });
  const driver: MemoryTransitionDriver = {
    plan: (request, verification) => (request.kind === "transition.emergency-local" ? emergency : service).plan(request, verification),
    execute: (execution) => (execution.request.kind === "transition.emergency-local" ? emergency : service).execute(execution),
    emergencyAdmitted: (epochId) => { service.quarantine(); input.lifecycle?.retireEpoch?.(epochId); emergency.emergencyAdmitted?.(epochId); },
  };
  function preview(params: { kind: MemoryHealthyTransitionPreview["kind"]; recoveryTransitionId?: string }): Promise<MemoryHealthyTransitionPreview>;
  function preview(params: { kind: "transition.emergency-local"; recoveryTransitionId?: string }): Promise<MemoryEmergencyTransitionPreview>;
  function preview(params: { kind: MemoryTransitionPreview["kind"]; recoveryTransitionId?: string }): Promise<MemoryTransitionPreview>;
  function preview(params: { kind: MemoryTransitionPreview["kind"]; recoveryTransitionId?: string }): Promise<MemoryTransitionPreview> {
    return params.kind === "transition.emergency-local" ? emergency.preview({ ...params, kind: params.kind }) : service.preview({ ...params, kind: params.kind });
  }
  return { ...driver, status: service.status, overview: service.overview, preview,
    stop: async () => { try { await Promise.all([service.stop(), emergency.stop()]); } finally { readiness.close(); } } };
}

function createReadiness(db: Database, runtime: ReturnType<typeof composeMemoryRuntime>) {
  const observer = createTransitionPublicationObserver(db); let bindingRevision: string | undefined;
  const ready = (epochId: string, provider: "local" | "hindsight", verification?: TransitionEvidenceContext) => {
      verification?.assertOwner(db); verification?.assertIndependent();
      // No published subsystem means unavailable regardless of the receipt. Avoid rebuilding a large committed
      // corpus on every status poll while native finalization still needs the event loop and request deadline.
      if (!runtime.hasPublishedBinding(provider)) return false;
      const snapshot = provider === "local" ? runtime.bindingSnapshot(verification) : runtime.hindsightBindingSnapshot(verification);
      return snapshot.lifetime === "running" && snapshot.binding.kind === "published" && snapshot.binding.epochId === epochId;
  };
  const observe = (epochId: string, provider: "local" | "hindsight") => {
    const local = runtime.bindingPublication("local"); const hindsight = runtime.bindingPublication("hindsight");
    const revision = `${local.revision}:${hindsight.revision}`;
    if (bindingRevision !== revision) { observer.reset(); bindingRevision = revision; }
    const state = provider === "local" ? local : hindsight;
    if (!runtime.hasPublishedBinding(provider) || state.lifetime !== "running"
      || state.binding.kind !== "published" || state.binding.epochId !== epochId) return false;
    const selected = observer.selected(revision);
    return selected ? selected.epochId === epochId && selected.provider === provider : ready(epochId, provider);
  };
  // Default committed-copy boot seeds full verification before any native request can be dispatched.
  for (const provider of ["local", "hindsight"] as const) {
    const state = runtime.bindingPublication(provider);
    if (state.lifetime === "running" && state.binding.kind === "published") observe(state.binding.epochId, provider);
  }
  return { ready, observe, close: observer.close };
}
