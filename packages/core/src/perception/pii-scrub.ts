/**
 * INPUT:  one sensed string (a window title today, a VLM screen description next) — untrusted, possibly credential-bearing
 * OUTPUT: scrubPii(text) -> the same text with every deterministic PII/credential class masked
 * POS:    core/perception — the NON-BYPASSABLE content-minimization step at the sense seam: it runs BEFORE the A1 fence
 *         and before anything is stored (scrub-then-fence), so the prompt path and any future store inherit the SAME
 *         scrubbed string. Pure + deterministic: regex only, no model, no I/O, and deliberately NO opt-out flag
 *         (stricter than the cited hermes secure-by-default snapshot — there is nothing to disable).
 */

// Class set + masking follow research ra §3/R5: the in-tree MIT hermes redactor (vendor-prefixed secrets, JWT, private
// keys, URL/DB credentials, E.164 phone, head/tail mask) plus email / Luhn-checked card / IBAN from Presidio's
// deterministic set. Model-based (NER) detection is explicitly out of v1.
//
// BACKTRACKING SAFETY — Presidio guards each pattern with a REGEX_TIMEOUT; JS has no equivalent (no way to abort a
// match mid-run), so safety here is by CONSTRUCTION instead: every pattern uses disjoint character classes with
// BOUNDED repetition ({n,m}, never a bare + or *) and no nested quantifiers, which keeps worst-case work linear in the
// input and bounded per start position. A bound we can prove beats a watchdog we cannot enforce.

const MASK = "***";

/** hermes mask_secret: keep head 4 / tail 4 so the text stays coherent; anything under the 12-char floor is fully masked. */
function maskSecret(value: string): string {
  return value.length < 12 ? MASK : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/** Classes where ANY surviving fragment is itself the identifier (email/card/IBAN/key) get a labeled placeholder. */
function placeholder(kind: string): string {
  return `[redacted:${kind}]`;
}

function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** ISO 13616 mod-97: move the first 4 chars to the end, letters -> 2 digits (A=10), remainder must be 1. */
function isIbanValid(compact: string): boolean {
  if (compact.length < 15 || compact.length > 34) return false;
  let remainder = 0;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    const value = code >= 65 ? code - 55 : code - 48;
    remainder = (remainder * (value > 9 ? 100 : 10) + value) % 97;
  }
  return remainder === 1;
}

/** hermes phone mask: keep the country code and the last 4 so the text still reads as a phone number. */
function maskPhone(phone: string): string {
  return phone.length <= 8
    ? `${phone.slice(0, 2)}****${phone.slice(-2)}`
    : `${phone.slice(0, 4)}****${phone.slice(-4)}`;
}

/** A candidate that fails Luhn is left VERBATIM: order numbers, ids and timestamps must survive the scrub. */
function maskCard(candidate: string): string {
  const digits = candidate.replaceAll(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || !isLuhnValid(digits)) return candidate;
  return placeholder("card");
}

/** Same contract as maskCard: no mod-97, no mask — a licence key shaped like an IBAN stays readable. */
function maskIban(candidate: string): string {
  return isIbanValid(candidate.replaceAll(" ", "")) ? placeholder("iban") : candidate;
}

// Known vendor prefixes: each alternative is a literal discriminator + a bounded token class, so the alternation costs
// one literal check per start position. Broadest patterns last (sk_ would otherwise swallow sk_live_).
const VENDOR_SECRET_PATTERNS = [
  String.raw`sk-[A-Za-z0-9_-]{10,512}`, // OpenAI / Anthropic / OpenRouter
  String.raw`sk_(?:live|test)_[A-Za-z0-9]{10,512}`, // Stripe secret
  String.raw`rk_live_[A-Za-z0-9]{10,512}`, // Stripe restricted
  String.raw`gh[pousr]_[A-Za-z0-9]{10,512}`, // GitHub PAT / OAuth / user / server / refresh
  String.raw`github_pat_[A-Za-z0-9_]{10,512}`,
  String.raw`xox[baprs]-[A-Za-z0-9-]{10,512}`, // Slack bot/app/user
  String.raw`xapp-[0-9]{1,3}-[A-Za-z0-9-]{10,512}`, // Slack app-level
  String.raw`AIza[A-Za-z0-9_-]{30,100}`, // Google
  String.raw`AKIA[A-Z0-9]{16}`, // AWS access key id
  String.raw`SG\.[A-Za-z0-9_-]{10,512}`, // SendGrid
  String.raw`hf_[A-Za-z0-9]{10,512}`, // HuggingFace
  String.raw`r8_[A-Za-z0-9]{10,512}`, // Replicate
  String.raw`npm_[A-Za-z0-9]{10,512}`, // npm
  String.raw`pypi-[A-Za-z0-9_-]{10,512}`, // PyPI
  String.raw`dop_v1_[A-Za-z0-9]{10,512}`, // DigitalOcean
  String.raw`xai-[A-Za-z0-9]{20,512}`, // xAI
  String.raw`gsk_[A-Za-z0-9]{10,512}`, // Groq
  String.raw`ntn_[A-Za-z0-9]{10,512}`, // Notion
  String.raw`tvly-[A-Za-z0-9]{10,512}`, // Tavily
  String.raw`sk_[A-Za-z0-9_]{10,512}`, // ElevenLabs (underscore form)
];

const VENDOR_SECRET_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_-])(?:${VENDOR_SECRET_PATTERNS.join("|")})(?![A-Za-z0-9_-])`,
  "g",
);

// The PEM body is bounded (an RSA-8192 block is ~6 kB) so an unterminated BEGIN marker cannot make the lazy scan walk
// the whole input at every occurrence.
const PRIVATE_KEY_RE = /-----BEGIN[A-Z ]{0,20}PRIVATE KEY-----[\S\s]{0,8000}?-----END[A-Z ]{0,20}PRIVATE KEY-----/g;

// scheme://user:PASSWORD@host — any scheme, not just DB protocols. hermes passes WEB urls through (an agent may need to
// follow an OAuth callback); sensed screen text is an OBSERVATION, never a link we act on, so minimization wins here.
const URL_CREDENTIAL_RE = /([a-z][\w+.-]{1,15}:\/\/[^\s:@/]{1,64}:)[^\s@/]{1,256}@/gi;
// scheme://TOKEN@host — a colon-less credential in userinfo (the embedded-PAT git-remote shape); 8+ chars skips
// ordinary usernames (git, admin, root, ubuntu).
const URL_BARE_TOKEN_RE = /([a-z][\w+.-]{1,15}:\/\/)([^\s:@/]{8,256})@/gi;

const JWT_RE = /eyJ[\w-]{10,4000}(?:\.[\w=-]{4,4000}){0,2}/g;

// The lookbehind is a left boundary: without it a failed leftmost attempt would restart mid-token and mask a partial
// address (or a masked fragment) as if it were a whole one. The alphabetic TLD keeps `user@10.0.0.5` (an ssh target,
// not an address) out of the class.
const EMAIL_RE = /(?<![\w.%+\-@])[\w.%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}/g;

// E.164: +<country><7-15 digits>. The lookarounds keep it out of hex blobs and identifiers.
const PHONE_RE = /(?<![\w+])\+[1-9]\d{6,14}(?![\w])/g;

// Either the printed 4-4-4-N grouping or a contiguous 13-19 digit run; Luhn decides whether it is really a PAN. The
// two shapes are spelled out rather than "digit + optional separator" so an adjacent number (a year, an order id)
// cannot be pulled into the candidate — that would fail Luhn and silently leave the real card unmasked.
const CARD_RE = /(?<![\d-])(?:(?:\d{4}[ -]){3}\d{1,7}|\d{13,19})(?![\d-])/g;

// ISO 13616 shape (2 letters + 2 check digits + up to 30 alnum), contiguous or in the printed 4-char groups; mod-97
// decides. Same anti-over-capture reasoning as CARD_RE: a trailing word must not join the candidate.
const IBAN_RE = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?:[A-Z0-9]{11,30}|(?:[ ][A-Z0-9]{4}){2,7}(?:[ ][A-Z0-9]{1,3})?)(?![A-Za-z0-9])/g;

interface ScrubRule {
  pattern: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}

// ORDER IS LOAD-BEARING: the private-key block first so nothing rewrites its body; URL credentials before email (else
// `pass@host` reads as an address); email before phone (else a `+`-tagged local part reads as an E.164 number); IBAN
// before card (an IBAN embeds a long digit run that could otherwise be eaten as a PAN candidate).
const RULES: readonly ScrubRule[] = [
  { pattern: PRIVATE_KEY_RE, replace: () => placeholder("private-key") },
  { pattern: URL_CREDENTIAL_RE, replace: (_match, prefix) => `${prefix}${MASK}@` },
  // Userinfo credentials drop to a bare MASK (no head/tail): a partially-masked token followed by "@host.tld" reads as
  // an email address to the very next rule, and to a human.
  { pattern: URL_BARE_TOKEN_RE, replace: (_match, scheme) => `${scheme}${MASK}@` },
  { pattern: VENDOR_SECRET_RE, replace: (match) => maskSecret(match) },
  { pattern: JWT_RE, replace: (match) => maskSecret(match) },
  { pattern: EMAIL_RE, replace: () => placeholder("email") },
  { pattern: PHONE_RE, replace: (match) => maskPhone(match) },
  { pattern: IBAN_RE, replace: (match) => maskIban(match) },
  { pattern: CARD_RE, replace: (match) => maskCard(match) },
];

/** Mask every deterministic PII/credential class. Non-matching text passes through byte-identical. */
export function scrubPii(text: string): string {
  if (text.length === 0) return text;
  let scrubbed = text;
  for (const rule of RULES) scrubbed = scrubbed.replaceAll(rule.pattern, rule.replace);
  return scrubbed;
}
