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

export function composeMemoryTransitions(input: { db: Database; config: ConfigSource; secrets: SecretCatalogService;
  runtime: ReturnType<typeof composeMemoryRuntime>; ownerId: string; actorId: string; logger: Logger;
  client?: HindsightClient; now?: () => string; maintenanceTimeoutMs?: number }) {
  const secret = createHindsightConnectionSecret(input.secrets);
  const connection = () => { const value = resolveHindsightConfig(input.config); return value.state === "ready" ? value.projection : null; };
  return createHealthyTransitionService({ db: input.db, ownerId: input.ownerId, actorId: input.actorId,
    runtime: input.runtime.transitions, now: input.now ?? (() => new Date().toISOString()), logger: input.logger,
    requestTimeoutMs: connection()?.requestTimeoutMs ?? 60_000, maintenanceTimeoutMs: input.maintenanceTimeoutMs ?? 600_000,
    fingerprint: () => { const value = connection(); return value ? hindsightConnectionFingerprint(value, secret.marker()) : null; },
    client: () => { const value = connection(); if (!value) throw new Error("MEMORY_TRANSITION_UNAVAILABLE");
      return input.client ?? createHindsightClient({ endpoint: value.endpoint, resolveApiKey: secret.resolve }); },
    ready: (epochId, provider) => {
      // No published subsystem means unavailable regardless of the receipt. Avoid rebuilding a large committed
      // corpus on every status poll while native finalization still needs the event loop and request deadline.
      if (!input.runtime.hasPublishedBinding(provider)) return false;
      const snapshot = provider === "local" ? input.runtime.bindingSnapshot() : input.runtime.hindsightBindingSnapshot();
      return snapshot.lifetime === "running" && snapshot.binding.kind === "published" && snapshot.binding.epochId === epochId;
    },
  });
}
