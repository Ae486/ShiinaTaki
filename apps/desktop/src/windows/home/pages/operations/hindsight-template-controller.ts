/**
 * INPUT:  authenticated Home generations, Core template state and explicit draft/confirmation actions
 * OUTPUT: one disposable preview/detail lifetime over the existing serialized memory-operation owner
 * POS:    ui/operations — original-plan recovery and child observations never replay writes
 */
import { MemoryTemplatePreviewParamsSchema, type MemoryTemplatePreviewParams, type MemoryTemplatePreview, type MemoryTemplateDetail,
  type MemoryTemplateDerivedParams, type MemoryTemplateDerivedObservation, type MemoryTemplateRequest } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createMemoryOperationsController, type MemoryOperationsClient, type MemoryOperationsFeedback } from "./memory-operations-controller.ts";
import { templateDraft, templateFailure, templateFeedback, templateFrameIdentity, type TemplateFrame } from "./hindsight-template-state.ts";

export type TemplatesClient = MemoryOperationsClient & Pick<WsClient, "hindsightTemplatePreview" | "hindsightTemplateDetail" | "hindsightTemplateStatus" | "hindsightTemplateDerived" | "memoryOperationStatus">;
export interface TemplatesState {
  frame: TemplateFrame | null; loading: boolean; error: string | null; busyKey: string | null; feedback: MemoryOperationsFeedback | null;
  bankId: string | null; draft: MemoryTemplatePreviewParams | null; dirty: boolean; draftStale: boolean; editorPending: boolean; editorRevision: number;
  preview: MemoryTemplatePreview | null; details: MemoryTemplateDetail[]; previewLoading: boolean; previewError: string | null;
  child: MemoryTemplateDerivedParams | null; derived: MemoryTemplateDerivedObservation | null; derivedLoading: boolean; derivedError: string | null;
}
export const INITIAL_TEMPLATES: TemplatesState = { frame: null, loading: true, error: null, busyKey: null, feedback: null, bankId: null,
  draft: null, dirty: false, draftStale: false, editorPending: false, editorRevision: 0, preview: null, details: [], previewLoading: false, previewError: null,
  child: null, derived: null, derivedLoading: false, derivedError: null };
export interface TemplateAcknowledgements { deletion: boolean; provider: boolean; enrollment: boolean }

export class TemplatesController {
  private client: TemplatesClient | null = null;
  private state: TemplatesState = INITIAL_TEMPLATES;
  private generation = 0;
  private previewToken = 0;
  private childToken = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: MemoryTemplateRequest | null = null;
  private restoreChild = false;
  private readonly emit: (state: TemplatesState) => void;
  private readonly operations: ReturnType<typeof createMemoryOperationsController<TemplateFrame>>;

  constructor(emit: (state: TemplatesState) => void) {
    this.emit = emit;
    this.operations = createMemoryOperationsController<TemplateFrame>({
      loading: () => this.update({ loading: true }), loaded: (frame) => this.loaded(frame),
      loadFailed: (cause) => { this.dismiss(); this.clearChild(false); this.update({ loading: false, error: templateFailure(cause) }); },
      mutationStarted: (busyKey) => this.update({ busyKey, feedback: null }),
      mutationSettled: (feedback) => this.update({ busyKey: null, feedback }),
    }, (candidate) => this.read(candidate), templateFeedback);
  }
  private update(patch: Partial<TemplatesState>): void { this.state = { ...this.state, ...patch }; this.emit(this.state); }
  private async read(candidate: MemoryOperationsClient): Promise<TemplateFrame> {
    const client = this.client;
    if (!client || candidate !== client) throw new Error("retired template client");
    const [template, authority] = await Promise.all([client.hindsightTemplateStatus(this.state.bankId ? { bankId: this.state.bankId } : {}), client.memoryAuthorityStatus()]);
    const original = template.plan ? await client.memoryOperationStatus(template.plan.originalOperationId) : null;
    return { template, authority, original };
  }
  private loaded(frame: TemplateFrame): void {
    const changed = this.state.frame !== null && templateFrameIdentity(frame) !== templateFrameIdentity(this.state.frame);
    if (changed) { this.dismiss(); this.clearChild(); }
    const editing = this.state.dirty || this.state.editorPending;
    this.update({ frame, loading: false, error: null, draftStale: this.state.draftStale || changed && editing,
      draft: !editing || !this.state.draft ? templateDraft(frame, this.state.bankId) : this.state.draft });
    if (this.restoreChild) {
      this.restoreChild = false;
      if (this.state.child) void this.observeChild(this.state.child);
    }
  }
  replace(client: TemplatesClient | null): void {
    this.generation++; this.dismiss(); this.clearChild(false); this.client = client;
    this.restoreChild = client !== null && this.state.child !== null;
    // Connection retirement discards executable consent, not the operator's unsubmitted intent.
    this.update({ busyKey: null, loading: client !== null, error: null });
    this.operations.replace(client);
  }
  selectBank(bankId: string | null): void {
    if (this.state.busyKey) return;
    this.clearChild(); this.update({ bankId, frame: null, draft: null, dirty: false, draftStale: false,
      editorPending: false, editorRevision: this.state.editorRevision + 1 }); this.replace(this.client);
  }
  resetDraft(): void {
    if (this.state.busyKey) return;
    this.dismiss();
    if (this.state.frame) this.update({ draft: templateDraft(this.state.frame, this.state.bankId), dirty: false, draftStale: false,
      editorPending: false, editorRevision: this.state.editorRevision + 1 });
  }
  edit(draft: MemoryTemplatePreviewParams): void {
    if (this.state.busyKey) return;
    this.dismiss(); this.update({ draft, dirty: true });
  }
  setResourceEditing(editorPending: boolean): void {
    if (editorPending) this.dismiss();
    this.update({ editorPending });
  }
  dismiss(): void {
    this.previewToken++; this.request = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.update({ preview: null, details: [], previewLoading: false, previewError: null });
  }
  private actionable(): boolean {
    return this.client !== null && !this.state.loading && !this.state.error && !this.state.busyKey;
  }
  async preview(): Promise<void> {
    if (!this.actionable() || !this.state.frame?.template.previewAvailable || !this.state.draft || this.state.draftStale || this.state.editorPending) return;
    const parsed = MemoryTemplatePreviewParamsSchema.safeParse(this.state.draft);
    if (!parsed.success) { this.update({ previewError: "请检查模板版本和自定义字段。" }); return; }
    const client = this.client; if (!client) return;
    this.dismiss(); const token = this.previewToken;
    this.update({ previewLoading: true });
    try {
      const preview = await client.hindsightTemplatePreview(parsed.data);
      if (token !== this.previewToken || client !== this.client) return;
      this.update({ preview });
      if (preview.state === "refused") { this.update({ previewLoading: false }); return; }
      const details: MemoryTemplateDetail[] = [];
      for (const bank of preview.banks) {
        const detail = await client.hindsightTemplateDetail({ previewId: preview.previewId, previewHash: preview.previewHash, bankId: bank.target.bank_id });
        if (token !== this.previewToken || client !== this.client) return;
        if (detail.previewId !== preview.previewId || detail.previewHash !== preview.previewHash
          || JSON.stringify(detail.bank) !== JSON.stringify(bank)) throw new Error("preview detail mismatch");
        details.push(detail);
      }
      if (Date.parse(preview.expiresAt) <= Date.now()) throw new Error("preview expired");
      this.request = { kind: "template.apply", requestId: crypto.randomUUID(), previewId: preview.previewId, previewHash: preview.previewHash };
      this.update({ details, previewLoading: false });
      this.timer = setTimeout(() => { this.dismiss(); this.update({ previewError: "预览已过期，请重新预览。" }); }, Date.parse(preview.expiresAt) - Date.now());
    } catch (cause) {
      if (token === this.previewToken && client === this.client) { this.dismiss(); this.update({ previewError: templateFailure(cause) }); }
    }
  }
  async confirm(ack: TemplateAcknowledgements): Promise<void> {
    const { preview, details, draft } = this.state; const request = this.request;
    if (!this.actionable() || !request || preview?.state !== "ready" || this.state.previewLoading
      || this.state.draftStale || this.state.editorPending || details.length !== preview.banks.length || !this.state.frame?.template.previewAvailable) return;
    if (Date.parse(preview.expiresAt) <= Date.now()) { this.dismiss(); this.update({ previewError: "预览已过期，请重新预览。" }); return; }
    if (details.some((item) => item.deletions.length > 0) && !ack.deletion
      || details.some((item) => item.refresh.length > 0) && !ack.provider
      || draft?.enrollment === "reviewed-existing" && !ack.enrollment) return;
    this.dismiss(); this.update({ dirty: false, draftStale: false });
    await this.operations.submit(request, "template:apply");
  }
  async recover(): Promise<void> {
    const planId = this.state.frame?.template.recoverPlanId;
    if (!this.actionable() || !planId) return;
    this.dismiss();
    await this.operations.submit({ kind: "template.recover", requestId: crypto.randomUUID(), planId }, "template:recover");
  }
  private clearChild(clearSelection = true): void {
    this.childToken++; this.update({ child: clearSelection ? null : this.state.child, derived: null, derivedLoading: false, derivedError: null });
  }
  async observeChild(child: MemoryTemplateDerivedParams): Promise<void> {
    const client = this.client; const plan = this.state.frame?.template.plan;
    if (this.state.derivedLoading && this.state.child?.childId === child.childId) return;
    if (!client || !plan || plan.planId !== child.planId || !plan.banks.some((bank) => bank.bank.target.bank_id === child.bankId
      && bank.derived.some((entry) => entry.childId === child.childId))) return;
    const token = ++this.childToken; const generation = this.generation;
    this.update({ child, derived: null, derivedLoading: true, derivedError: null });
    try {
      const derived = await client.hindsightTemplateDerived(child);
      if (generation !== this.generation || token !== this.childToken) return;
      if (derived.planId !== child.planId || derived.bankId !== child.bankId || derived.childId !== child.childId) throw new Error("derived identity mismatch");
      this.update({ derived, derivedLoading: false });
    } catch (cause) {
      if (generation === this.generation && token === this.childToken) this.update({ derived: null, derivedLoading: false, derivedError: templateFailure(cause) });
    }
  }
  async refresh(): Promise<void> { await this.operations.refresh(); }
  dispose(): void { this.generation++; this.dismiss(); this.clearChild(false); this.client = null; this.operations.dispose(); }
}
