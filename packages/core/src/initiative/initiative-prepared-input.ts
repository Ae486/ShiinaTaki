/**
 * INPUT: deterministic preparation of an already admitted initiative opportunity
 * OUTPUT: ephemeral source text and optional native image context for the same Attempt
 * POS: core/initiative — preparation port only; never persisted into the selected context or Timeline
 */
import type { NativeImageContext } from "../agents/native-image-context.ts";

export interface InitiativePreparedInput {
  text: string;
  nativeImageContext?: NativeImageContext;
}
