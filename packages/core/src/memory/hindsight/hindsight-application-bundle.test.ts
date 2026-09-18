import { describe, expect, it, vi } from "vitest";
import { type TakiApplicationArtifact, type TakiApplicationRecordPage } from "@taki/shared";
import {
  APPLICATION_TEST_SCOPE as scope, applicationTestBody, applicationTestArtifact, applicationTestNative,
  applicationTestBankPayload, applicationTestMemoryPayload, applicationTestMemoryBody, applicationTestSnapshot,
  applicationTestEvent, applicationTestNativeBaseline, type ApplicationNativeFixture,
} from "../../testing/hindsight-application-fixtures.ts";
import { verifyHindsightApplicationBundle, verifyHindsightApplicationEvent, verifyHindsightApplicationNativeBaseline } from "./hindsight-application-bundle.ts";
import { hindsightApplicationHash, withoutApplicationHash } from "./hindsight-application-integrity.ts";
import { loadHindsightApplicationBundle, captureHindsightApplicationBaseline } from "./hindsight-application-bundle-loader.ts";
import type { HindsightApplicationClient } from "./hindsight-application-client.ts";

function fixture() {
  const bank = applicationTestNative({ kind: "bank", payload: applicationTestBankPayload() });
  const owner = applicationTestArtifact({ key: { artifact_kind: "bank", artifact_id: "scope" },
    binding: { kind: "exact_native", native: bank.head.version! }, body: applicationTestBody("application-bank.v1", {
      scope: { kind: "global", characterId: null }, original_bank: null, original_provider_lineage: null, original_authority_epoch_id: null,
    }) });
  bind(bank, owner.artifact);
  const memory = applicationTestNative({ kind: "memory_unit", payload: applicationTestMemoryPayload() });
  const policy = applicationTestArtifact({ key: { artifact_kind: "memory", artifact_id: "memory-a" },
    binding: { kind: "exact_native", native: memory.head.version! },
    body: applicationTestBody("application-memory.v1", applicationTestMemoryBody(memory.head.version!)) });
  bind(memory, policy.artifact);
  const bundle = applicationTestSnapshot({ native: [bank, memory], artifacts: [owner, policy], pageSize: 1 });
  return { bank, memory, owner, policy, bundle };
}
function bind(node: ApplicationNativeFixture, artifact: TakiApplicationArtifact) {
  node.head = { ...node.head, binding_state: "bound", bound_artifact: {
    key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash }, cause: "application_commit" };
}
function rehashPage(page: TakiApplicationRecordPage) {
  page.page_hash = hindsightApplicationHash({ ...scope, domain: "page", value: withoutApplicationHash(page, "page_hash") });
}

describe("D77 complete bundle proof", () => {
  it("verifies complete native/body/policy state and keeps its native baseline identity separate", () => {
    const { bundle } = fixture();
    expect(() => verifyHindsightApplicationBundle(bundle, scope)).not.toThrow();
    const native = applicationTestNativeBaseline(bundle);
    expect(native.snapshotId).not.toBe(bundle.manifest.snapshot_id);
    expect(native.manifest.manifestDigest).not.toBe(bundle.manifest.manifest_hash);
    expect(() => verifyHindsightApplicationNativeBaseline(bundle, native)).not.toThrow();
  });

  it.each(["missing-page", "page-order", "page-hash", "manifest-hash", "count", "body-missing", "body-content", "wrong-namespace"])(
    "rejects %s before publication", (fault) => {
      const { bundle, memory } = fixture();
      if (fault === "missing-page") bundle.pages.pop();
      if (fault === "page-order") bundle.pages.reverse();
      if (fault === "page-hash") bundle.pages[0]!.page_hash = "0".repeat(64);
      if (fault === "manifest-hash") bundle.manifest.manifest_hash = "0".repeat(64);
      if (fault === "count") bundle.manifest.total_records++;
      if (fault === "body-missing") bundle.bodies.delete(memory.body.ref.body_id);
      if (fault === "body-content") memory.body.bytes[0] = 0;
      if (fault === "wrong-namespace") bundle.manifest.namespace = { ...scope.namespace,
        bank_generation: "33333333-3333-4333-8333-333333333333" };
      expect(() => verifyHindsightApplicationBundle(bundle, scope)).toThrow();
    });

  it("rejects a changed descriptor even when an attacker recomputes only its page hash", () => {
    const { bundle } = fixture(); const page = bundle.pages[0]!;
    const record = page.records[0]!;
    if (record.kind !== "native") throw new Error("fixture");
    record.head.object_id = "other-bank"; rehashPage(page);
    expect(() => verifyHindsightApplicationBundle(bundle, scope)).toThrow();
  });

  it("rejects a correctly rehashed head pointing at another native body/version", () => {
    const { bank, memory, owner, policy } = fixture();
    memory.head = { ...memory.head, body_ref: bank.body.ref };
    const malformed = applicationTestSnapshot({ native: [bank, memory], artifacts: [owner, policy] });
    expect(() => verifyHindsightApplicationBundle(malformed, scope)).toThrow();
  });

  it("requires historical artifact bodies in full snapshots but allows an event to refer to a verified predecessor", () => {
    const { bank, memory, owner, policy } = fixture();
    const body = applicationTestMemoryBody(memory.head.version!);
    const replacement = applicationTestArtifact({ key: policy.artifact.key, revision: 2,
      binding: policy.artifact.binding, body: applicationTestBody("application-memory.v1", {
        ...body, policy: { ...body.policy, visibility: "hidden", policyVersion: 2 },
      }) });
    bind(memory, replacement.artifact);
    const snapshot = applicationTestSnapshot({ native: [bank, memory], artifacts: [owner, replacement] });
    expect(() => verifyHindsightApplicationBundle(snapshot, scope)).toThrow();
    const complete = applicationTestSnapshot({ native: [bank, memory], artifacts: [owner, policy, replacement] });
    expect(() => verifyHindsightApplicationBundle(complete, scope)).not.toThrow();
    const event = applicationTestEvent({ native: [memory], artifacts: [replacement], from: { native_cursor: 0, state_cursor: 0 } });
    expect(event.manifest.to_checkpoint.native_cursor).toBe(0);
    expect(() => verifyHindsightApplicationEvent(event, scope)).not.toThrow();
  });

  it.each(["cursor", "generation", "hash", "counts"])("refuses a nonmatching native V1 baseline %s", (fault) => {
    const { bundle } = fixture(); const native = applicationTestNativeBaseline(bundle);
    if (fault === "cursor") native.manifest.endCursor++;
    if (fault === "generation") native.manifest.bankGeneration = "33333333-3333-4333-8333-333333333333";
    if (fault === "hash") native.manifest.manifestDigest = "0".repeat(64);
    if (fault === "counts") native.manifest.counts.memoryUnit.valid++;
    expect(() => verifyHindsightApplicationNativeBaseline(bundle, native)).toThrow();
  });

  it("rejects noncontiguous native events even when the header is self-consistently hashed", () => {
    const { memory } = fixture();
    const event = applicationTestEvent({ native: [memory], from: { native_cursor: 0, state_cursor: 4 },
      to: { native_cursor: 2, state_cursor: 5 } });
    event.manifest.native_batches[0]!.first_cursor = 2;
    event.manifest.event_hash = hindsightApplicationHash({ ...scope, domain: "event", value: withoutApplicationHash(event.manifest, "event_hash") });
    expect(() => verifyHindsightApplicationEvent(event, scope)).toThrow();
  });

  it("downloads every immutable page and uses only exact validated cached body refs", async () => {
    const { bundle } = fixture();
    const page = vi.fn(async ({ pageNumber }: { pageNumber: number }) => bundle.pages[pageNumber]!);
    const client = { applicationSnapshotPage: page } as unknown as HindsightApplicationClient;
    const loaded = await loadHindsightApplicationBundle({ ...scope, client, manifest: bundle.manifest,
      context: { timeoutMs: 1000 }, cachedBody: (ref) => bundle.bodies.get(ref.body_id) });
    expect(loaded.pages).toHaveLength(bundle.pages.length);
    expect(page).toHaveBeenCalledTimes(bundle.pages.length);
    expect(loaded.bodies.size).toBe(bundle.bodies.size);
  });

  it("restarts a raced joint/native capture within the same deadline", async () => {
    const first = fixture().bundle; const second = fixture().bundle;
    second.manifest.checkpoint.native_cursor = 2;
    second.manifest.manifest_hash = hindsightApplicationHash({ ...scope, domain: "snapshot", value: withoutApplicationHash(second.manifest, "manifest_hash") });
    const native = applicationTestNativeBaseline(second);
    let current = first;
    const create = vi.fn(async () => { current = create.mock.calls.length === 1 ? first : second; return current.manifest; });
    const client = { createApplicationSnapshot: create,
      applicationSnapshotPage: async ({ pageNumber }: { pageNumber: number }) => current.pages[pageNumber]!,
    } as unknown as HindsightApplicationClient;
    const result = await captureHindsightApplicationBaseline({ ...scope, client,
      nativeClient: { createLogicalSnapshot: async () => native }, context: { timeoutMs: 1000 },
      cachedBody: (ref) => current.bodies.get(ref.body_id) });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.nativeBaseline.snapshotId).toBe(native.snapshotId);
    expect(result.bundle.manifest.snapshot_id).toBe(second.manifest.snapshot_id);
  });
});
