/**
 * INPUT:  a CharacterImportError code (clean-room vocabulary from @taki/shared) + a human/LLM-readable message
 * OUTPUT: CharacterImportError — a typed throwable the archive/manifest/store layers raise on a hard failure
 * POS:    core/characters — the module's structured-failure carrier; the WS method maps it onto the app-error envelope
 *         (error.data.reason), and the orchestrator catches it to roll back a partial import
 */
import type { CharacterImportError as CharacterImportErrorCode } from "@taki/shared";

export class CharacterImportError extends Error {
  constructor(
    readonly code: CharacterImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CharacterImportError";
  }
}
