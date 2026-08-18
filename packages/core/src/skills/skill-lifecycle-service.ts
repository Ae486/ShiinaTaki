/**
 * INPUT: operator Skill lifecycle requests plus the Core repository, store, and catalog
 * OUTPUT: serialized import and optimistic lifecycle operations with prebuilt runtime candidates
 * POS:    core/skills control plane; SQLite commit precedes a synchronous no-I/O catalog publication
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseSkillMetadata, publishSkill, quarantine, readPublishedContent, readPublishedFile, SkillValidationError, validateSkillFiles } from "./skill-package-store.ts";
import type { SkillImportParams, SkillInspectParams, SkillListResult, SkillMutationParams, SkillPackageView, SkillReconcileResult, SkillStandardMetadata } from "@taki/shared";
import type { SkillCatalogCandidate, SkillCatalogManager } from "./skill-catalog-manager.ts";
import { SkillConfigConflictError, type SkillPackageRepo, type SkillPackageWrite } from "./skill-package-repo.ts";
import { enumerateSource, SkillSourceError } from "./skill-package-source.ts";
import type { SkillPackageRow } from "./skill-package-types.ts";

export type SkillRefusalReason = "unknown-package" | "duplicate-skill" | "invalid-package" | "unsafe-package" | "package-disabled" | "revision-conflict" | "source-too-large";
export class SkillRefusedError extends Error { readonly reason: SkillRefusalReason; constructor(reason: SkillRefusalReason, message = "Skill lifecycle operation refused") { super(message); this.name = "SkillRefusedError"; this.reason = reason; } }
export interface SkillLifecycleService {
  list(): SkillListResult;
  inspect(params: SkillInspectParams): { package: SkillPackageView; metadata: SkillStandardMetadata | null; files: string[] };
  import(params: SkillImportParams): Promise<{ package: SkillPackageView }>;
  enable(params: SkillMutationParams): Promise<{ package: SkillPackageView }>;
  disable(params: SkillMutationParams): Promise<{ package: SkillPackageView }>;
  remove(params: SkillMutationParams): Promise<{ status: "removed"; packageId: string }>;
  reconcile(): Promise<SkillReconcileResult>;
}
interface ServiceDeps { repo: SkillPackageRepo; catalog: SkillCatalogManager; storeRoot: string; ownerHostId: string; }

export function createSkillLifecycleService(deps: ServiceDeps): SkillLifecycleService {
  let tail = Promise.resolve();
  const serialize = <T>(run: () => Promise<T>): Promise<T> => { const next = tail.then(run, run); tail = next.then(() => undefined, () => undefined); return next; };
  const view = (row: SkillPackageRow | null): SkillPackageView => packageView(deps, row);
  const requireRow = (id: string) => { const row = deps.repo.get(id); if (!row) throw new SkillRefusedError("unknown-package"); return row; };
  return {
    list() { return { packages: deps.repo.list().map(view), catalogGeneration: deps.catalog.currentGeneration() }; },
    inspect(params) {
      const row = requireRow(params.packageId);
      const content = row.skillName && row.contentHash ? readPublishedContent({ storeRoot: deps.storeRoot, packageId: row.packageId, skillName: row.skillName, description: row.description ?? "", hash: row.contentHash }) : null;
      const metadata = row.skillName && row.contentHash ? inspectMetadata(deps, row) : null;
      return { package: view(row), metadata, files: content?.files ?? [] };
    },
    import(params) { return serialize(() => importPackage(deps, params)); },
    enable(params) { return serialize(async () => {
      const rows = deps.repo.list(); const row = rowById(rows, params.packageId);
      if (row.lifecycleState !== "active" || !row.contentHash) throw new SkillRefusedError("invalid-package");
      const prospective = { ...row, enabled: true, configRevision: row.configRevision + 1 }; const nextRows = replaceRow(rows, prospective); const candidate = deps.catalog.prepare(nextRows);
      if (candidate.invalidated.includes(row.packageId)) throw new SkillRefusedError("invalid-package");
      const next = deps.repo.update({ packageId: row.packageId, expectedConfigRevision: params.expectedConfigRevision, enabled: true });
      publishCommitted(deps, candidate, replaceRow(rows, next)); return { package: view(next) };
    }); },
    disable(params) { return serialize(async () => {
      const rows = deps.repo.list(); const row = rowById(rows, params.packageId); const prospective = { ...row, enabled: false, configRevision: row.configRevision + 1 };
      const candidate = deps.catalog.prepare(replaceRow(rows, prospective));
      const next = deps.repo.update({ packageId: row.packageId, expectedConfigRevision: params.expectedConfigRevision, enabled: false });
      publishCommitted(deps, candidate, replaceRow(rows, next)); return { package: view(next) };
    }); },
    remove(params) { return serialize(async () => {
      const rows = deps.repo.list(); rowById(rows, params.packageId); const nextRows = rows.filter((row) => row.packageId !== params.packageId); const candidate = deps.catalog.prepare(nextRows);
      deps.repo.remove(params); publishCommitted(deps, candidate, nextRows);
      return { status: "removed", packageId: params.packageId };
    }); },
    reconcile() { return serialize(async () => reconcilePackages(deps)); },
  };
}

async function importPackage(deps: ServiceDeps, params: SkillImportParams): Promise<{ package: SkillPackageView }> {
  let replacement = replacementBase(deps, params); let files;
  try { files = await enumerateSource(params.source); }
  catch (error) { const reason = error instanceof SkillSourceError ? error.reason : "unsafe-package"; return rejectedImport({ deps, params, reason }); }
  let validated;
  try { validated = validateSkillFiles(files, { requireWrapperRoot: params.source.kind === "directory" }); }
  catch (error) { const reason = error instanceof SkillValidationError ? error.reason : "invalid-package"; return rejectedImport({ deps, params, reason, files }); }
  const rows = deps.repo.list();
  if (rows.some((row) => row.lifecycleState === "active" && row.skillName === validated.skillName && row.packageId !== params.replacePackageId)) throw new SkillRefusedError("duplicate-skill");
  if (params.replacePackageId) {
    replacement = rowById(rows, params.replacePackageId);
    if (replacement.configRevision !== params.expectedConfigRevision) throw new SkillConfigConflictError(replacement.configRevision);
    if (replacement.skillName !== validated.skillName) throw new SkillRefusedError("invalid-package", "replacement must keep the existing Skill name");
  }
  mkdirSync(deps.storeRoot, { recursive: true }); const packageId = params.replacePackageId ?? randomUUID(); const content = publishSkill(deps.storeRoot, packageId, validated);
  const write = activeWrite({ deps, params, packageId, validated }); const prospective = prospectiveRow(write, replacement); const nextRows = replacement ? replaceRow(rows, prospective) : [...rows, prospective];
  const candidate = deps.catalog.prepare(nextRows);
  if (candidate.invalidated.includes(packageId)) throw new SkillRefusedError("unsafe-package");
  const row = replacement ? deps.repo.update(replacementUpdate(write, packageId, params.expectedConfigRevision as number)) : deps.repo.insert({ ...write, packageId: content.packageId });
  publishCommitted(deps, candidate, replacement ? replaceRow(rows, row) : [...rows, row]);
  return { package: packageView(deps, row) };
}

type QuarantineFiles = Parameters<typeof quarantine>[2];
interface RejectedImport { deps: ServiceDeps; params: SkillImportParams; reason: "invalid-package" | "unsafe-package" | "source-too-large"; files?: QuarantineFiles; }
function rejectedImport(input: RejectedImport): { package: SkillPackageView } {
  const { deps, params, reason, files } = input; const packageId = randomUUID();
  if (files) { try { quarantine(deps.storeRoot, packageId, files); } catch { /* the inert durable refusal remains authoritative */ } }
  const row = deps.repo.insert({ packageId, skillName: null, description: null, ownerHostId: deps.ownerHostId, contentHash: null, lifecycleState: "rejected", enabled: false, sourceKind: params.source.kind, sourceLocator: sourceLocator(params), trust: "blocked", scanVersion: "skill-scan-v1", scanVerdict: "rejected", scanFindings: [], failureReason: reason });
  return { package: packageView(deps, row) };
}

function activeWrite(input: { deps: ServiceDeps; params: SkillImportParams; packageId: string; validated: ReturnType<typeof validateSkillFiles> }): SkillPackageWrite {
  const { deps, params, packageId, validated } = input;
  const sourceKind = params.source.kind; const review = validated.findings.length > 0;
  return { packageId, skillName: validated.skillName, description: validated.description, ownerHostId: deps.ownerHostId, contentHash: validated.hash, lifecycleState: "active", enabled: !review, sourceKind, sourceLocator: sourceLocator(params), trust: sourceKind === "zip" ? "external-archive" : "operator-local", scanVersion: "skill-scan-v1", scanVerdict: review ? "review" : "passed", scanFindings: validated.findings, failureReason: null };
}

function replacementUpdate(write: SkillPackageWrite, packageId: string, expectedConfigRevision: number) {
  return { packageId, expectedConfigRevision, enabled: write.enabled, lifecycleState: write.lifecycleState, contentHash: write.contentHash, skillName: write.skillName, description: write.description, sourceKind: write.sourceKind, sourceLocator: write.sourceLocator, trust: write.trust, scanVersion: write.scanVersion, scanVerdict: write.scanVerdict, scanFindings: write.scanFindings, failureReason: write.failureReason };
}

function replacementBase(deps: ServiceDeps, params: SkillImportParams): SkillPackageRow | null {
  if (!params.replacePackageId) return null;
  if (params.expectedConfigRevision === undefined) throw new SkillRefusedError("revision-conflict", "replacement requires expectedConfigRevision");
  const row = deps.repo.get(params.replacePackageId); if (!row) throw new SkillRefusedError("unknown-package");
  if (row.configRevision !== params.expectedConfigRevision) throw new SkillConfigConflictError(row.configRevision); return row;
}

function prospectiveRow(write: SkillPackageWrite, previous: SkillPackageRow | null): SkillPackageRow {
  return { ...write, packageId: write.packageId ?? randomUUID(), configRevision: previous ? previous.configRevision + 1 : 1, createdAt: previous?.createdAt ?? "1970-01-01T00:00:00.000Z", updatedAt: previous?.updatedAt ?? "1970-01-01T00:00:00.000Z" };
}
function publishCommitted(deps: ServiceDeps, candidate: SkillCatalogCandidate, rows: SkillPackageRow[]): void { deps.catalog.publish(candidate, rows); deps.catalog.collectGarbage(); }
function replaceRow(rows: SkillPackageRow[], next: SkillPackageRow): SkillPackageRow[] { return rows.map((row) => row.packageId === next.packageId ? next : row); }
function rowById(rows: SkillPackageRow[], packageId: string): SkillPackageRow { const row = rows.find((candidate) => candidate.packageId === packageId); if (!row) throw new SkillRefusedError("unknown-package"); return row; }

function reconcilePackages(deps: ServiceDeps): SkillReconcileResult {
  const rows = deps.repo.list(); const candidate = deps.catalog.prepare(rows); let currentRows = rows; let invalidated = 0;
  for (const id of candidate.invalidated) {
    const row = currentRows.find((item) => item.packageId === id); if (!row) continue;
    try { const next = deps.repo.update({ packageId: id, expectedConfigRevision: row.configRevision, enabled: false, lifecycleState: "rejected", failureReason: "published content verification failed", scanVerdict: "rejected" }); currentRows = replaceRow(currentRows, next); invalidated += 1; }
    catch (error) { if (!(error instanceof SkillConfigConflictError)) throw error; }
  }
  publishCommitted(deps, candidate, currentRows);
  return { checked: currentRows.length, invalidated, catalogGeneration: deps.catalog.currentGeneration() };
}

function packageView(deps: ServiceDeps, row: SkillPackageRow | null): SkillPackageView {
  if (!row) throw new SkillRefusedError("unknown-package");
  const runtimeState = row.lifecycleState !== "active" || !row.enabled ? row.lifecycleState === "active" ? "disabled" : "invalid" : deps.catalog.list().some((entry) => entry.row.packageId === row.packageId) ? "available" : "invalid";
  return { packageId: row.packageId, skillName: row.skillName, description: row.description, ownerHostId: row.ownerHostId, contentHash: row.contentHash, enabled: row.enabled, configRevision: row.configRevision, sourceKind: row.sourceKind, sourceLocator: row.sourceLocator, trust: row.trust, scanVersion: row.scanVersion, scanVerdict: row.scanVerdict, scanFindings: row.scanFindings, lifecycleState: row.lifecycleState, runtimeState, catalogGeneration: runtimeState === "available" ? deps.catalog.currentGeneration() : null, createdAt: row.createdAt, updatedAt: row.updatedAt, failureReason: row.failureReason };
}
function inspectMetadata(deps: ServiceDeps, row: SkillPackageRow): SkillStandardMetadata | null {
  if (!row.skillName || !row.contentHash) return null;
  const result = readPublishedFile({ storeRoot: deps.storeRoot, packageId: row.packageId, skillName: row.skillName, description: row.description ?? "", hash: row.contentHash }, "SKILL.md");
  if (!result) return null;
  try { return parseSkillMetadata(result.bytes.toString("utf8")); } catch { return null; }
}
function sourceLocator(params: SkillImportParams): string { if (params.source.kind === "directory") return "browser-directory"; const leaf = params.source.fileName.replaceAll("\\", "/").split("/").at(-1); return (stripControls(leaf ?? "").trim() || "archive.zip").slice(0, 256); }
function stripControls(value: string): string { let result = ""; for (const character of value) { const code = character.charCodeAt(0); if (code >= 32 && code !== 127) result += character; } return result; }
