/**
 * INPUT:  an unknown error thrown on the provider turn path (APICallError from @ai-sdk/provider via `ai`, or anything)
 * OUTPUT: isContextOverflowError(error) — true ONLY for the recognized context-length-exceeded family;
 *         observedTokensOf(error) — the failing request's own token count parsed from the message/body, else undefined
 * POS:    core/agents — R2's pure classifier (batch 6); fail-open by design: an unrecognized error NEVER classifies
 *         as overflow, so a misclassification can only SKIP the retry — it can never double-send a turn
 */
import { APICallError } from "ai";

// LOCAL phrase list (batch-6 design §3.1 mandates the flag). Sources, each line cited: OpenAI community threads
// quoting the canonical context_length_exceeded 400 bodies verbatim (community.openai.com 45888 / 951948 / 931400);
// DeepSeek gateways reuse the OpenAI wording (zed-industries/zed#45456); vLLM serving_chat 400s (RooCodeInc/Roo-Code
// #4475) + its two engine-path variants and the llama.cpp / LM Studio / Moonshot / MiniMax lines from the shipped
// OVERFLOW_PATTERNS family in librecode/opencode error.ts (commit 84574af); sglang sgl-project/sglang#4048.
// Extend on observed misses — an unmatched phrasing fails open (no retry, today's propagation).
const OVERFLOW_PATTERNS: RegExp[] = [
  /context[_ -]length[_ -]exceeded/i, // OpenAI error CODE — rides the message or the raw JSON body
  /maximum context length is \d+ tokens/i, // OpenAI / DeepSeek / OpenRouter / vLLM message family
  /context length is only \d+ tokens/i, // vLLM (engine path)
  /input length.*exceeds.*context length/i, // vLLM (entrypoint path)
  /exceeds the maximum allowed length/i, // sglang
  /exceeds the available context size/i, // llama.cpp server
  /greater than the context length/i, // LM Studio
  /exceeded model token limit/i, // Moonshot / Kimi
  /context window exceeds limit/i, // MiniMax
  /reduce the length of the messages/i, // Groq (also the tail of the OpenAI family wording)
  /prompt is too long/i, // Anthropic-style backends behind an openai-compatible proxy
];

// The REQUESTED token count — what R2 calls "observed usage": the failing request's own size, never the model's
// advertised maximum (patterns deliberately skip "maximum context length is N").
const OBSERVED_PATTERNS: RegExp[] = [
  /you requested (\d+) tokens/i, // OpenAI (older format) / DeepSeek / vLLM
  /messages resulted in (\d+) tokens/i, // OpenAI (current format)
  /input length \((\d+) tokens?\)/i, // sglang
  /prompt is too long: (\d+) tokens/i, // Anthropic-style
];

/**
 * True ONLY for an APICallError with a 4xx (or absent) status whose message/body matches the context-length family.
 * 5xx is deliberately excluded: a gateway-wrapped upstream error is not distinguishable from a transient fault, and
 * the safe failure mode here is "no retry".
 */
export function isContextOverflowError(error: unknown): boolean {
  if (!APICallError.isInstance(error)) return false;
  if (error.statusCode !== undefined && (error.statusCode < 400 || error.statusCode >= 500)) return false;
  const text = errorText(error);
  return OVERFLOW_PATTERNS.some((pattern) => pattern.test(text));
}

/** The failing request's token count as reported by the provider; undefined when the body carries none. */
export function observedTokensOf(error: unknown): number | undefined {
  if (!APICallError.isInstance(error)) return undefined;
  const text = errorText(error);
  for (const pattern of OBSERVED_PATTERNS) {
    const tokens = Number(pattern.exec(text)?.[1]);
    if (Number.isFinite(tokens) && tokens > 0) return tokens;
  }
  return undefined;
}

// Match against BOTH surfaces: `message` is the provider-parsed error text, but some proxies put the real cause only
// in the raw body (librecode's upstream #17748 case — generic message, structured body code).
function errorText(error: APICallError): string {
  return `${error.message}\n${error.responseBody ?? ""}`;
}
