/**
 * INPUT:  an unknown error thrown by a node:fs operation
 * OUTPUT: fsErrorCode(error) -> the errno name (e.g. "ENOENT") or "UNKNOWN"
 * POS:    core/workspace — keeps raw fs messages (which embed ABSOLUTE paths) out of model-facing results (ruling 9)
 */
export function fsErrorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? code : "UNKNOWN";
}
