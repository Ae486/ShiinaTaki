/**
 * INPUT:  set(characterId, {motions, expressions}) from the avatar.report method + render(characterId) from instructionsExtra
 * OUTPUT: createAvatarVocabulary() -> { set, render }; the per-character list of manifest names the LLM may use
 * POS:    core/avatar — the Option-A vocabulary store (no baked enum); names come from the Pet UI's loaded model (#16)
 */

export interface AvatarVocab {
  motions: readonly string[];
  expressions: readonly string[];
}

export interface AvatarVocabulary {
  /** Replace a character's known names (the Pet UI re-reports on load / costume-swap). */
  set(characterId: string, vocab: AvatarVocab): void;
  /** The character's names as a system-context section; "" when nothing is known (no empty section, like the skills list). */
  render(characterId: string): string;
}

const EXPRESSION_HEADER = "Avatar expressions you can set with avatar_set_expression:";
const MOTION_HEADER = "Avatar motions you can play with avatar_play_motion:";

export function createAvatarVocabulary(): AvatarVocabulary {
  const byCharacter = new Map<string, AvatarVocab>();

  return {
    set(characterId, vocab) {
      byCharacter.set(characterId, { motions: [...vocab.motions], expressions: [...vocab.expressions] });
    },
    render(characterId) {
      const vocab = byCharacter.get(characterId);
      if (!vocab) return "";
      const lines: string[] = [];
      if (vocab.expressions.length > 0) lines.push(`${EXPRESSION_HEADER} ${vocab.expressions.join(", ")}`);
      if (vocab.motions.length > 0) lines.push(`${MOTION_HEADER} ${vocab.motions.join(", ")}`);
      return lines.join("\n");
    },
  };
}
