/**
 * INPUT:  a view choice, the Pixi screen size and a loaded model's unscaled height.
 * OUTPUT: full-body placement identical to the production loader, or a magnified face framing for pose observation.
 * POS:    experimental / lab - not in production path; pure transform plus a structural applier, no engine imports.
 */

export type ModelView = "full" | "face";

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

export interface ModelViewTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

interface ViewableModel {
  height: number;
  scale: { x: number; y: number; set(value: number): void };
  position: { set(x: number, y: number): void };
  anchor: { set(value: number): void };
}

export const MODEL_VIEWS: readonly ModelView[] = ["full", "face"];
const FACE_ZOOM = 2.4;
/** Fraction of the model's height, from the top, that lands at screen centre in the face view (measured on Taki rigs). */
const FACE_CENTRE = 0.22;

export function modelViewTransform(view: ModelView, screen: ScreenSize, unscaledHeight: number): ModelViewTransform {
  // Same fit as the production loader's placeCentered: 90 % of the screen height, anchored at the model centre.
  const fit = (screen.height * 0.9) / unscaledHeight;
  if (view === "full") return { scale: fit, x: screen.width / 2, y: screen.height / 2 };
  const scale = fit * FACE_ZOOM;
  return { scale, x: screen.width / 2, y: screen.height / 2 + (0.5 - FACE_CENTRE) * unscaledHeight * scale };
}

export function applyModelView(model: ViewableModel, view: ModelView, screen: ScreenSize): ModelViewTransform | null {
  const unscaledHeight = model.height / model.scale.y;
  if (!Number.isFinite(unscaledHeight) || unscaledHeight <= 0) return null;
  const transform = modelViewTransform(view, screen, unscaledHeight);
  model.anchor.set(0.5);
  model.position.set(transform.x, transform.y);
  model.scale.set(transform.scale);
  return transform;
}
