/**
 * INPUT:  a raw archive member / resource name (from a tar or zip entry, or a manifest resource ref)
 * OUTPUT: safeMemberPath(raw) -> a normalized POSIX-relative path, or null when the name is unsafe
 * POS:    core/characters — THE single-sourced traversal guard for every archive write (#18); both archive readers and
 *         the manifest resolver pass names through here BEFORE any fs path is derived. Reject-on-unsafe is fail-closed.
 */
import { safePackagePath } from "../archive/member-path.ts";

/**
 * Normalize + confine an archive member name. Returns the clean POSIX-relative path, or null when the name is
 * unsafe (empty, absolute, drive-lettered, NUL-bearing, escapes its root via `..`, or names a reserved device).
 * A null result is the caller's signal to reject the whole archive with `unsafe_resource_path`.
 */
export function safeMemberPath(raw: string): string | null {
  return safePackagePath(raw);
}
