/**
 * INPUT:  a click at canvas-local px + the model, its on-screen center, its vocabulary, and the active preset.
 * OUTPUT: reactToClick(input) -> the ClickRegion hit (or null if outside the model), after playing its preset reaction.
 * POS:    ui/renderer/live2d — framework-free (ZERO React imports). UI-LOCAL, no LLM: normalizes the point over the
 *         model bounds, buckets a region, resolves the preset tag against the live vocabulary, and plays it.
 */

import { MotionPriority, type Live2DModel } from "untitled-pixi-live2d-engine";
import { regionForPoint, type ClickRegion } from "./click-regions.ts";
import { resolveByTag } from "./emotion-resolver.ts";
import type { ClickPreset } from "./click-presets.ts";
import type { AvatarVocabulary } from "./model-vocabulary.ts";

export interface ClickReactionInput {
  model: Live2DModel;
  center: { x: number; y: number };
  vocabulary: AvatarVocabulary;
  preset: ClickPreset;
  point: { x: number; y: number };
}

export function reactToClick(input: ClickReactionInput): ClickRegion | null {
  const { model, center, vocabulary, preset, point } = input;
  const width = model.width;
  const height = model.height;
  if (width <= 0 || height <= 0) return null;
  const nx = (point.x - (center.x - width / 2)) / width;
  const ny = (point.y - (center.y - height / 2)) / height;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;

  const region = regionForPoint(nx, ny);
  const tag = preset[region];
  const expression = resolveByTag(tag, vocabulary.expressions);
  if (expression !== null) void model.expression(expression);
  const motion = resolveByTag(tag, vocabulary.motions);
  if (motion !== null) void model.motion(motion, undefined, MotionPriority.NORMAL);
  return region;
}
