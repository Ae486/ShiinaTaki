/**
 * INPUT:  set(characterId, {motions, expressions}, costume?) from avatar.report + get/render/consumeCostumeChanged(characterId) from per-turn assembly
 * OUTPUT: createAvatarVocabulary() -> { set, get, render, consumeCostumeChanged }; get() -> raw names (per-turn dynamic-enum source, 1e);
 *         render() -> the prompt vocabulary section + same-step usage discipline (1c); consumeCostumeChanged() -> true once after a costume swap (1f)
 * POS:    core/avatar — the Option-A vocabulary store; live names from the Pet UI model (#16); a runtime enum != a baked enum
 */

export interface AvatarVocab {
  motions: readonly string[];
  expressions: readonly string[];
}

export interface AvatarVocabulary {
  /** Replace a character's known names (the Pet UI re-reports on load / costume-swap). `costume` is the worn costume
   *  id for change detection (1f); undefined = no formal id available (boot / drift self-heal) → the last known id is
   *  kept rather than clobbered. */
  set(characterId: string, vocab: AvatarVocab, costume?: string): void;
  /** The character's current names, or undefined when nothing is known — the per-turn dynamic-enum source (1e). */
  get(characterId: string): AvatarVocab | undefined;
  /** The character's names as a system-context section; "" when nothing is known (no empty section, like the skills list). */
  render(characterId: string): string;
  /** True (and re-baselines) iff the worn costume differs from what the model saw last turn — consumed once per turn
   *  during instruction assembly to inject a one-shot change reminder (1f). The FIRST turn only establishes the
   *  baseline (never fires), so a boot promotion (dev→imported) is not mistaken for a costume change. */
  consumeCostumeChanged(characterId: string): boolean;
}

// Per-character record: the live vocab + the worn costume id + the id the model saw last turn (valid once baselined).
interface VocabRecord {
  vocab: { motions: string[]; expressions: string[] };
  costume: string | undefined;
  lastSeen: string | undefined;
  baselined: boolean;
}

const EXPRESSION_HEADER = "Avatar expressions you can set with avatar_set_expression:";
const MOTION_HEADER = "Avatar motions you can play with avatar_play_motion:";

// The same-step discipline that ships WITH the vocabulary (1c): keeps the model from padding a filler turn after a
// fire-and-forget avatar call, and from reusing names a costume swap has since replaced. These prompt rules are the
// bias; the structural guarantee is presentationTailStop (presentation-stop.ts).
const USAGE_RULES = [
  "How to use these avatar tools:",
  "- Express in the SAME reply: call avatar_set_expression / avatar_play_motion together with the words you are already saying, not as a separate message.",
  "- These tools are fire-and-forget — they change what is on screen and return nothing to read. After calling one, do NOT send another message just because the tool ran.",
  "- Once you have both spoken and expressed, you are done: stop. Never reply to your own previous message.",
  "- Do your real work (reading the screen, files, memory) first; express your reaction alongside your final reply.",
  "- Use ONLY the names listed above. Never reuse an expression/motion name remembered from earlier in the conversation — the set changes when the costume changes.",
].join("\n");

export function createAvatarVocabulary(): AvatarVocabulary {
  const byCharacter = new Map<string, VocabRecord>();

  return {
    set(characterId, vocab, costume) {
      const prev = byCharacter.get(characterId);
      byCharacter.set(characterId, {
        vocab: { motions: [...vocab.motions], expressions: [...vocab.expressions] },
        // undefined costume = "no new id" (boot / drift self-heal report carries no formal id): keep the last known
        // id, never clobber to undefined — that would make a self-heal look like a change / the next real switch look
        // unchanged.
        costume: costume ?? prev?.costume,
        lastSeen: prev?.lastSeen,
        baselined: prev?.baselined ?? false,
      });
    },
    get(characterId) {
      return byCharacter.get(characterId)?.vocab;
    },
    render(characterId) {
      const vocab = byCharacter.get(characterId)?.vocab;
      if (!vocab) return "";
      const lines: string[] = [];
      if (vocab.expressions.length > 0) lines.push(`${EXPRESSION_HEADER} ${vocab.expressions.join(", ")}`);
      if (vocab.motions.length > 0) lines.push(`${MOTION_HEADER} ${vocab.motions.join(", ")}`);
      // No usable names → no section at all (like the skills list); the usage rules only ship WITH a name list.
      if (lines.length === 0) return "";
      lines.push(USAGE_RULES);
      return lines.join("\n");
    },
    consumeCostumeChanged(characterId) {
      const rec = byCharacter.get(characterId);
      if (!rec) return false; // nothing known → no notice
      if (!rec.baselined) {
        // The first turn only SNAPSHOTS the baseline (whatever is worn now), so a boot promotion (dev→imported, or a
        // report(undefined)→report(id) sequence) is never mistaken for a change. Order-independent by construction.
        byCharacter.set(characterId, { ...rec, lastSeen: rec.costume, baselined: true });
        return false;
      }
      if (rec.costume === rec.lastSeen) return false; // unchanged (incl. churn A→B→C→A with no turns, undefined===undefined)
      byCharacter.set(characterId, { ...rec, lastSeen: rec.costume }); // advance the baseline once, then notify
      return true;
    },
  };
}
