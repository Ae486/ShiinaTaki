import { describe, expect, it, vi } from "vitest";
import { JSONRPCErrorException } from "json-rpc-2.0";
import type { ModelProfilesResult, ModelProfileStatus, ModelProfileTestResult } from "@taki/shared";
import { createProfileEditor, type ProfileEditorInput } from "./model-profile-editor-controller.ts";

const empty: ModelProfileStatus = { slot: "main", revision: 0,
  draft: { mode: "configured", baseUrl: "", model: "", auth: "none", secretSet: false },
  active: null, state: "unconfigured", applicationState: "draft", issues: [] };
const applied: ModelProfileStatus = { ...empty, revision: 1, state: "ready", applicationState: "applied",
  draft: { ...empty.draft, baseUrl: "http://localhost/v1", model: "custom-model" },
  active: { ...empty.draft, baseUrl: "http://localhost/v1", model: "custom-model", revision: 1, source: "application" } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function fixture(status = empty) {
  const client = { modelProfileSave: vi.fn(async (): Promise<ModelProfilesResult> => ({ profiles: [applied] })),
    modelProfileTest: vi.fn(async (): Promise<ModelProfileTestResult> => ({ ok: true, code: "OK", message: "成功" })) };
  let input: ProfileEditorInput = { status, client, fresh: true, observation: 1, accept: vi.fn(), refresh: vi.fn(async () => undefined) };
  const editor = createProfileEditor(input, vi.fn());
  return { client, editor, input, update(patch: Partial<ProfileEditorInput>) { input = { ...input, ...patch }; editor.update(input); } };
}

describe("grouped model profile editing", () => {
  it("saves incomplete input as a draft, applies complete keyless custom input, and never tests implicitly", async () => {
    const f = fixture();
    f.editor.change({ model: "custom-model" });
    await f.editor.save();
    expect(f.client.modelProfileSave).toHaveBeenLastCalledWith({ slot: "main", expectedRevision: 0, action: "draft",
      profile: { mode: "configured", baseUrl: "", model: "custom-model", auth: "none" } });
    f.editor.change({ baseUrl: "http://localhost/v1", model: "custom-model" });
    await f.editor.save();
    expect(f.client.modelProfileSave).toHaveBeenLastCalledWith(expect.objectContaining({ action: "apply" }));
    expect(f.client.modelProfileTest).not.toHaveBeenCalled();
  });

  it("allows optional testing of unsaved credentials without persisting them or changing active configuration", async () => {
    const f = fixture(applied);
    f.editor.change({ auth: "api-key", apiKey: "ephemeral", model: "unsaved" });
    await f.editor.test();
    expect(f.client.modelProfileTest).toHaveBeenCalledWith({ slot: "main", expectedRevision: 1,
      profile: { mode: "configured", baseUrl: "http://localhost/v1", model: "unsaved", auth: "api-key", apiKey: "ephemeral" } });
    expect(f.client.modelProfileSave).not.toHaveBeenCalled();
    expect(f.input.accept).not.toHaveBeenCalled();
    expect(f.editor.snapshot().dirty).toBe(true);
  });

  it("requires a replacement key after endpoint change and clears key input when no-auth is chosen", async () => {
    const f = fixture({ ...applied, draft: { ...applied.draft, auth: "api-key", secretSet: true } });
    f.editor.change({ baseUrl: "http://other/v1" });
    await f.editor.save();
    expect(f.client.modelProfileSave).toHaveBeenLastCalledWith(expect.objectContaining({ action: "draft" }));
    f.editor.change({ auth: "api-key", apiKey: "transient" });
    f.editor.change({ auth: "none" });
    expect(f.editor.snapshot().form.apiKey).toBeUndefined();
  });

  it("keeps local edits across pushes and supports both conflict choices without silent overwrite", async () => {
    const f = fixture(applied);
    f.editor.change({ model: "mine" });
    f.update({ status: { ...applied, revision: 2, draft: { ...applied.draft, model: "elsewhere" } }, observation: 2 });
    expect(f.editor.snapshot()).toMatchObject({ conflict: true, form: { model: "mine" }, baselineRevision: 1 });
    await f.editor.save();
    expect(f.client.modelProfileSave).not.toHaveBeenCalled();
    f.editor.keepEdits();
    await f.editor.save();
    expect(f.client.modelProfileSave).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2, profile: expect.objectContaining({ model: "mine" }) }));
    f.editor.useLatest();
    expect(f.editor.snapshot().form.model).toBe("elsewhere");
  });

  it("preserves newer input through an acknowledged save and clears only the submitted secret on matching input", async () => {
    const f = fixture();
    const pending = deferred<ModelProfilesResult>();
    f.client.modelProfileSave.mockReturnValueOnce(pending.promise);
    f.editor.change({ baseUrl: "http://localhost/v1", model: "submitted", auth: "api-key", apiKey: "secret" });
    const save = f.editor.save();
    f.editor.change({ model: "newer" });
    pending.resolve({ profiles: [applied] }); await save;
    expect(f.editor.snapshot()).toMatchObject({ form: { model: "newer" }, dirty: true, baselineRevision: 1 });
  });

  it("keeps failed application distinct from persistence and retains the active model", async () => {
    const f = fixture(applied);
    f.client.modelProfileSave.mockResolvedValueOnce({ profiles: [{ ...applied, revision: 2, applicationState: "failed", issues: ["INVALID"] }] });
    f.editor.change({ baseUrl: "invalid://url" }); await f.editor.save();
    expect(f.editor.snapshot().feedback).toMatchObject({ tone: "warn", message: expect.stringContaining("应用失败") });
    expect(f.input.accept).toHaveBeenCalledWith(expect.objectContaining({ profiles: [expect.objectContaining({ active: applied.active })] }));
  });

  it("reconciles a lost acknowledgement with a fresh read and never repeats the write", async () => {
    const f = fixture(applied);
    f.client.modelProfileSave.mockRejectedValueOnce(new Error("socket lost"));
    f.editor.change({ model: "candidate" }); await f.editor.save();
    expect(f.editor.snapshot().unconfirmed).toBe(true);
    expect(f.input.refresh).toHaveBeenCalledTimes(1);
    await f.editor.save();
    expect(f.client.modelProfileSave).toHaveBeenCalledTimes(1);
    f.update({ observation: 2, fresh: true });
    expect(f.editor.snapshot()).toMatchObject({ unconfirmed: false, form: { model: "candidate" } });
    expect(f.client.modelProfileSave).toHaveBeenCalledTimes(1);
  });

  it("retired responses cannot publish into a new connection and drafts survive reconnect", async () => {
    const f = fixture(applied); const pending = deferred<ModelProfilesResult>();
    f.client.modelProfileSave.mockReturnValueOnce(pending.promise);
    f.editor.change({ model: "candidate" }); const save = f.editor.save();
    f.update({ client: null, fresh: false }); pending.resolve({ profiles: [applied] }); await save;
    expect(f.input.accept).not.toHaveBeenCalled();
    expect(f.editor.snapshot()).toMatchObject({ unconfirmed: true, pending: null, form: { model: "candidate" } });
    f.update({ client: f.client, observation: 2, fresh: true });
    expect(f.editor.snapshot().unconfirmed).toBe(false);
  });

  it("keeps a Core refusal distinct from an unknown transport result and resets explicitly", async () => {
    const f = fixture(applied);
    f.client.modelProfileSave.mockRejectedValueOnce(new JSONRPCErrorException("凭据存储不可用", -32000, { reason: "LOCKED" }));
    await f.editor.save();
    expect(f.editor.snapshot()).toMatchObject({ unconfirmed: false, feedback: { tone: "danger" } });
    await f.editor.save(true);
    expect(f.client.modelProfileSave).toHaveBeenLastCalledWith({ slot: "main", expectedRevision: 1, action: "reset" });
  });

  it("saves explicit Utility inherit and disabled choices with apply", async () => {
    for (const mode of ["inherit", "disabled"] as const) {
      const f = fixture({ ...empty, slot: "utility" }); f.editor.change({ mode }); await f.editor.save();
      expect(f.client.modelProfileSave).toHaveBeenLastCalledWith(expect.objectContaining({ slot: "utility", action: "apply", profile: expect.objectContaining({ mode }) }));
    }
  });
});
