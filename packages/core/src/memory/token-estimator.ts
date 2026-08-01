/**
 * INPUT:  text (estimate), ordered items + a token budget (fit), or AI SDK ModelMessages (message estimate)
 * OUTPUT: estimateTokens(text) -> number; fitToBudget(items, budget, textOf) -> kept items;
 *         estimateMessageTokens(message) / estimateMessagesTokens(messages) -> number (R1 tier-3 estimator)
 * POS:    core/memory — soft token budgeting (research/frontmatter-and-budget.md §2); constants live here for
 *         calibration (the window calibrator's EMA corrects their residual bias, R1 tier 2)
 */
import type { ModelMessage } from "ai";

// CJK (kana, ext-A, unified, compat, halfwidth kana) count ~1 token/char; other text ~1 token / 4 chars.
// Keep the two regime constants in ONE place so calibration against real provider `usage` is a two-line tweak.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/gu;

export function estimateTokens(text: string): number {
  const cjk = (text.match(CJK_RE) ?? []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

/**
 * Take items in order until the budget is reached (soft: the first item is always kept, even if oversized).
 * erring slightly high truncates a touch early — the safe direction for a context budget.
 */
export function fitToBudget<T>(items: T[], budget: number, textOf: (item: T) => string): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    const cost = estimateTokens(textOf(item));
    if (used + cost > budget && kept.length > 0) break;
    kept.push(item);
    used += cost;
  }
  return kept;
}

// Per-message chat-format envelope (role framing + separators). LOCAL: the direction comes from OpenAI's classic
// tokens-per-message figure (3-4 in the cookbook's num_tokens_from_messages); exact value is gateway-dependent.
export const MESSAGE_OVERHEAD = 4;

// Flat per-image cost for file/image parts. Sourced precedent: Claude Code IMAGE_TOKEN_ESTIMATE and Hermes
// _IMAGE_TOKEN_ESTIMATE both use 1,600 tokens/image (rb-projection-precedents §B); real cost varies with size,
// but a flat figure is what every surveyed system ships.
export const IMAGE_TOKENS = 1600;

/** Part-aware estimate of one AI SDK message: envelope + text regimes + flat image cost + tool JSON payloads. */
export function estimateMessageTokens(message: ModelMessage): number {
  const { content } = message;
  if (typeof content === "string") return MESSAGE_OVERHEAD + estimateTokens(content);
  const parts: readonly unknown[] = content;
  return MESSAGE_OVERHEAD + parts.reduce<number>((sum, part) => sum + partTokens(part), 0);
}

/** Sum over a whole request's messages — the window cut and the calibration estimate share this shape. */
export function estimateMessagesTokens(messages: ModelMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

// Structural narrowing instead of the SDK part unions: the per-role content arrays differ, but every part carries
// `type`, and an unknown class still gets a total (stringified) estimate — erring high, the safe direction.
function partTokens(part: unknown): number {
  if (typeof part !== "object" || part === null || !("type" in part)) return 0;
  const p = part as { type: string; text?: unknown; input?: unknown; output?: unknown };
  if (p.type === "text" && typeof p.text === "string") return estimateTokens(p.text);
  if (p.type === "file" || p.type === "image") return IMAGE_TOKENS;
  if (p.type === "tool-call") return estimateTokens(safeJson(p.input));
  if (p.type === "tool-result") return estimateTokens(safeJson(p.output));
  return estimateTokens(safeJson(part));
}

// JSON.stringify returns undefined for undefined and throws on cycles; tool payloads came off the wire (JSON-safe),
// but the estimator must be total — a weird payload costs 0, never a crash.
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
