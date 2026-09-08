/**
 * INPUT:  current field metadata, focus/composition/edit events and explicit local save outcomes.
 * OUTPUT: a retained draft with observed-conflict actions and matching-attempt-only clean transitions.
 * POS:    Home Settings — field-local editing owner; never queues writes or claims server compare-and-swap.
 */
import type { ConfigEntry, ConfigValue } from "@taki/shared";
import type { ConfigSaveOutcome } from "./config-save-controller.ts";
import { editorFor, parseKnobInput } from "./knob-editor.ts";

export interface KnobDraftInput {
  entry: ConfigEntry;
  connectionReady: boolean;
  onSave(key: string, value: ConfigValue | null): Promise<ConfigSaveOutcome>;
}

export interface KnobDraftState {
  draft: string;
  baseline: string;
  latest: string;
  dirty: boolean;
  focused: boolean;
  composing: boolean;
  saving: boolean;
  error: string | null;
}

export function initialKnobDraft(entry: ConfigEntry): KnobDraftState {
  const display = editorFor(entry).display;
  return { draft: display, baseline: display, latest: display, dirty: false, focused: false, composing: false, saving: false, error: null };
}

export function createKnobDraftController(input: KnobDraftInput, publish: (state: KnobDraftState) => void) {
  return new KnobDraft(input, publish);
}

class KnobDraft {
  private input: KnobDraftInput;
  private state: KnobDraftState;
  private readonly publish: (state: KnobDraftState) => void;
  private draftEpoch = 0;
  private lifecycle = 0;

  constructor(input: KnobDraftInput, publish: (state: KnobDraftState) => void) {
    this.input = input;
    this.state = initialKnobDraft(input.entry);
    this.publish = publish;
  }

  update(input: KnobDraftInput): void {
    this.input = input;
    const latest = editorFor(input.entry).display;
    if (latest === this.state.latest) return;
    if (input.entry.secret || (!this.state.dirty && !this.state.focused && !this.state.composing)) {
      this.set({ ...this.state, draft: latest, latest, baseline: latest, dirty: false });
    } else this.set({ ...this.state, latest });
  }

  focus(): void { this.set({ ...this.state, focused: true }); }

  change(draft: string): void {
    this.draftEpoch += 1;
    this.set({ ...this.state, draft, dirty: draft !== this.state.baseline, error: null });
  }

  blur(): void {
    this.set({ ...this.state, focused: false });
    if (this.state.composing) return;
    if (!this.state.dirty) this.useLatest();
    else void this.save(false);
  }

  compositionStart(): void { this.set({ ...this.state, composing: true }); }

  compositionEnd(draft: string): void {
    this.change(draft);
    this.set({ ...this.state, composing: false });
    // A blur during composition is not a commit. Finalized text remains available for a deliberate save.
  }

  useLatest(): void {
    if (this.state.saving || this.state.composing) return;
    this.draftEpoch += 1;
    const { latest } = this.state;
    this.set({ ...this.state, draft: latest, baseline: latest, dirty: false, error: null });
  }

  async save(overwrite = false): Promise<void> {
    if (this.state.saving || this.state.composing || !this.state.dirty) return;
    if (this.state.latest !== this.state.baseline && !overwrite) return;
    const { entry, connectionReady, onSave } = this.input;
    if (!connectionReady || editorFor(entry).disabled) {
      this.set({ ...this.state, error: "当前无法保存此配置；草稿已保留。" });
      return;
    }
    const raw = entry.input.kind === "boolean" ? this.state.draft === "true" : this.state.draft;
    const parsed = parseKnobInput(entry, raw);
    if (!parsed.ok) { this.set({ ...this.state, error: parsed.message }); return; }
    if (parsed.value === entry.value && (parsed.value !== null || !entry.stored)) { this.useLatest(); return; }
    const epoch = this.draftEpoch;
    const lifecycle = this.lifecycle;
    this.set({ ...this.state, saving: true, error: null });
    try {
      const outcome = await onSave(entry.key, parsed.value);
      if (this.lifecycle === lifecycle) this.finish(outcome, epoch);
    } catch (cause) {
      if (this.lifecycle === lifecycle) this.set({ ...this.state, error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      if (this.lifecycle === lifecycle) this.set({ ...this.state, saving: false });
    }
  }

  retire(): void { this.lifecycle += 1; }

  private finish(outcome: ConfigSaveOutcome, epoch: number): void {
    if (outcome.kind !== "saved") {
      const error = outcome.kind === "retired" ? "连接已变化，保存结果尚未确认；草稿已保留。" : outcome.message;
      this.set({ ...this.state, error });
      return;
    }
    if (!outcome.current) {
      this.set({ ...this.state, error: "保存后观察到其他修改；草稿已保留，请核对最新值。" });
      return;
    }
    const unchanged = epoch === this.draftEpoch;
    const draft = unchanged ? outcome.display : this.state.draft;
    this.set({ ...this.state, draft, baseline: outcome.display, latest: outcome.display, dirty: draft !== outcome.display, error: null });
  }

  private set(state: KnobDraftState): void {
    this.state = state;
    this.publish(state);
  }
}
