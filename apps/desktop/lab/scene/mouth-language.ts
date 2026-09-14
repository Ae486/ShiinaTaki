/**
 * INPUT:  Chinese Pinyin/phonetic hints, Japanese kana/mora text, or explicitly locale-tagged mixed segments.
 * OUTPUT: universal many-to-one mouth tokens; raw Han text without a hint is retained as approximate/unknown.
 * POS:    experimental / lab — not in production path; locale front-end only; timing is intentionally left to a later track aligner.
 */

import type { MouthClass } from "./mouth-track.ts";

export type MouthLocale = "zh-CN" | "ja-JP" | "unknown";

export interface MouthToken {
  readonly unit: string;
  readonly mouth: MouthClass;
  readonly openness: number;
  readonly confidence: number;
  readonly locale: MouthLocale;
  readonly approximate: boolean;
  readonly unknown: boolean;
}

export interface ChineseMouthInput {
  readonly text: string;
  readonly phoneticHint?: string;
}

export interface LanguageSegment {
  readonly locale: MouthLocale;
  readonly text: string;
  readonly phoneticHint?: string;
}

export function mapChinesePinyin(input: ChineseMouthInput): MouthToken[] {
  const source = input.phoneticHint?.trim() || (looksLikeRomanized(input.text) ? input.text : "");
  if (source === "") return hanFallback(input.text);
  return source.split(/\s+/u).filter((unit) => unit.length > 0).map((unit) => pinyinToken(unit));
}

export function mapJapaneseKana(text: string): MouthToken[] {
  const units = japaneseMoraUnits(text);
  return units.map((unit) => japaneseToken(unit));
}

export function mapLanguageSegments(segments: readonly LanguageSegment[]): MouthToken[] {
  const tokens: MouthToken[] = [];
  for (const segment of segments) {
    if (segment.locale === "zh-CN") tokens.push(...mapChinesePinyin({ text: segment.text, phoneticHint: segment.phoneticHint }));
    else if (segment.locale === "ja-JP") tokens.push(...mapJapaneseKana(segment.text));
    else tokens.push(...unknownTokens(segment.text, "unknown"));
  }
  return tokens;
}

function pinyinToken(unit: string): MouthToken {
  const normalized = unit.toLowerCase().replace(/[0-9ˉˊˇˋ]/gu, "");
  const initial = normalized.slice(0, 2);
  if (["b", "p", "m"].includes(normalized[0] ?? "")) return token(unit, "closed", { openness: 0.05, locale: "zh-CN", approximate: false, unknown: false, confidence: 0.9 });
  if (normalized.startsWith("f")) return token(unit, "fricative", { openness: 0.2, locale: "zh-CN", approximate: false, unknown: false, confidence: 0.72 });
  if (/[a]/u.test(normalized)) {
    return token(unit, "wide", { openness: 0.78, locale: "zh-CN", approximate: true, unknown: false, confidence: 0.76 });
  }
  if (/[iuü]/u.test(normalized) && !/[aoe]/u.test(normalized)) {
    return token(unit, normalized.startsWith("u") || normalized.startsWith("ü") ? "narrow-rounded" : "spread", { openness: 0.32, locale: "zh-CN", approximate: true, unknown: false, confidence: 0.72 });
  }
  if (/[o]/u.test(normalized)) return token(unit, "rounded", { openness: 0.62, locale: "zh-CN", approximate: true, unknown: false, confidence: 0.76 });
  if (/[e]/u.test(normalized)) return token(unit, "open", { openness: 0.48, locale: "zh-CN", approximate: true, unknown: false, confidence: 0.7 });
  if (initial.length > 0) return token(unit, "unknown", { openness: 0.2, locale: "zh-CN", approximate: true, unknown: true, confidence: 0.25 });
  return token(unit, "unknown", { openness: 0.2, locale: "zh-CN", approximate: true, unknown: true, confidence: 0.2 });
}

function japaneseToken(unit: string): MouthToken {
  if (unit === "っ" || unit === "ッ") return token(unit, "closed", { openness: 0.05, locale: "ja-JP", approximate: false, unknown: false, confidence: 0.84 });
  if (unit === "ん" || unit === "ン") return token(unit, "unknown", { openness: 0.16, locale: "ja-JP", approximate: true, unknown: true, confidence: 0.46 });
  if (unit === "ー") return token(unit, "unknown", { openness: 0, locale: "ja-JP", approximate: true, unknown: true, confidence: 0.25 });
  if (/^[、。！？\s]+$/u.test(unit)) return token(unit, "rest", { openness: 0, locale: "ja-JP", approximate: false, unknown: false, confidence: 0.95 });
  const vowel = japaneseVowel(unit);
  if (vowel === "a") return token(unit, "open", { openness: 0.78, locale: "ja-JP", approximate: false, unknown: false, confidence: 0.84 });
  if (vowel === "i") return token(unit, "spread", { openness: 0.3, locale: "ja-JP", approximate: false, unknown: false, confidence: 0.84 });
  if (vowel === "u") return token(unit, "narrow-rounded", { openness: 0.35, locale: "ja-JP", approximate: false, unknown: false, confidence: 0.8 });
  if (vowel === "e") return token(unit, "open", { openness: 0.48, locale: "ja-JP", approximate: false, unknown: false, confidence: 0.82 });
  if (vowel === "o") return token(unit, "rounded", { openness: 0.6, locale: "ja-JP", approximate: false, unknown: false, confidence: 0.84 });
  return token(unit, "unknown", { openness: 0.18, locale: "ja-JP", approximate: true, unknown: true, confidence: 0.25 });
}

function japaneseMoraUnits(text: string): string[] {
  const chars = [...text];
  const units: string[] = [];
  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index];
    if (current === undefined) continue;
    const next = chars[index + 1];
    if (next !== undefined && isSmallY(next) && isKana(current)) {
      units.push(current + next);
      index += 1;
    } else units.push(current);
  }
  return units;
}

function japaneseVowel(unit: string): string | null {
  const last = [...unit].at(-1);
  if (last === undefined) return null;
  const normalized = katakanaToHiragana(last);
  if ("あかがさざただなはばぱまゃやらわぁ".includes(normalized)) return "a";
  if ("いきぎしじちぢにひびぴみりゐぃ".includes(normalized)) return "i";
  if ("うくぐすずつづぬふぶぷむゆるをぅ".includes(normalized)) return "u";
  if ("えけげせぜてでねへべぺめれゑぇ".includes(normalized)) return "e";
  if ("おこごそぞとどのほぼぽもよろをぉ".includes(normalized)) return "o";
  return null;
}

function hanFallback(text: string): MouthToken[] {
  const units = [...text].filter((character) => /[\u3400-\u9fff]/u.test(character));
  return units.length === 0 ? unknownTokens(text, "zh-CN") : unknownTokens(units.join(""), "zh-CN");
}

function unknownTokens(text: string, locale: MouthLocale): MouthToken[] {
  return text.length === 0 ? [] : [{ unit: text, mouth: "unknown", openness: 0.2, confidence: 0, locale, approximate: true, unknown: true }];
}

function token(unit: string, mouth: MouthClass, details: Omit<MouthToken, "unit" | "mouth">): MouthToken {
  return { unit, mouth, ...details };
}

function looksLikeRomanized(text: string): boolean {
  return text.trim().length > 0 && /^[a-züÜ0-9\s',.-]+$/u.test(text);
}

function isSmallY(character: string): boolean {
  return "ゃゅょャュョ".includes(character);
}

function isKana(character: string): boolean {
  return /[\u3040-\u30ff]/u.test(character);
}

function katakanaToHiragana(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : character;
}
