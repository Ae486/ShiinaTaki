/**
 * INPUT: trusted capture producer results and their retained attachment references
 * OUTPUT: non-serialized native image evidence bound to the exact completed tool result
 * POS: core/agents — process-local screenshot carrier; arbitrary tool JSON never creates image evidence
 */
import type { UserImageInput } from "./turn-mapping.ts";
import type { NativeImageData } from "./native-image-projection.ts";

export interface NativeToolImages {
  readonly images: readonly NativeImageData[];
  readonly refs: readonly UserImageInput[];
  /** Mixed explicitly declared MCP formats may contain transient images outside the existing store namespace. */
  readonly refsByImageIndex?: readonly (UserImageInput | undefined)[];
  readonly context: string;
  /** Bound once by the actual completed SDK step, after model-output conversion has retained this object. */
  originModelEffectId?: string;
  stepNumber?: number;
  isCurrent?(): boolean;
  release?(): void;
}

const evidence = new WeakMap<object, NativeToolImages>();

export function withNativeToolImages<T extends object>(output: T, images: NativeToolImages): T {
  evidence.set(output, images);
  return output;
}

export function nativeToolImages(output: unknown): NativeToolImages | undefined {
  return typeof output === "object" && output !== null ? evidence.get(output) : undefined;
}

export function copyNativeToolImages<T extends object>(output: unknown, target: T): T {
  const value = nativeToolImages(output);
  return value ? withNativeToolImages(target, value) : target;
}
