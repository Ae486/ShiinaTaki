import { describe, expect, it } from "vitest";

import { mapChinesePinyin, mapJapaneseKana, mapLanguageSegments } from "./mouth-language.ts";

describe("mouth language adapters", () => {
  it("maps Chinese Pinyin initials/finals and marks Han-only input unknown", () => {
    expect(mapChinesePinyin({ text: "b p m" }).map((token) => token.mouth)).toEqual(["closed", "closed", "closed"]);
    expect(mapChinesePinyin({ text: "a o i u" }).map((token) => token.mouth)).toEqual(["wide", "rounded", "spread", "narrow-rounded"]);
    const fallback = mapChinesePinyin({ text: "你好" });
    expect(fallback).toHaveLength(1);
    expect(fallback[0]?.unknown).toBe(true);
    expect(fallback[0]?.approximate).toBe(true);
    expect(mapChinesePinyin({ text: "你好", phoneticHint: "ni3 hao3" }).map((token) => token.mouth)).toEqual(["spread", "wide"]);
  });

  it("maps Japanese vowel rows and handles mora control marks conservatively", () => {
    expect(mapJapaneseKana("あいうえお").map((token) => token.mouth)).toEqual(["open", "spread", "narrow-rounded", "open", "rounded"]);
    const marks = mapJapaneseKana("ーっん");
    expect(marks.map((token) => token.mouth)).toEqual(["unknown", "closed", "unknown"]);
    expect(marks[0]?.unknown).toBe(true);
  });

  it("retains locale tags across a code-switched segment list", () => {
    const tokens = mapLanguageSegments([{ locale: "zh-CN", text: "ma1" }, { locale: "ja-JP", text: "あ" }]);
    expect(tokens.map((token) => token.locale)).toEqual(["zh-CN", "ja-JP"]);
  });
});
