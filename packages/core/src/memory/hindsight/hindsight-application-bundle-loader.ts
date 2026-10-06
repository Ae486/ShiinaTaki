/**
 * INPUT:  authenticated D77 manifests/events and one captured Bank namespace/deadline
 * OUTPUT: complete verified descriptor/body closures and a genuine native snapshot baseline when requested
 * POS:    core/memory/hindsight — network staging only; no downloaded partial page advances a replica checkpoint
 */
import { randomUUID } from "node:crypto";
import {
  HINDSIGHT_APPLICATION_DEFAULT_TTL_SECONDS, type TakiApplicationBodyRef, type TakiApplicationSelector,
  type TakiApplicationArtifactKey, type TakiApplicationReadBundleManifest, type TakiApplicationStateChangeManifest,
  type TakiApplicationRecordPage,
} from "@taki/shared";
import type { HindsightClient, HindsightCallContext } from "./hindsight-client.ts";
import type { HindsightApplicationClient } from "./hindsight-application-client.ts";
import { hindsightApplicationDeadline, loadHindsightApplicationBody } from "./hindsight-application-body-transfer.ts";
import {
  verifyHindsightApplicationBundle, verifyHindsightApplicationEvent, verifyHindsightApplicationNativeBaseline,
  type HindsightApplicationBundle, type HindsightApplicationEvent,
} from "./hindsight-application-bundle.ts";
import { sameApplicationValue, verifyHindsightApplicationBody,
  type HindsightApplicationBody, type HindsightApplicationScope } from "./hindsight-application-integrity.ts";

// Bodies are independent immutable reads. Bound socket/memory pressure while
// avoiding serial round-trip latency on a cold snapshot.
const BODY_READ_CONCURRENCY = 8;

export interface HindsightApplicationLoadInput extends HindsightApplicationScope {
  client: HindsightApplicationClient;
  context: HindsightCallContext;
  /** Recheck the containing operation's deadline, cancellation and Bank lease before every HTTP request. */
  request?: () => HindsightCallContext;
  cachedBody?: (ref: TakiApplicationBodyRef) => HindsightApplicationBody | undefined;
  /** Save only complete verified bytes; this callback must never advance readable state or a checkpoint. */
  cacheBodies?: (bodies: readonly HindsightApplicationBody[]) => void;
}

export async function snapshotHindsightApplication(input: HindsightApplicationLoadInput & { requestId?: string }): Promise<HindsightApplicationBundle> {
  const call = input.request ?? hindsightApplicationDeadline(input.context);
  const manifest = await input.client.createApplicationSnapshot({ bankId: input.bankId, context: call(), request: {
    namespace: input.namespace, request_id: input.requestId ?? randomUUID(), ttl_seconds: HINDSIGHT_APPLICATION_DEFAULT_TTL_SECONDS,
  } });
  return loadHindsightApplicationBundle({ ...input, request: call, context: call(), manifest });
}

export async function hydrateHindsightApplication(input: HindsightApplicationLoadInput & {
  selectors: TakiApplicationSelector[]; artifactKeys?: TakiApplicationArtifactKey[]; requestId?: string;
}): Promise<HindsightApplicationBundle> {
  const call = input.request ?? hindsightApplicationDeadline(input.context);
  const manifest = await input.client.hydrateApplication({ bankId: input.bankId, context: call(), request: {
    namespace: input.namespace, request_id: input.requestId ?? randomUUID(), ttl_seconds: HINDSIGHT_APPLICATION_DEFAULT_TTL_SECONDS,
    selectors: input.selectors, artifact_keys: input.artifactKeys ?? [],
  } });
  return loadHindsightApplicationBundle({ ...input, request: call, context: call(), manifest });
}

export async function loadHindsightApplicationBundle(input: HindsightApplicationLoadInput & {
  manifest: TakiApplicationReadBundleManifest;
}): Promise<HindsightApplicationBundle> {
  const call = input.request ?? hindsightApplicationDeadline(input.context);
  const pages: TakiApplicationRecordPage[] = [];
  for (let pageNumber = 0; pageNumber < input.manifest.total_pages; pageNumber++) {
    requireSnapshotFresh(input.manifest);
    pages.push(await input.client.applicationSnapshotPage({ ...input, snapshotId: input.manifest.snapshot_id, pageNumber, context: call() }));
  }
  const bundle = { manifest: input.manifest, pages, bodies: await loadBodies({ ...input, request: call, context: call() }, pages) };
  verifyHindsightApplicationBundle(bundle, input);
  requireSnapshotFresh(input.manifest); call();
  return bundle;
}

export async function loadHindsightApplicationEvent(input: HindsightApplicationLoadInput & {
  manifest: TakiApplicationStateChangeManifest;
}): Promise<HindsightApplicationEvent> {
  const call = input.request ?? hindsightApplicationDeadline(input.context);
  const pages: TakiApplicationRecordPage[] = [];
  for (let pageNumber = 0; pageNumber < input.manifest.total_pages; pageNumber++) {
    pages.push(await input.client.applicationChangePage({ ...input, stateCursor: input.manifest.state_cursor,
      eventHash: input.manifest.event_hash, pageNumber, context: call() }));
  }
  const event = { manifest: input.manifest, pages, bodies: await loadBodies({ ...input, request: call, context: call() }, pages) };
  verifyHindsightApplicationEvent(event, input); call(); return event;
}

export async function loadBodies(input: HindsightApplicationLoadInput, pages: TakiApplicationRecordPage[]): Promise<Map<string, HindsightApplicationBody>> {
  const call = input.request ?? hindsightApplicationDeadline(input.context);
  const bodies = new Map<string, HindsightApplicationBody>(); const queue: TakiApplicationBodyRef[] = [];
  const descriptors = new Map<string, TakiApplicationBodyRef>();
  const enqueue = (ref: TakiApplicationBodyRef) => {
    const prior = descriptors.get(ref.body_id);
    if (prior && !sameApplicationValue(prior, ref)) throw new Error("HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR");
    if (!prior) { descriptors.set(ref.body_id, ref); queue.push(ref); }
  };
  for (const page of pages) {
    for (const record of page.records) {
      if (record.kind === "artifact") enqueue(record.artifact.body_ref);
      if (record.kind === "native" && record.head.body_ref) enqueue(record.head.body_ref);
    }
  }
  while (queue.length) {
    const batch = await loadBodyBatch({ ...input, request: call }, queue.splice(-BODY_READ_CONCURRENCY));
    call();
    const downloaded = batch.filter((entry) => entry.downloaded).map((entry) => entry.body);
    if (downloaded.length) input.cacheBodies?.(downloaded);
    for (const { body } of batch) {
      bodies.set(body.ref.body_id, body);
      if (body.content.body_schema === "application-native-record.v1" && body.content.value.source_evidence_ref) {
        enqueue(body.content.value.source_evidence_ref);
      }
      if (body.content.body_schema === "application-source-evidence.v1") enqueue(body.content.value.source_ref);
    }
  }
  call(); return bodies;
}

async function loadBodyBatch(input: HindsightApplicationLoadInput & { request: () => HindsightCallContext }, refs: TakiApplicationBodyRef[]) {
  const stop = new AbortController(); let failed = false; let failure: unknown;
  const request = () => {
    if (failed) throw failure;
    const context = input.request();
    return { ...context, signal: context.signal ? AbortSignal.any([context.signal, stop.signal]) : stop.signal };
  };
  const results = await Promise.allSettled(refs.map(async (ref) => {
    try {
      const context = request();
      const cached = input.cachedBody?.(ref);
      const body = cached ?? await loadHindsightApplicationBody({ ...input, ref, context, request });
      request(); verifyHindsightApplicationBody(body, input);
      if (!sameApplicationValue(body.ref, ref)) throw new Error("HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR");
      return { body, downloaded: cached === undefined };
    } catch (error) {
      // Cancel siblings on the first failure, then drain every launched read.
      // Returning early would let their owner callbacks run after lease release
      // or SQLite shutdown, and a sibling cancellation must not hide the cause.
      if (!failed) { failed = true; failure = error; stop.abort(); }
      throw error;
    }
  }));
  if (failed) throw failure;
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

export async function captureHindsightApplicationBaseline(input: HindsightApplicationLoadInput & {
  nativeClient: Pick<HindsightClient, "createLogicalSnapshot">;
}) {
  const createNative = input.nativeClient.createLogicalSnapshot;
  if (!createNative) throw new Error("HINDSIGHT_EXTENSION_UNSUPPORTED");
  const call = input.request ?? hindsightApplicationDeadline(input.context);
  // Both snapshots are real authenticated producer views. Cursor equality is
  // their linearization witness; racing native writers cause a bounded restart.
  for (let attempt = 0; attempt < 3; attempt++) {
    const bundle = await snapshotHindsightApplication({ ...input, request: call, context: call() });
    const nativeBaseline = await createNative({ bankId: input.bankId, pageSize: 1,
      ttlSeconds: HINDSIGHT_APPLICATION_DEFAULT_TTL_SECONDS, context: call() });
    if (nativeBaseline.manifest.endCursor !== bundle.manifest.checkpoint.native_cursor) continue;
    verifyHindsightApplicationNativeBaseline(bundle, nativeBaseline);
    call(); return { bundle, nativeBaseline };
  }
  throw new Error("HINDSIGHT_APPLICATION_NATIVE_BASELINE_STALE");
}

function requireSnapshotFresh(manifest: TakiApplicationReadBundleManifest): void {
  if (Date.parse(manifest.expires_at) <= Date.now()) throw new Error("HINDSIGHT_SNAPSHOT_EXPIRED");
}
