/**
 * INPUT:  a foreground sample's process name (the Shell reports the exe FileDescription first, the exe name as
 *         fallback) + an optional operator-supplied extra list (#26 makes it user-editable)
 * OUTPUT: BUILTIN_SENSITIVE_PROCESSES, normalizeProcessName(raw), createSensitiveProcessCheck(opts) -> (name) => boolean
 * POS:    core/perception — the pre-observation skip every ambient sampler consults; a hit drops BOTH the ambient
 *         capture and the T3a window-title sample (a title like "Payroll - MyBank" leaks by itself). Pure + OS-neutral:
 *         it reads the name the sampler already holds, never the OS.
 *         KNOWN COVERAGE GAP (documented, not solved): exe/app-name matching cannot see INSIDE a browser — a banking
 *         page or an incognito window is still chrome.exe. Recall only closes this via browser-OS integration we
 *         cannot replicate; our real backstops stay default-OFF ambient capture + Privacy Pause + the PII scrub.
 */

// Conservative built-ins: ONLY entries a surveyed comparable names explicitly (research ra §2; its §OMITTED flags the
// exact list MEMBERSHIP as unsourced curation, so nothing is invented here). screenpipe excludes "1Password, banking"
// by name [SP-ARCH]; Recall filters remote-desktop clients by default [MS-MANAGE]. "banking" names no executable, so
// no banking entry is baked in — the user-editable list (#26) carries the rest.
// Both match forms per entry, because the Shell reports the exe's FileDescription first ("Remote Desktop Connection")
// and the raw exe name only when OpenProcess is denied ("mstsc.exe").
export const BUILTIN_SENSITIVE_PROCESSES: readonly string[] = ["1password", "mstsc", "remote desktop connection"];

/**
 * Canonical match key: case-folded, whitespace-collapsed, with a trailing `.exe` dropped so the FileDescription form
 * and the exe form of the SAME app collapse onto one token ("1Password" / "1password.exe" -> "1password").
 */
export function normalizeProcessName(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const folded = raw.trim().toLowerCase().replaceAll(/\s+/g, " ");
  return folded.endsWith(".exe") ? folded.slice(0, -4) : folded;
}

/**
 * Build the skip predicate once (built-ins + operator extras). Matching is EXACT on the normalized name, never a
 * substring: a substring rule on short tokens would silently blind the sampler to unrelated apps.
 */
export function createSensitiveProcessCheck(
  opts: { extra?: readonly string[] } = {},
): (processName: string | null | undefined) => boolean {
  const list = new Set(
    [...BUILTIN_SENSITIVE_PROCESSES, ...(opts.extra ?? [])].map(normalizeProcessName).filter((name) => name.length > 0),
  );
  return (processName) => {
    const key = normalizeProcessName(processName);
    return key.length > 0 && list.has(key);
  };
}
