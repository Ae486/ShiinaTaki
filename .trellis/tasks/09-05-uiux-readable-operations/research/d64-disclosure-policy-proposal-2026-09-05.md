# D64 command disclosure — source constraints and policy choice

Status: policy A adopted by main under the owner's 2026-09-06 execution delegation. The alternatives
below preserve the reviewed tradeoff; there is no remaining owner-choice blocker. Implement only
after the current Host/protocol/consumer adapter contract is reviewed. See
[execution delegation](../../08-22-t4-agent-architecture-observability/research/uiux-execution-delegation-2026-09-06.md).

## Verified constraints

- `ws_challenge.rs:47` currently discloses classification only; no reusable Host command sanitizer is
  wired. The archived Approval lifecycle map section 8 requires secret presence/purpose rather than
  value, but does not specify a general policy for arbitrary command strings.
- `perception/pii-scrub.ts:21` keeps token head/tail fragments and passes unmatched content through.
  It is an observation scrubber, not proof that an arbitrary command is safe to disclose.
- The parser removes quotes and collapses unsupported syntax to `Complex`; it cannot reconstruct a
  faithful command view or prove argument sensitivity. The exec allowlist is an execution rule.
- `approval-schema.ts:32` permits 500 UTF-16 units per field; Rust `host_approval_protocol.rs:317`
  enforces 500 UTF-8 bytes. Both allow 12 fields per section and 8 sections. Segmentation must satisfy
  both limits on valid Unicode boundaries, after masking and visible escaping.
- `canonicalCapabilityChallenge` seals the final presentation together with the original request
  lineage. Resume consumes the original pending input once; display text is never execution input.
- Current `ws_client.rs:286` logs a challenge-build failure without settling the operation. A disclosure
  failure must instead return a bounded sanitized denial and clean up the session promptly.

## Reviewed alternatives (A selected)

| Choice | Operator experience | Explicit tradeoff |
|---|---|---|
| A: full command with deterministic credential masking | Preserve the complete command structure and ordinary paths; fully mask recognized credential/header/URL/assignment/token values. Unrecognized free text remains visible only to the authenticated initiating operator. | Maintains general command approval, but pattern matching cannot promise that every unmarked secret is recognized. This relaxes the previous nondisclosure posture for otherwise unclassified text. |
| B: supported disclosure forms only | Show only command forms/argument purposes supported by an explicit disclosure policy. If sensitive boundaries or the meaningful action cannot be established, refuse that approval. | Stronger disclosure control, but some commands that are currently approvable will be rejected until their form is supported. |

Illustrative inputs below are synthetic, not captured credentials:

- `curl -H "Authorization: Bearer DEMO_SECRET" https://example.test/api` should preserve the command
  and target while replacing the complete credential value with a labeled hidden-value marker.
- `custom-tool --data "unclassified free text"` demonstrates the choice: A displays that text;
  B requires a supported purpose rule or refuses approval. No regex can infer all such values' intent.

The owner subsequently delegated this product choice to main, which selected A for complete,
useful command approval without rejecting arbitrary unmatched free text.
Both choices retain complete permitted command content, ordinary actionable path identity, Chinese
copy, secret values fully hidden once identified, exact authorization binding and no new persistence.

## Shared implementation shape after the decision

1. Generate a deterministic projection from the same sealed raw request; preserve order, quoting and
   allowed path/argument meaning. Make control/Bidi/terminal escape characters visibly unambiguous.
2. Segment the complete projected command into existing bounded sections/fields. Segment boundaries
   are not source newlines. If the entire result cannot fit, settle as a readable bounded refusal;
   never approve a silently truncated action.
3. Render literal selectable, monospaced, whitespace-preserving text with accessible scrolling. Do
   not infer safety from a Chinese section title or alter text after the Host seals it.
4. Preserve exact input/challenge/scope digests, once-only resume, expiry, reconnect invalidation and
   final Host-floor checks. No D63 parser/sandbox change.
5. Preserve the existing restricted raw-command audit on execution/final enforcement; do not add raw
   pending-input logs, denial logs, timeline records, caches or diagnostic payloads. Dropping ordinary
   strings is not a claim of secure memory erasure.
6. Review older Host compatibility explicitly: revision-1 classification-only presentations can be
   structurally valid. A mandatory command-presence rule needs an explicit compatible protocol signal
   or coordinated upgrade policy, not label-text guessing.

Tests must cover Unicode/byte bounds, full tails, secrets crossing segment boundaries, controls/Bidi,
sanitized immediate refusal, tampered display, different raw inputs with identical masked display,
denial without execution, duplicate/late resume, reconnect and existing raw-audit behavior.
