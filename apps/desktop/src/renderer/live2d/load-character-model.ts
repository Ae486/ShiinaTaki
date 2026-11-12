/**
 * INPUT:  an initialized PixiJS Application + a costume source: either the dev settings URL (DEV_MODEL_SOURCE) or a
 *         CostumeSource {settingsUrl, resolve, costumeId?} for an imported costume; vendored Cubism runtimes.
 * OUTPUT: loadCharacterModel(app, source) -> a loaded, centered Live2DModel on the governed ticker (eye-blink+breath),
 *         with isolated Cubism 2 mask caches installed before its first stage render.
 * POS:    ui/renderer/live2d — framework-free (ZERO React/Tauri imports). For an imported costume the caller passes a
 *         `resolve` fn (built in lib/character-asset-url): unresolvable refs are PRUNED from the settings before the
 *         engine sees them (`..` never reaches the asset protocol), every kept sub-resource becomes its OWN absolute
 *         asset: URL (research/rc-asset-suburl-defect.md). C2/C3 auto-detected via the engine's own isValidJSON (#18).
 */

import type { Application } from "pixi.js";
import { CubismLegacyInternalModel, CubismLegacyModelSettings, CubismModelSettings, Live2DModel, ModelSettings } from "untitled-pixi-live2d-engine";
import { pruneSettings } from "./settings-prune.ts";
import { isolateLegacyMaskContext } from "./legacy-mask-context.ts";

// Dev fallback: the git-ignored self-contained Cubism 2 costume served by the vite middleware (apply:"serve"). Used
// when no character is imported so `pnpm tauri dev` still renders; absent from a packaged build (an imported model
// replaces it live via the costume-switch path). An imported costume passes a CostumeSource instead of this string.
export const DEV_MODEL_SOURCE = "/spike-assets/arbeit/model.json";

/** An imported costume's load inputs: the settings asset URL + a per-sub-resource resolver (null = unresolvable ref). */
export interface CostumeSource {
  settingsUrl: string;
  resolve: (relPath: string) => string | null;
  /** Stable identity of this imported costume; absent for the dev fallback or another unlabelled source. */
  costumeId?: string;
}

export async function loadCharacterModel(app: Application, source: string | CostumeSource): Promise<Live2DModel> {
  const from = typeof source === "string" ? source : await toAbsoluteSettings(source);
  const model = await Live2DModel.from(from, {
    // Bind updates to the governed ticker so pausing/throttling the ticker also freezes the model (perf AC).
    ticker: app.ticker,
    // Interaction (tap reactions, focus tracking) is wired by the avatar controller; the loader only needs idle.
    autoHitTest: false,
    autoFocus: false,
    // Built-in idle liveliness — the engine applies these every update once the ticker drives the model.
    eyeBlink: true,
    breathDepth: 1,
  });

  // The first render may be the forced click-through RenderTexture capture in attachModel.
  // Install before addChild so an async StrictMode probe cannot overwrite another context's mask.
  if (model.internalModel instanceof CubismLegacyInternalModel) {
    isolateLegacyMaskContext(model.internalModel);
  }
  placeCentered(app, model);
  app.stage.addChild(model);
  return model;
}

// Fetch the costume settings JSON, PRUNE entries whose refs are unresolvable (external `../_mtn_emp/` pool files no
// imported character supplies — degrade-and-badge, #18), then rewrite every kept ref to its own absolute asset: URL
// via replaceFiles. Pruning first keeps the vocabulary honest (readVocabulary/avatar.report never mention stripped
// motions) and guarantees no `..` ref reaches the asset protocol. Generation is detected by the engine's isValidJSON.
async function toAbsoluteSettings(source: CostumeSource): Promise<ModelSettings> {
  const response = await fetch(source.settingsUrl);
  if (!response.ok) throw new Error(`costume settings not reachable: ${response.status} ${source.settingsUrl}`);
  const raw = (await response.json()) as Record<string, unknown>;
  const { settings: pruned, prunedMotions, prunedExpressions } = pruneSettings(raw, source.resolve);
  if (prunedMotions + prunedExpressions > 0) {
    console.info(`[live2d] pruned ${prunedMotions} motions + ${prunedExpressions} expressions with unresolvable refs`);
  }
  const settings = createSettings({ ...pruned, url: source.settingsUrl });
  // After pruning every remaining ref resolves; `?? file` is unreachable defense (a raw ref would just 404 gracefully).
  settings.replaceFiles((file) => source.resolve(file) ?? file);
  return settings;
}

function createSettings(json: Record<string, unknown> & { url: string }): ModelSettings {
  if (CubismModelSettings.isValidJSON(json)) return new CubismModelSettings(json);
  if (CubismLegacyModelSettings.isValidJSON(json)) return new CubismLegacyModelSettings(json);
  throw new Error("costume settings JSON is neither Cubism 2 nor Cubism 3+ shape");
}

export function placeCentered(app: Application, model: Live2DModel): void {
  model.anchor.set(0.5);
  model.position.set(app.screen.width / 2, app.screen.height / 2);
  const fit = (app.screen.height * 0.9) / model.height;
  model.scale.set(fit);
}
