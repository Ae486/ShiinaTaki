/**
 * INPUT: operator-reviewed native result references and a Core-owned configuration path
 * OUTPUT: bounded revision-checked catalog with persist-before-publish updates
 * POS: core/co-watching — configuration only, outside Workspace; not consent or an execution ledger
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CoWatchingAnalysisSchema, CoWatchingCatalogSchema, CoWatchingRegisterSchema, CoWatchingAnalysisRequestSchema,
  type CoWatchingAnalysis, type CoWatchingRegister, type CoWatchingAnalysisRequest } from "@taki/shared";

export interface CoWatchingCatalog {
  list(): CoWatchingAnalysis[];
  get(id: string): CoWatchingAnalysis | undefined;
  register(input: CoWatchingRegister): CoWatchingAnalysis;
  remove(id: string, expectedRevision: number): void;
  request(id: string): CoWatchingAnalysisRequest | undefined;
  reserve(input: Pick<CoWatchingAnalysisRequest, "serverId" | "media"> & { replaceRequestId?: string }): { request: CoWatchingAnalysisRequest; created: boolean };
  bind(id: string, identity: NonNullable<CoWatchingAnalysisRequest["identity"]>): CoWatchingAnalysisRequest;
}

export function createCoWatchingCatalog(path: string): CoWatchingCatalog {
  let { entries, requests } = loadCatalog(path);
  const persist = (next: CoWatchingAnalysis[], nextRequests = requests) => {
    const content = JSON.stringify(CoWatchingCatalogSchema.parse({ schemaVersion: "co-watching.catalog.v1", entries: next, requests: nextRequests }), null, 2);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, content + "\n", { encoding: "utf8", flag: "wx" }); renameSync(temporary, path); }
    finally { rmSync(temporary, { force: true }); }
    entries = next; requests = nextRequests;
  };
  return {
    list: () => structuredClone(entries),
    get: (id) => { const value = entries.find((entry) => entry.analysisId === id); return value && structuredClone(value); },
    request: (id) => { const value = requests.find((entry) => entry.analysisId === id); return value && structuredClone(value); },
    reserve(input) {
      const { replaceRequestId, ...reference } = input;
      const existing = [...requests].reverse().find((entry) => entry.serverId === input.serverId && JSON.stringify(entry.media) === JSON.stringify(input.media));
      if (replaceRequestId && existing?.requestId !== replaceRequestId) throw new Error("CO_WATCHING_CATALOG_CONFLICT");
      if (existing && !replaceRequestId) return { request: structuredClone(existing), created: false };
      const request = CoWatchingAnalysisRequestSchema.parse({ ...reference, analysisId: randomUUID(), requestId: randomUUID(), identity: null });
      persist(entries, [...requests, request]);
      return { request: structuredClone(request), created: true };
    },
    bind(id, identity) {
      const previous = requests.find((entry) => entry.analysisId === id);
      if (!previous || (previous.identity && JSON.stringify(previous.identity) !== JSON.stringify(identity))) throw new Error("CO_WATCHING_ANALYSIS_MISMATCH");
      const request = CoWatchingAnalysisRequestSchema.parse({ ...previous, identity });
      persist(entries, requests.map((entry) => entry.analysisId === id ? request : entry));
      return structuredClone(request);
    },
    register(candidate) {
      const { expectedRevision, ...input } = CoWatchingRegisterSchema.parse(candidate);
      const previous = entries.find((entry) => entry.analysisId === input.analysisId);
      if (expectedRevision !== (previous?.revision ?? 0)) throw new Error("CO_WATCHING_CATALOG_CONFLICT");
      const next = CoWatchingAnalysisSchema.parse({ ...input, revision: (previous?.revision ?? 0) + 1 });
      if (previous && JSON.stringify({ ...next, revision: previous.revision }) === JSON.stringify(previous)) return structuredClone(previous);
      persist([...entries.filter((entry) => entry.analysisId !== next.analysisId), next]);
      return structuredClone(next);
    },
    remove(id, expectedRevision) {
      if (entries.find((entry) => entry.analysisId === id)?.revision !== expectedRevision) throw new Error("CO_WATCHING_CATALOG_CONFLICT");
      persist(entries.filter((entry) => entry.analysisId !== id));
    },
  };
}

function loadCatalog(path: string) {
  if (!existsSync(path)) return CoWatchingCatalogSchema.parse({ schemaVersion: "co-watching.catalog.v1", entries: [] });
  if (statSync(path).size > 512 * 1024) throw new Error("CO_WATCHING_CATALOG_INVALID");
  let value;
  try { value = CoWatchingCatalogSchema.parse(JSON.parse(readFileSync(path, "utf8"))); }
  catch { throw new Error("CO_WATCHING_CATALOG_INVALID"); }
  const { entries, requests } = value;
  if (new Set(entries.map((entry) => entry.analysisId)).size !== entries.length
    || new Set(requests.map((entry) => entry.analysisId)).size !== requests.length
    || new Set(requests.map((entry) => entry.requestId)).size !== requests.length) throw new Error("CO_WATCHING_CATALOG_INVALID");
  return value;
}
