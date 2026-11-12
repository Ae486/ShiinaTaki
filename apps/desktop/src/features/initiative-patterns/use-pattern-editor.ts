/**
 * INPUT: one explicit editing session and proposal action over a captured base revision.
 * OUTPUT: retained draft, Shared validation and guarded submission that never clears newer edits.
 * POS: Desktop local form state; background reads do not advance its CAS base or overwrite text.
 */
import { useEffect, useRef, useState } from "react";
import { InteractionPatternDefinitionSchema, type InteractionPatternDefinition, type InteractionPatternView } from "@taki/shared";
import { newPatternDraft } from "./pattern-draft.ts";

export function usePatternEditor(input: {
  initial: InteractionPatternView | null;
  submit(base: InteractionPatternView | null, definition: InteractionPatternDefinition): Promise<boolean>;
  close(): void;
}) {
  const [base, setBase] = useState(input.initial);
  const [draft, setDraft] = useState(input.initial?.candidateRevision?.definition ?? input.initial?.effectiveRevision?.definition ?? newPatternDraft);
  const [error, setError] = useState<string | null>(null);
  const current = useRef({ draft, mounted: true });
  current.current.draft = draft;
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  const save = async () => {
    const parsed = InteractionPatternDefinitionSchema.safeParse(draft);
    if (!parsed.success) { setError("请填写名称和目的，并检查条件、数值范围与有效期。开始和结束时间不能相同。"); return; }
    setError(null);
    const saved = await input.submit(base, parsed.data);
    if (saved && current.current.mounted && current.current.draft === draft) input.close();
  };
  return { base, draft, error, save, useLatestBase: setBase,
    patch: (next: Partial<InteractionPatternDefinition>) => setDraft((value) => ({ ...value, ...next })) };
}
