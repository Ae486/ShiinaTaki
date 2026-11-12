/**
 * INPUT:  authenticated client generations, visible demand and explicit Skill lifecycle/inspection actions.
 * OUTPUT: retained current-generation lists, bounded reads, serialized writes and package-bound inspection lifetimes.
 * POS:    Home Skills state owner; no persistence, write replay, cross-client snapshots or automatic filesystem work.
 */
import type { SkillImportParams, SkillInspectResult, SkillListResult, SkillMutationParams, SkillPackageView } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator, type ReadCoordinator } from "@/lib/read-coordinator.js";
import { createReadObservation, type ReadObservation, type ReadObservationState } from "@/lib/read-observation.js";

export type SkillClient = Pick<WsClient, "skillList" | "skillInspect" | "skillImport" | "skillEnable" | "skillDisable" | "skillRemove" | "skillReconcile" | "subscribeExtensions" | "onExtensionChanged">;
export interface SkillsState {
  kind: "idle" | "loading" | "ready" | "failure";
  packages: SkillPackageView[] | null;
  inspected: SkillInspectResult | null;
  pending: string | null;
  message: string | null;
  readError: string | null;
  inspectOpen: boolean;
  inspectPending: string | null;
  inspectStale: boolean;
  inspectError: string | null;
  observation: ReadObservationState;
}
export interface SkillsController {
  bind(client: SkillClient | null): void;
  setVisible(visible: boolean): void;
  refresh(): Promise<void>;
  invalidate(): Promise<void>;
  select(packageId: string | null): void;
  inspect(packageId: string): Promise<void>;
  setInspectionOpen(open: boolean): void;
  importPackage(params: SkillImportParams): Promise<boolean>;
  setEnabled(row: SkillPackageView): Promise<boolean>;
  remove(row: SkillPackageView): Promise<boolean>;
  reconcile(): Promise<boolean>;
}
export const INITIAL_SKILLS_STATE: SkillsState = {
  kind: "idle", packages: null, inspected: null, pending: null, message: null, readError: null,
  inspectOpen: false, inspectPending: null, inspectStale: false, inspectError: null, observation: "idle",
};

export function createSkillsController(publish: (state: SkillsState) => void): SkillsController {
  return new SkillsOwner(publish);
}

class SkillsOwner implements SkillsController {
  private state = INITIAL_SKILLS_STATE;
  private client: SkillClient | null = null;
  private generation = 0;
  private readEpoch = 0;
  private needsRead = true;
  private visible = true;
  private mutating = false;
  private restoreAfterMutation = false;
  private selected: string | null = null;
  private inspectEpoch = 0;
  private inspectFlight: Promise<void> | null = null;
  private inspectIdentity: string | null = null;
  private readonly reads: ReadCoordinator<SkillListResult>;
  private readonly observation: ReadObservation;
  private readonly publish: (state: SkillsState) => void;

  constructor(publish: (state: SkillsState) => void) {
    this.publish = publish;
    this.reads = createReadCoordinator<SkillListResult>({
      started: () => { this.needsRead = true; this.set({ ...this.state, kind: "loading", readError: null }); },
      loaded: ({ packages }) => this.acceptPackages(packages),
      failed: (error) => this.set({ ...this.state, kind: "failure", readError: readable(error) }),
      retired: () => { if (this.needsRead) this.set({ ...this.state, kind: "idle" }); },
    });
    this.observation = createReadObservation({
      changed: (observation) => this.set({ ...this.state, observation, kind: observation === "subscribing" ? "loading" : this.state.kind }),
      failed: (cause) => this.set({ ...this.state, kind: "failure", readError: readable(cause) }),
      invalidated: () => { void this.invalidate(); },
    });
  }

  bind(client: SkillClient | null): void {
    if (this.client === client) return;
    this.generation += 1;
    this.readEpoch += 1;
    this.needsRead = true;
    this.retireInspect();
    this.client = client;
    this.mutating = false;
    this.restoreAfterMutation = false;
    this.selected = null;
    this.reads.setActive(false);
    this.reads.replace(client ? () => client.skillList() : null);
    this.set(INITIAL_SKILLS_STATE);
    this.observation.replace(client ? {
      subscribe: () => client.subscribeExtensions(),
      onChanged: (changed) => client.onExtensionChanged((event) => { if (event.targets.includes("skills")) changed(event.revision); }),
    } : null);
    if (client) void this.refresh();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.readEpoch += 1;
    this.reads.setActive(visible && !this.mutating && this.observation.usable());
    if (!visible) {
      this.retireInspect();
      this.set({ ...this.state, inspectPending: null });
    } else {
      this.publish(this.state);
      if (this.mutating) this.restoreAfterMutation = true;
      else if (this.needsRead || this.observation.state() !== "live") void this.refresh();
    }
  }

  refresh(): Promise<void> { return this.read(false); }
  invalidate(): Promise<void> { this.needsRead = true; return this.reads.invalidate(); }

  select(packageId: string | null): void {
    if (this.selected === packageId) return;
    this.selected = packageId;
    this.retireInspect();
    this.set({ ...this.state, inspectPending: null, inspectOpen: false, inspectError: null });
  }

  setInspectionOpen(open: boolean): void {
    if (!open) this.retireInspect();
    this.set({ ...this.state, inspectOpen: open, inspectPending: open ? this.state.inspectPending : null });
  }

  inspect(packageId: string): Promise<void> {
    const row = this.state.packages?.find((entry) => entry.packageId === packageId);
    if (!this.client || !this.visible || this.mutating || !row) return Promise.resolve();
    if (this.inspectFlight && this.state.inspectPending === packageId) return this.inspectFlight;
    this.select(packageId);
    const token = ++this.inspectEpoch;
    this.inspectIdentity = inspectionIdentity(row);
    this.set({ ...this.state, inspectOpen: true, inspectPending: packageId, inspectError: null });
    this.inspectFlight = this.runInspect(this.client, { row, token, generation: this.generation });
    return this.inspectFlight;
  }

  importPackage(params: SkillImportParams): Promise<boolean> {
    return this.mutate("import", (client) => client.skillImport(params));
  }
  setEnabled(row: SkillPackageView): Promise<boolean> {
    return this.mutate(row.enabled ? "disable" : "enable", (client) =>
      row.enabled ? client.skillDisable(revisionOf(row)) : client.skillEnable(revisionOf(row)));
  }
  remove(row: SkillPackageView): Promise<boolean> {
    return this.mutate("remove", (client) => client.skillRemove(revisionOf(row)));
  }
  reconcile(): Promise<boolean> { return this.mutate("reconcile", (client) => client.skillReconcile()); }

  private async mutate(label: string, run: (client: SkillClient) => Promise<unknown>): Promise<boolean> {
    const client = this.client;
    const generation = this.generation;
    if (!client || this.mutating) return false;
    this.mutating = true;
    this.readEpoch += 1;
    this.needsRead = true;
    this.reads.setActive(false);
    this.retireInspect();
    this.set({ ...this.state, pending: label, message: null, inspectPending: null });
    let succeeded = false;
    try {
      await run(client);
      succeeded = this.current(client, generation);
    } catch (cause) {
      if (this.current(client, generation)) this.set({ ...this.state, message: readable(cause) });
    } finally {
      if (this.current(client, generation)) {
        this.reads.acceptUpdate();
        if (this.visible) this.restoreAfterMutation = false;
        await this.read(true);
        if (this.current(client, generation)) {
          this.mutating = false;
          this.reads.setActive(this.visible && this.observation.usable());
          this.set({ ...this.state, pending: null });
          if (this.visible && this.restoreAfterMutation) {
            this.restoreAfterMutation = false;
            await this.refresh();
          }
        }
      }
    }
    return succeeded && this.current(client, generation);
  }

  private async runInspect(client: SkillClient, request: { row: SkillPackageView; token: number; generation: number }): Promise<void> {
    const current = () => this.current(client, request.generation) && this.visible
      && this.inspectEpoch === request.token && this.state.inspectOpen
      && inspectionIdentity(this.state.packages?.find((row) => row.packageId === request.row.packageId)) === inspectionIdentity(request.row);
    try {
      const inspected = await client.skillInspect(request.row.packageId);
      if (!current()) return;
      if (inspected.package.packageId !== request.row.packageId) {
        this.set({ ...this.state, inspectPending: null, inspectError: "返回的技能包不匹配，请重新检查。" });
        return;
      }
      // Inspection can discover a changed package. Its accepted row must supersede any older bare list read.
      this.reads.acceptUpdate();
      const packages = this.state.packages?.map((row) => row.packageId === inspected.package.packageId ? inspected.package : row) ?? null;
      this.set({ ...this.state, packages, inspected, inspectPending: null, inspectStale: false, inspectError: null });
    } catch (cause) {
      if (current()) this.set({ ...this.state, inspectPending: null, inspectError: readable(cause) });
    } finally {
      if (this.inspectEpoch === request.token) {
        this.inspectFlight = null;
        if (this.state.inspectPending !== null) this.set({ ...this.state, inspectPending: null });
      }
    }
  }

  private acceptPackages(packages: SkillPackageView[]): void {
    this.needsRead = false;
    const inspectedRow = this.state.inspected?.package;
    const replacement = inspectedRow ? packages.find((row) => row.packageId === inspectedRow.packageId) : undefined;
    const inspected = replacement ? this.state.inspected : null;
    const inspectStale = inspected !== null && inspectionIdentity(replacement) !== inspectionIdentity(inspectedRow);
    const selected = packages.find((row) => row.packageId === this.selected);
    const retiredDetail = !selected || (this.state.inspectPending !== null && inspectionIdentity(selected) !== this.inspectIdentity);
    if (retiredDetail) this.retireInspect();
    if (!selected) {
      this.selected = packages[0]?.packageId ?? null;
    }
    this.set({ ...this.state, kind: "ready", packages, readError: null, inspected, inspectStale,
      inspectPending: retiredDetail ? null : this.state.inspectPending,
      inspectOpen: selected ? this.state.inspectOpen : false });
  }

  private retireInspect(): void { this.inspectEpoch += 1; this.inspectFlight = null; }
  private async read(afterMutation: boolean): Promise<void> {
    if (!this.client || !this.visible || (this.mutating && !afterMutation)) return;
    const token = this.readEpoch;
    if (!this.observation.usable() && !await this.observation.prepare()) return;
    if (token !== this.readEpoch || !this.visible || (this.mutating && !afterMutation)) return;
    this.reads.setActive(true);
    await this.reads.demand();
  }
  private current(client: SkillClient, generation: number): boolean { return this.client === client && this.generation === generation; }
  private set(state: SkillsState): void { this.state = state; if (this.visible) this.publish(state); }
}

function inspectionIdentity(row: SkillPackageView | undefined): string | null {
  return row ? JSON.stringify([row.packageId, row.ownerHostId, row.configRevision, row.contentHash, row.updatedAt, row.lifecycleState]) : null;
}
function revisionOf(row: SkillPackageView): SkillMutationParams {
  return { packageId: row.packageId, expectedConfigRevision: row.configRevision };
}
function readable(error: unknown): string { return error instanceof Error ? error.message : "未知错误"; }
