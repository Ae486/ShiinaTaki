/**
 * INPUT: construction-owned text fragments, tool suppliers and selected message objects
 * OUTPUT: non-serialized attribution sidecars and exact text spans
 * POS: core/agents — request description only; no provider content, execution or durable authority
 */
import type { ContextCategory, ContextContentOrigin } from "@taki/shared";

export interface ContextTextSpan { start: number; end: number; category: ContextCategory; origin: ContextContentOrigin }
export interface AttributedText { text: string; spans: readonly ContextTextSpan[] }
const texts = new WeakMap<object, AttributedText>();
const origins = new WeakMap<object, ContextContentOrigin>();
const renders = new WeakMap<object, AttributedText>();

export function contextText(text: string, category: ContextCategory, origin: ContextContentOrigin = "builtin"): AttributedText {
  return { text, spans: text ? [{ start: 0, end: text.length, category, origin }] : [] };
}

/** Joiners are deliberately attributed to framing, never invented provider token components. */
export function joinContextText(parts: readonly AttributedText[], separator = "\n\n", keepEmpty = false): AttributedText {
  let text = "";
  let included = false;
  const spans: ContextTextSpan[] = [];
  for (const part of parts) {
    if (!part.text && !keepEmpty) continue;
    if (included) { spans.push({ start: text.length, end: text.length + separator.length, category: "other", origin: "builtin" }); text += separator; }
    included = true;
    const offset = text.length;
    text += part.text;
    spans.push(...part.spans.map((span) => ({ ...span, start: span.start + offset, end: span.end + offset })));
  }
  return { text, spans };
}

export function retainContextText<T extends object>(owner: T, text: AttributedText): T { texts.set(owner, text); return owner; }
export function attributedContextText(owner: object): AttributedText | undefined { return texts.get(owner); }
export function retainContentOrigin<T>(value: T, origin: ContextContentOrigin): T {
  if (typeof value === "object" && value !== null) origins.set(value, origin);
  return value;
}
export function contentOrigin(value: unknown): ContextContentOrigin | undefined {
  return typeof value === "object" && value !== null ? origins.get(value) : undefined;
}
export function copyContentOrigin<T>(source: unknown, target: T): T {
  const origin = contentOrigin(source); return origin ? retainContentOrigin(target, origin) : target;
}

/** One synchronous render result beside its existing closure; no string-keyed process-wide prompt registry. */
export function attributedRenderer<Args extends unknown[]>(render: (...args: Args) => AttributedText): (...args: Args) => string {
  const assembly = (...args: Args) => { const result = render(...args); renders.set(assembly, result); return result.text; };
  return assembly;
}
export function renderedContextText(renderer: object, text: string): AttributedText | undefined {
  const result = renders.get(renderer); return result?.text === text ? result : undefined;
}
export function forwardRenderedContextText(owner: object, source: object, text: string): string {
  const result = renderedContextText(source, text); if (result) renders.set(owner, result); return text;
}
