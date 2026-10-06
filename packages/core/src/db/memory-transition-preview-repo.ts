/**
 * INPUT:  an authenticated capability probe and the current selected source/configuration
 * OUTPUT: immutable Core-issued previews revalidated synchronously during operation admission
 * POS:    core/db — remote probes precede this repository; no network work occurs in SQLite transactions
 */
import { MemoryTransitionPreviewSchema, type MemoryTransitionPreview } from "@taki/shared";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import type { Database } from "./sqlite.ts";

export function saveTransitionPreview(db: Database, preview: MemoryTransitionPreview): void {
  const value = MemoryTransitionPreviewSchema.parse(preview);
  if (value.previewHash !== canonicalPayloadHash(["taki-transition-preview.v1", value.kind, value.expected])) invalid();
  db.prepare("INSERT INTO memory_transition_previews VALUES(:id,:json)").run({ id: value.previewId, json: JSON.stringify(value) });
}
export function readTransitionPreview(db: Database, previewId: string): MemoryTransitionPreview {
  const row = db.prepare("SELECT body_json FROM memory_transition_previews WHERE id=:id").get({ id: previewId });
  if (!row) throw new Error("MEMORY_TRANSITION_STALE");
  const value = MemoryTransitionPreviewSchema.parse(JSON.parse(String(row.body_json)));
  if (value.previewId !== previewId || value.previewHash !== canonicalPayloadHash(["taki-transition-preview.v1", value.kind, value.expected])) invalid();
  return value;
}
export function assertTransitionPreviewRequest(preview: MemoryTransitionPreview, input: { request: {
  previewHash: string; kind: string; expected: unknown; recovery?: unknown }; now: string; actorId: string }): void {
  if (preview.actorId !== input.actorId || Date.parse(preview.expiresAt) <= Date.parse(input.now)
    || preview.kind !== input.request.kind || preview.previewHash !== input.request.previewHash
    || transitionLocalHash(preview.expected) !== transitionLocalHash(input.request.expected)
    || transitionLocalHash(preview.recovery) !== transitionLocalHash(input.request.recovery ?? null)) throw new Error("MEMORY_TRANSITION_STALE");
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
