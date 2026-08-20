/**
 * INPUT: current authenticated WsClient generation and operator Skill lifecycle commands
 * OUTPUT: disposable Core-authoritative page state with late-result suppression and serialized mutations
 * POS:    Home Skills state owner; no persistence, write replay, or cross-client snapshot reuse
 */
import type { SkillImportParams, SkillInspectResult, SkillListResult, SkillMutationParams, SkillPackageView } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
export type SkillClient = Pick<WsClient, "skillList" | "skillInspect" | "skillImport" | "skillEnable" | "skillDisable" | "skillRemove" | "skillReconcile">;
export interface SkillsState { kind: "idle" | "loading" | "ready" | "failure"; packages: SkillPackageView[] | null; inspected: SkillInspectResult | null; pending: string | null; message: string | null; }
export interface SkillsController {
  bind(client: SkillClient | null): void; refresh(): Promise<void>; inspect(packageId: string): Promise<void>;
  importPackage(params: SkillImportParams): Promise<boolean>; setEnabled(row: SkillPackageView): Promise<boolean>;
  remove(row: SkillPackageView): Promise<boolean>; reconcile(): Promise<boolean>;
}
export const INITIAL_SKILLS_STATE: SkillsState = { kind: "idle", packages: null, inspected: null, pending: null, message: null };
export function createSkillsController(publish: (state: SkillsState) => void): SkillsController {
  let state = INITIAL_SKILLS_STATE; let client: SkillClient | null = null; let generation = 0; let listToken = 0; let inspectToken = 0; let mutationLock: number | null = null;
  const set = (next: SkillsState) => { state = next; publish(next); };
  const current = (candidate: SkillClient, epoch: number) => client === candidate && generation === epoch;
  async function load(candidate: SkillClient, epoch: number, pending: string | null): Promise<void> {
    const token = ++listToken;
    try { const result: SkillListResult = await candidate.skillList(); if (current(candidate, epoch) && token === listToken) set({ kind: "ready", packages: result.packages, inspected: state.inspected, pending, message: null }); }
    catch (error) { if (current(candidate, epoch) && token === listToken) set({ kind: "failure", packages: state.packages, inspected: state.inspected, pending, message: readable(error) }); }
  }
  async function mutate(label: string, run: (active: SkillClient) => Promise<unknown>): Promise<boolean> {
    const active = client; const epoch = generation; if (!active || mutationLock === epoch) return false; mutationLock = epoch; listToken += 1; inspectToken += 1;
    set({ ...state, kind: state.packages === null ? "loading" : "ready", pending: label, message: null });
    try { await run(active); if (!current(active, epoch)) return false; await load(active, epoch, label); return current(active, epoch) && state.kind === "ready"; }
    catch (error) {
      const message = readable(error); if (!current(active, epoch)) return false;
      const token = ++listToken; let packages = state.packages; try { packages = (await active.skillList()).packages; } catch { /* retain the last current-generation snapshot */ }
      if (current(active, epoch) && token === listToken) set({ kind: "failure", packages, inspected: state.inspected, pending: null, message }); return false;
    }
    finally { if (current(active, epoch)) { mutationLock = null; if (state.pending !== null) set({ ...state, pending: null }); } }
  }
  return {
    bind(next) { generation += 1; listToken += 1; inspectToken += 1; client = next; mutationLock = null; set(next ? { ...INITIAL_SKILLS_STATE, kind: "loading" } : INITIAL_SKILLS_STATE); if (next) void load(next, generation, null); },
    async refresh() { const active = client; const epoch = generation; if (!active) return; set({ ...state, kind: "loading", message: null }); await load(active, epoch, state.pending); },
    async inspect(packageId) { const active = client; const epoch = generation; const token = ++inspectToken; if (!active) return; try { const inspected = await active.skillInspect(packageId); if (current(active, epoch) && token === inspectToken) set({ ...state, inspected, message: null }); } catch (error) { if (current(active, epoch) && token === inspectToken) set({ ...state, kind: "failure", message: readable(error) }); } },
    importPackage: (params) => mutate("import", (active) => active.skillImport(params)),
    setEnabled: (row) => mutate(row.enabled ? "disable" : "enable", (active) => row.enabled ? active.skillDisable(revisionOf(row)) : active.skillEnable(revisionOf(row))),
    remove: (row) => mutate("remove", (active) => active.skillRemove(revisionOf(row))),
    reconcile: () => mutate("reconcile", (active) => active.skillReconcile()),
  };
}
function revisionOf(row: SkillPackageView): SkillMutationParams { return { packageId: row.packageId, expectedConfigRevision: row.configRevision }; }
function readable(error: unknown): string { return error instanceof Error ? error.message : "未知错误"; }
