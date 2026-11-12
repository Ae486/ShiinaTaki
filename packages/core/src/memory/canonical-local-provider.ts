/**
 * INPUT:  Local provider repositories, the runtime's current-authority assertion and existing write fence
 * OUTPUT: Local provider ports with current identity and irreversible lifetime checks
 * POS:    core/memory — Local runtime adapter; ingestion drain survives quiescence but never retirement
 */
import type { CanonicalLocalWriteFence } from "./canonical-local-write-fence.ts";
import { createLocalMemoryProvider, type LocalMemoryProviderDeps } from "./local-memory-provider.ts";

export function createCanonicalLocalProvider(input: {
  deps: LocalMemoryProviderDeps;
  assertCurrentAuthority(): void;
  writeFence?: CanonicalLocalWriteFence;
}): ReturnType<typeof createLocalMemoryProvider> {
  const assertCurrent = input.assertCurrentAuthority;
  const maintenance = input.deps.maintenance;
  const provider = createLocalMemoryProvider({ ...input.deps, maintenance: maintenance ? { ...maintenance,
    ingest: (request) => { assertCurrent(); return maintenance.ingest(request); },
  } : undefined });
  const write = input.writeFence;
  return { ...provider,
    // Captured retention changes the policy only; authority and write-lifetime guards stay with the original binding.
    captureRetention: (intentionsDefaultDays: number) => createCanonicalLocalProvider({ ...input,
      deps: { ...input.deps, intentionsDefaultDays } }),
    retain: write ? (context, request) => write.admit(() => provider.retain(context, request)) : provider.retain,
    mutate: write ? (context, request) => write.admit(() => provider.mutate(context, request)) : provider.mutate,
    retainObserved: write ? (context, request) => write.admitSync(() => provider.retainObserved(context, request)) : provider.retainObserved,
    recall: (context, request) => { assertCurrent(); return provider.recall(context, request); },
    // Initial B4 activation flush remains allowed after quiescence; the shared assertion still rejects retirement.
    prepareIngestion: (request) => { assertCurrent(); return provider.prepareIngestion(request); },
    ingest: (context, request) => { assertCurrent(); return provider.ingest(context, request); },
    ingestionReceipt: (request) => { assertCurrent(); return provider.ingestionReceipt(request); },
  } satisfies typeof provider;
}
