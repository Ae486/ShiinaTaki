/**
 * INPUT:  an initialized PixiJS Application (spike createStage) + CatalogEntry picks from the panels.
 * OUTPUT: createLabScene(app) -> LabScene { current, load(entry), onModel, onBeforeDispose, dispose }. load() tears the
 *         current model down (listeners -> hooks -> stage -> destroy), loads the costume through the production loader,
 *         fetches its expression files (face params), then builds the per-model ModelContext (params, facts, hooks,
 *         sampler, pruned-ref count) and notifies.
 * POS:    experimental / lab — not in production path; the ONLY lab module that owns engine objects. Teardown order
 *         per spec live2d-renderer.md; a loadSeq ticket discards superseded loads (costume-switch.ts's isStale idea).
 */

import type { Application } from "pixi.js";
import type { InternalModel, Live2DModel } from "untitled-pixi-live2d-engine";

import { loadCharacterModel, type CostumeSource } from "@/renderer/live2d/load-character-model.js";
import { type CatalogEntry, countPrunedRefs, toCostumeSource } from "./character-catalog.ts";
import { type CostumeFacts, fetchFaceParams, inspectCostume } from "./costume-inspector.ts";
import type { FaceParam } from "./face-params.ts";
import { createFrameHooks, type FrameHooks } from "./frame-hooks.ts";
import { createParamAccess, type ParamAccess, type ParamAccessTarget } from "./param-access.ts";
import { createParamSampler, type ParamSampler } from "./param-sampler.ts";

export interface ModelContext {
  entry: CatalogEntry;
  model: Live2DModel;
  internal: InternalModel;
  params: ParamAccess;
  hooks: FrameHooks;
  sampler: ParamSampler;
  facts: CostumeFacts;
  /** Motion/expression entries pruneSettings stripped for unresolvable (`..`) refs — the system-B badge. */
  prunedRefs: number;
}

type Listener = (ctx: ModelContext) => void;

export interface LabScene {
  readonly current: ModelContext | null;
  load(entry: CatalogEntry): Promise<ModelContext>;
  onModel(fn: Listener): () => void;
  onBeforeDispose(fn: Listener): () => void;
  dispose(): void;
}

export function createLabScene(app: Application): LabScene {
  let current: ModelContext | null = null;
  let loadSeq = 0;
  let disposed = false;
  const modelListeners = new Set<Listener>();
  const disposeListeners = new Set<Listener>();

  const teardownCurrent = (): void => {
    if (current === null) return;
    const ctx = current;
    current = null;
    for (const fn of disposeListeners) fn(ctx);
    ctx.sampler.dispose();
    ctx.hooks.dispose();
    destroyModel(app, ctx.model);
  };

  return {
    get current() {
      return current;
    },
    async load(entry) {
      if (disposed) throw new Error("lab scene: load() after dispose()");
      const seq = ++loadSeq;
      const superseded = (): boolean => seq !== loadSeq || disposed;
      teardownCurrent();
      const source = toCostumeSource(entry, location.origin);
      const prunedRefs = await fetchPrunedCount(source);
      // Cheap exit before the expensive model load when a newer load (or dispose) won during the settings fetch.
      if (superseded()) throw new Error(`lab scene: load of ${entry.characterId}/${entry.costume} superseded`);
      const model = await loadCharacterModel(app, source);
      // Expression files are fetched after the model so the loader's replaceFiles has already made their URLs absolute.
      const faceParams = superseded() ? {} : await fetchFaceParams(model.internalModel);
      if (superseded()) {
        // The late model must never stay attached: the loader added it to the stage, so remove and destroy it here.
        destroyModel(app, model);
        throw new Error(`lab scene: load of ${entry.characterId}/${entry.costume} superseded`);
      }
      current = buildContext({ entry, model, prunedRefs }, faceParams);
      for (const fn of modelListeners) fn(current);
      return current;
    },
    onModel: (fn) => subscribe(modelListeners, fn),
    onBeforeDispose: (fn) => subscribe(disposeListeners, fn),
    dispose() {
      if (disposed) return;
      disposed = true;
      loadSeq += 1;
      teardownCurrent();
      // Model teardown above ran while the ticker was alive; only now may the application (and its ticker) go.
      app.destroy(true);
    },
  };
}

function subscribe(set: Set<Listener>, fn: Listener): () => void {
  set.add(fn);
  return () => void set.delete(fn);
}

function destroyModel(app: Application, model: Live2DModel): void {
  app.stage.removeChild(model);
  model.destroy({ children: true });
}

// Everything per-model hangs off the loaded model's internalModel; hooks and sampler are bound to it, so they die with it.
function buildContext(loaded: Pick<ModelContext, "entry" | "model" | "prunedRefs">, faceParams: Record<string, FaceParam[]>): ModelContext {
  const internal = loaded.model.internalModel;
  const params = createParamAccess(paramTarget(internal));
  const hooks = createFrameHooks(internal, params);
  const sampler = createParamSampler(hooks, () => !internal.motionManager.isFinished());
  return { ...loaded, internal, params, hooks, sampler, facts: inspectCostume(internal, params, faceParams) };
}

// The loader logs the pruned count but does not return it; one extra fetch of the (small, cached) settings JSON
// keeps the production loader unmodified.
async function fetchPrunedCount(source: CostumeSource): Promise<number> {
  const response = await fetch(source.settingsUrl);
  if (!response.ok) throw new Error(`costume settings not reachable: ${response.status} ${source.settingsUrl}`);
  return countPrunedRefs((await response.json()) as Record<string, unknown>, source.resolve);
}

// CubismInternalModel declares idManager private; it is the only route to C3 id handles, so read it structurally.
function paramTarget(internal: InternalModel): ParamAccessTarget {
  const idManager: unknown = "idManager" in internal ? internal.idManager : undefined;
  return { coreModel: internal.coreModel, idManager: isIdManager(idManager) ? idManager : undefined };
}

function isIdManager(value: unknown): value is NonNullable<ParamAccessTarget["idManager"]> {
  return typeof value === "object" && value !== null && "getId" in value && typeof value.getId === "function";
}
