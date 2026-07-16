/**
 * INPUT:  an initialized PixiJS Application + a costume source: either the dev settings URL (DEV_MODEL_SOURCE) or a
 *         CostumeSource {settingsUrl, file} for an imported costume; the vendored Cubism runtimes (globals from pet.html).
 * OUTPUT: loadCharacterModel(app, source) -> a loaded, centered Live2DModel on the governed ticker (eye-blink+breath).
 * POS:    ui/renderer/live2d — framework-free (ZERO React/Tauri imports). For an imported costume the caller passes a
 *         `file` resolver (built in lib/character-asset-url) so each sub-resource becomes its OWN absolute asset: URL —
 *         the engine's relative resolveURL would otherwise drop the prefix (research/rc-asset-suburl-defect.md). C2/C3
 *         is auto-detected via the engine's own isValidJSON. Cubism runtimes load as pet.html <script> globals (#18).
 */

import type { Application } from "pixi.js";
import { CubismLegacyModelSettings, CubismModelSettings, Live2DModel, ModelSettings } from "untitled-pixi-live2d-engine";

// Dev fallback: the git-ignored self-contained Cubism 2 costume served by the vite middleware (apply:"serve"). Used
// when no character is imported so `pnpm tauri dev` still renders; absent from a packaged build (an imported model
// replaces it live via the costume-switch path). An imported costume passes a CostumeSource instead of this string.
export const DEV_MODEL_SOURCE = "/spike-assets/arbeit/model.json";

/** An imported costume's load inputs: the settings-file asset URL + a per-sub-resource absolute-asset-URL resolver. */
export interface CostumeSource {
  settingsUrl: string;
  file: (relPath: string) => string;
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

  placeCentered(app, model);
  app.stage.addChild(model);
  return model;
}

// Fetch the costume settings JSON and rewrite every sub-resource ref to its own absolute asset: URL via replaceFiles,
// then hand the engine a fully-resolved ModelSettings. This bypasses the engine's relative resolveURL (which drops the
// convertFileSrc-encoded prefix — see the module header + research/rc-asset-suburl-defect.md). Generation is detected
// by the engine's own isValidJSON so a C2 costume and a C3 costume take the same path with no manual branch.
async function toAbsoluteSettings(source: CostumeSource): Promise<ModelSettings> {
  const response = await fetch(source.settingsUrl);
  if (!response.ok) throw new Error(`costume settings not reachable: ${response.status} ${source.settingsUrl}`);
  const json = (await response.json()) as Record<string, unknown>;
  const settings = createSettings({ ...json, url: source.settingsUrl });
  settings.replaceFiles((file) => source.file(file));
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
