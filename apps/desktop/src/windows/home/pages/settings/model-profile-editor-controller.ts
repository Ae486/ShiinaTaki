/**
 * INPUT: a presence-only profile snapshot, current client, and explicit editor actions.
 * OUTPUT: retained local drafts, CAS saves, optional tests and read-first unknown-outcome recovery.
 * POS: Settings editor lifetime; credentials remain ephemeral input and mutations are never replayed.
 */
import { JSONRPCErrorException } from "json-rpc-2.0";
import type { ModelProfileForm, ModelProfilesResult, ModelProfileStatus } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { completeProfile, formFromProfile, profileSaveMessage } from "./model-profile-form.ts";

type ProfileWriter = Pick<WsClient, "modelProfileSave" | "modelProfileTest">;
export interface ProfileEditorInput {
  status: ModelProfileStatus;
  client: ProfileWriter | null;
  fresh: boolean;
  observation: number;
  accept(result: ModelProfilesResult): void;
  refresh(): Promise<void>;
}
export interface ProfileEditorState {
  form: ModelProfileForm;
  baselineRevision: number;
  dirty: boolean;
  conflict: boolean;
  pending: "save" | "test" | null;
  unconfirmed: boolean;
  feedback: { kind: "save" | "test" | "error" | "recovery"; tone: "info" | "warn" | "danger"; message: string } | null;
}

export function createProfileEditor(input: ProfileEditorInput, publish: (state: ProfileEditorState) => void) {
  return new ProfileEditor(input, publish);
}

class ProfileEditor {
  private input: ProfileEditorInput;
  private state: ProfileEditorState;
  private readonly publish: (state: ProfileEditorState) => void;
  private generation = 0;
  private editVersion = 0;
  private focused = false;
  private composing = false;
  private pendingObservation = 0;

  constructor(input: ProfileEditorInput, publish: (state: ProfileEditorState) => void) {
    this.input = input;
    this.publish = publish;
    this.state = { form: formFromProfile(input.status), baselineRevision: input.status.revision,
      dirty: false, conflict: false, pending: null, unconfirmed: false, feedback: null };
  }

  snapshot(): ProfileEditorState { return this.state; }

  update(input: ProfileEditorInput): void {
    if (input.client !== this.input.client) {
      this.generation += 1;
      if (this.state.pending) this.unknown();
    }
    this.input = input;
    if (!input.fresh) return;
    if (this.state.unconfirmed && input.observation > this.pendingObservation) {
      this.set({ unconfirmed: false, feedback: { kind: "recovery", tone: "warn", message: "已重新读取当前配置，请核对后继续。上次提交未自动重试。" } });
    }
    if (input.status.revision === this.state.baselineRevision) return;
    if (this.state.dirty || this.focused || this.composing || this.state.pending) {
      if (!this.state.conflict) this.set({ conflict: true });
    }
    else this.adopt(input.status);
  }

  change(patch: Partial<ModelProfileForm>): void {
    this.editVersion += 1;
    const form = { ...this.state.form, ...patch };
    if (form.auth === "none" || form.mode !== "configured") delete form.apiKey;
    this.set({ form, dirty: true, feedback: null });
  }

  focus(value: boolean): void {
    this.focused = value;
    if (!value && !this.state.dirty && !this.state.pending && !this.composing) this.adopt(this.input.status);
  }

  compose(value: boolean): void { this.composing = value; }

  useLatest(): void {
    if (this.state.pending || this.composing) return;
    this.editVersion += 1;
    this.adopt(this.input.status);
    this.set({ feedback: null });
  }

  keepEdits(): void {
    if (this.state.pending || this.composing || !this.input.fresh) return;
    this.set({ baselineRevision: this.input.status.revision, conflict: false, feedback: null });
  }

  async save(reset = false): Promise<void> {
    const client = this.begin("save");
    if (!client) return;
    const generation = this.generation;
    const editVersion = this.editVersion;
    const { status } = this.input;
    const profile = this.state.form;
    const action = reset ? "reset" : completeProfile(profile, status) ? "apply" : "draft";
    try {
      const result = await client.modelProfileSave({ slot: status.slot, expectedRevision: this.state.baselineRevision,
        action, ...(reset ? {} : { profile }) });
      if (generation !== this.generation) return;
      this.input.accept(result);
      const saved = result.profiles.find((item) => item.slot === status.slot);
      if (!saved) throw new Error("Missing saved profile");
      if (editVersion === this.editVersion) this.adopt(saved);
      else this.set({ baselineRevision: saved.revision, conflict: false });
      this.set({ feedback: { kind: "save", tone: saved.applicationState === "failed" ? "warn" : "info", message: profileSaveMessage(saved) } });
    } catch (cause) {
      if (generation !== this.generation) return;
      this.failed(cause);
      await this.input.refresh();
    } finally {
      if (generation === this.generation) this.set({ pending: null });
    }
  }

  async test(): Promise<void> {
    const client = this.begin("test");
    if (!client) return;
    const generation = this.generation;
    const editVersion = this.editVersion;
    try {
      const result = await client.modelProfileTest({ slot: this.input.status.slot,
        expectedRevision: this.state.baselineRevision, profile: this.state.form });
      if (generation !== this.generation || editVersion !== this.editVersion) return;
      this.set({ feedback: { kind: "test", tone: result.ok ? "info" : "warn", message: `${result.message} 本次测试不保存或应用配置。` } });
    } catch (cause) {
      if (generation !== this.generation) return;
      this.failed(cause);
      await this.input.refresh();
    } finally {
      if (generation === this.generation) this.set({ pending: null });
    }
  }

  private begin(kind: "save" | "test"): ProfileWriter | null {
    if (!this.input.client || !this.input.fresh || this.state.pending || this.state.conflict
      || this.state.unconfirmed || this.composing) return null;
    this.pendingObservation = this.input.observation;
    this.set({ pending: kind, feedback: null });
    return this.input.client;
  }

  private failed(cause: unknown): void {
    if (cause instanceof JSONRPCErrorException) {
      this.set({ feedback: { kind: "error", tone: "danger", message: `${cause.message} 输入已保留。` } });
    } else this.unknown();
  }

  private unknown(): void {
    this.pendingObservation = this.input.observation;
    const testing = this.state.pending === "test";
    this.set({ pending: null, unconfirmed: true, feedback: { kind: "recovery", tone: "warn",
      message: testing ? "测试结果尚未确认，可能已经产生费用；未自动重试。重新读取配置后可继续编辑。"
        : "提交结果尚未确认，正在等待重新读取配置；输入已保留，请勿重复提交。" } });
  }

  private adopt(status: ModelProfileStatus): void {
    this.set({ form: formFromProfile(status), baselineRevision: status.revision, dirty: false, conflict: false });
  }

  private set(patch: Partial<ProfileEditorState>): void {
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }
}
