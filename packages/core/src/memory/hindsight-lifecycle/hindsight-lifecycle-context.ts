/**
 * INPUT:  the composition's live seams (database, config source, Secret Catalog, client factory, published runtime view,
 *         binding snapshot and replace seam) and any error a lifecycle producer raises
 * OUTPUT: HindsightLifecycleDeps / HindsightLifecycleCall (what provision and revalidate run against) and
 *         hindsightLifecycleErrorCode() (the closed lifecycle code for a thrown error)
 * POS:    core/memory/hindsight-lifecycle — shared producer contract; no I/O here
 */
import { MemoryHindsightLifecycleErrorCodeSchema, type HindsightConnectionProjection, type MemoryHindsightLifecycleErrorCode } from "@taki/shared";
import type { ConfigSource } from "../../config/config-source.ts";
import type { Database } from "../../db/sqlite.ts";
import type { Logger } from "../../logging/logger.ts";
import type { SecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import type { HindsightClient } from "../hindsight/hindsight-client.ts";
import type { HindsightBindingSnapshot } from "../hindsight-runtime-binding.ts";
import type { MemoryOperationsRuntime } from "../operations/memory-operation-contract.ts";
import type { HindsightTemplateLifecycleService } from "../hindsight/template-lifecycle/template-lifecycle-service.ts";

export interface HindsightLifecycleDeps {
  db: Database;
  config: ConfigSource;
  secrets: SecretCatalogService;
  client(projection: HindsightConnectionProjection): HindsightClient;
  /** The published Hindsight runtime view; null while unbound. */
  runtime(): MemoryOperationsRuntime | null;
  templates?: HindsightTemplateLifecycleService;
  binding(): HindsightBindingSnapshot;
  /** Same-epoch swap onto a runtime built from the live connection; rejects when construction or start fails. */
  replaceBinding(epochId: string): Promise<void>;
  logger: Logger;
  now(): string;
  wait(ms: number): Promise<void>;
}

/** One bounded producer call: aborted on the setup deadline or on service stop, never by the operation row. */
export interface HindsightLifecycleCall<P extends string> {
  signal: AbortSignal;
  checkpoint(phase: P): void;
}

export function hindsightLifecycleErrorCode(error: unknown,
  fallback: MemoryHindsightLifecycleErrorCode = "HINDSIGHT_LIFECYCLE_INTERNAL_ERROR"): MemoryHindsightLifecycleErrorCode {
  const parsed = MemoryHindsightLifecycleErrorCodeSchema.safeParse(error instanceof Error ? error.message : error);
  return parsed.success ? parsed.data : fallback;
}
