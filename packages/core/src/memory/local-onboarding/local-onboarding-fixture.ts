/**
 * INPUT:  the B2 legacy migration fixture (temp workspace + file-backed SQLite) and a programmable fake Local binding
 * OUTPUT: createLocalOnboardingHarness() -> { local, binding, changes, owner() } wiring the real service, runner and operation owner
 * POS:    core/memory/local-onboarding — test-only harness shared by the onboarding/kind/method tests; never imported by production code
 */
import { vi } from "vitest";
import type { MemoryOperation } from "@taki/shared";
import { createLogger } from "../../logging/logger.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { createLegacyMigrationFixture, type LegacyMigrationFixture } from "../legacy-migration/legacy-migration-fixture.ts";
import type { LocalBindingSnapshot, LocalBindingState } from "../local-runtime-binding.ts";
import { fakeSetup } from "../operations/memory-operation-fixtures.ts";
import { createMemoryOperationService, type MemoryOperationService } from "../operations/memory-operation-service.ts";
import { createLocalOnboardingService, type LocalOnboardingService, type OnboardingChangeReason } from "./local-onboarding-service.ts";
import { readLocalOnboardingStatus } from "./local-onboarding-status.ts";

export interface FakeBinding { state: LocalBindingState; stopped: boolean; publishFails: boolean; recoverable: number }

export interface OnboardingOwner {
  service: MemoryOperationService;
  changes: MemoryOperation[];
  status(): ReturnType<typeof readLocalOnboardingStatus>;
}

export interface LocalOnboardingHarness {
  f: LegacyMigrationFixture;
  local: LocalOnboardingService;
  binding: FakeBinding;
  changes: OnboardingChangeReason[];
  recover: ReturnType<typeof vi.fn>;
  /** A fresh operation owner over the same database; a different bootId simulates a Core restart. */
  owner(bootId?: string): OnboardingOwner;
  tick(): Promise<void>;
}

export function createLocalOnboardingHarness(options: { entries?: Record<string, string>; publishFails?: boolean } = {}): LocalOnboardingHarness {
  const binding: FakeBinding = { state: { kind: "none" }, stopped: false, publishFails: options.publishFails ?? false, recoverable: 0 };
  const publish = (epochId: string): void => {
    if (binding.publishFails) {
      binding.state = { kind: "unavailable", epochId, code: "MEMORY_LOCAL_BINDING_FAILED" };
      throw new Error("MEMORY_INTEGRITY_ERROR: fixture binding failed");
    }
    binding.state = { kind: "published", epochId };
  };
  const f = createLegacyMigrationFixture({ entries: options.entries, deps: { onActivated: publish } });
  const recover = vi.fn((epochId: string) => {
    const selection = readMemoryAuthoritySelection(f.db);
    if (selection.mode !== "canonical-local" || selection.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    const reconciledGroups = binding.recoverable; binding.recoverable = 0;
    if (binding.state.kind === "published") return { binding: "healthy" as const, reconciledGroups };
    publish(epochId);
    return { binding: "published" as const, reconciledGroups };
  });
  const changes: OnboardingChangeReason[] = [];
  const local = createLocalOnboardingService({
    db: f.db, workspaceRoot: f.workspace, runner: async () => f.runner, owner: "boot-a", now: () => f.clock.now, onChanged: (reason) => changes.push(reason),
    runtime: {
      bindingSnapshot: (): LocalBindingSnapshot => {
        const selection = readMemoryAuthoritySelection(f.db);
        return { selection: selection.mode, selectedEpochId: selection.epochId, binding: binding.state,
          lifetime: binding.stopped ? "stopped" : "running", flush: binding.state.kind === "published" && !binding.stopped ? "available" : "failing" };
      },
      recoverLocalBinding: recover,
      custody: { status: () => ({ openGroups: binding.recoverable, recoverableGroups: binding.recoverable }) },
    },
  });
  return {
    f, local, binding, changes, recover,
    owner: (bootId = "boot-a") => {
      const operations: MemoryOperation[] = [];
      const service = createMemoryOperationService({ db: f.db, live: () => null, setup: fakeSetup(), local, bootId, now: () => f.clock.now,
        onChanged: (operation) => operations.push(operation), logger: createLogger("fatal") });
      return { service, changes: operations, status: () => readLocalOnboardingStatus({ local, operations: service, now: () => f.clock.now }) };
    },
    tick: () => new Promise<void>((done) => setImmediate(done)),
  };
}
