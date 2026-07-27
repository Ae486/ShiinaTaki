/**
 * INPUT:  one raw VLM reply to an AMBIENT describe call
 * OUTPUT: AMBIENT_DESCRIBE_FOCUS (the privacy instruction appended to the base describe framing) +
 *         isSensitiveScreenVerdict(reply) -> boolean
 * POS:    core/perception — privacy layer TWO for ambient capture. The deterministic exe-name skip
 *         (sensitive-processes.ts) structurally cannot see INSIDE an app: a banking page or an incognito window is
 *         still chrome.exe. The mandatory ambient VLM pass therefore doubles as a semantic screener; layer one is
 *         never weakened by it. Pure + deterministic: a constant string and a string test, no model, no I/O.
 */

/** The token the ambient describe call asks for INSTEAD of a description when the screen looks private. */
export const SENSITIVE_SCREEN_TOKEN = "SENSITIVE_SCREEN";

// Rides the T2b describePrompt seam (screenshot-describe::composeInstructions appends it after "Focus especially
// on:"), so the base guardrails — objective, only-the-description, 200-word cap — survive unchanged. Only the AMBIENT
// path sends this: an on-demand capture is one the user explicitly asked for and is answered as asked.
export const AMBIENT_DESCRIBE_FOCUS =
  `privacy screening, before anything else. If the screen shows credentials or a password manager, payment or ` +
  `banking details, private messages, or any login / sign-in surface, reply with EXACTLY the single token ` +
  `${SENSITIVE_SCREEN_TOKEN} and nothing else — no description, no explanation, no apology. That overrides the ` +
  `instruction to describe. Otherwise describe the screen as instructed above.`;

// FAIL-CLOSED and deliberately more forgiving than the prompt (the sentinel lesson: models wrap tokens in markdown,
// brackets or a sentence, and swap `_` for a space). Any occurrence anywhere in the reply is a sensitive verdict, so
// a hedged "SENSITIVE_SCREEN (a login form)" still refuses. A false positive costs one skipped observation; a false
// negative leaks the screen we promised not to look at.
const VERDICT_RE = /sensitive[\s_-]*screen/i;

/** True when the VLM's reply signals a private screen — treat the whole observation as discarded. */
export function isSensitiveScreenVerdict(reply: string): boolean {
  return VERDICT_RE.test(reply);
}
