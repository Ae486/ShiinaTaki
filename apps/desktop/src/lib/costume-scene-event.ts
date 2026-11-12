/**
 * INPUT: Home read demand and the actual Pet scene's nullable attached costume.
 * OUTPUT: correlated scene observations and data-free invalidation on the existing native window event boundary.
 * POS: ui/lib — presentation reads only; no persisted selection, Core state or filesystem authority.
 */
import { emitTo } from "@tauri-apps/api/event";

export const COSTUME_SCENE_REQUEST = "pet:costume-scene-request";
export const COSTUME_SCENE_SNAPSHOT = "pet:costume-scene-snapshot";
export const COSTUME_SCENE_CHANGED = "pet:costume-scene-changed";

export interface CostumeSceneSnapshot {
  requestId: string;
  costumeId: string | null;
}

export function sceneRequestId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("requestId" in payload)) return null;
  return typeof payload.requestId === "string" && payload.requestId.length > 0 ? payload.requestId : null;
}

export function parseCostumeSceneSnapshot(payload: unknown): CostumeSceneSnapshot | null {
  const requestId = sceneRequestId(payload);
  if (!requestId || typeof payload !== "object" || payload === null || !("costumeId" in payload)) return null;
  const costumeId = payload.costumeId;
  return costumeId === null || (typeof costumeId === "string" && costumeId.length > 0)
    ? { requestId, costumeId } : null;
}

export function requestCostumeScene(requestId: string): Promise<void> {
  return emitTo("pet", COSTUME_SCENE_REQUEST, { requestId });
}

export function publishCostumeScene(snapshot: CostumeSceneSnapshot): Promise<void> {
  return emitTo("home", COSTUME_SCENE_SNAPSHOT, snapshot);
}

export function notifyCostumeSceneChanged(): void {
  void emitTo("home", COSTUME_SCENE_CHANGED).catch((cause: unknown) =>
    console.warn("[pet] costume scene invalidation undeliverable", cause));
}
