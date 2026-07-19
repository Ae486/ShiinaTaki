/**
 * INPUT:  (none — a static model-facing constant)
 * OUTPUT: COSTUME_CHANGE_NOTICE — the one-shot system note prefixed onto a turn's user message after a costume swap
 * POS:    core/avatar — the text half of the 1f costume-change reminder; chat-agent prefixes it when the vocabulary's consumeCostumeChanged fires
 */

// Prefixed (once) onto the model-facing user message the turn AFTER the worn costume changed, so the model switches to
// the freshly-reported avatar vocabulary instead of reusing stale tag names a prior costume's successful tool calls
// anchored on (1f, the reliability backstop for enum 1e). "no reply needed" keeps it from derailing the reply; the
// persisted history never carries it (one-shot, in-flight only — like the image FilePart tail).
export const COSTUME_CHANGE_NOTICE =
  "[System · no reply needed] Costume changed; your available avatar tags were updated to your current vocabulary. Ignore tag names from earlier turns.";
