/**
 * INPUT: trusted captured image evidence with producer-owned freshness and lifetime checks
 * OUTPUT: one transient native image lease for a normal primary model Attempt
 * POS: core/agents — internal perception/initiative carrier; never persisted or accepted from public input
 */
import type { ImageAttachment, SourceContext } from "@taki/shared";

export interface NativeImageContext {
  readonly images: readonly ImageAttachment[];
  readonly context: string;
  readonly sourceContext?: SourceContext;
  isCurrent(): boolean;
  release(): void;
}
