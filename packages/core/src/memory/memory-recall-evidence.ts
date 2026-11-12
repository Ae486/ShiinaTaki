/**
 * INPUT: actual recalled Canonical records and provider-owned synchronous evidence readers
 * OUTPUT: retained source/unit/policy currentness predicates for selected initiative reads
 * POS: core/memory — in-process evidence only; no provider dispatch, authority promotion or model-visible IDs
 */
import type { CanonicalMemoryRecord } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import { readCanonicalRecord, readCanonicalSource } from "../db/canonical-memory-maintenance-records.ts";
import { sameApplicationValue } from "./hindsight/hindsight-application-integrity.ts";
import { recordEligible } from "./memory-recall-selection.ts";

export type CaptureRecallEvidence = (record: CanonicalMemoryRecord, query: string, requestId?: string) => (() => boolean) | undefined;
export type ObserveRecallEvidence = (record: CanonicalMemoryRecord, query: string, requestId: string) => void;

/** Provider selection owns the baseline, before its next await; consumers cannot adopt a newer Source. */
export function createRecallEvidenceRegistry(capture: CaptureRecallEvidence) {
  const requests = new Map<string, { query: string; records: Map<string, { record: CanonicalMemoryRecord; current?: () => boolean }> }>();
  const observe: ObserveRecallEvidence = (record, query, requestId) => {
    let entry = requests.get(requestId);
    if (!entry) {
      entry = { query, records: new Map() }; requests.set(requestId, entry);
      if (requests.size > 32) requests.delete(requests.keys().next().value as string);
    }
    const key = JSON.stringify([record.unit.bankId, record.unit.memoryId, record.unit.revision]);
    if (entry.query !== query || entry.records.has(key) || entry.records.size >= 100) return;
    try { entry.records.set(key, { record, current: capture(record, query) }); }
    catch { entry.records.set(key, { record }); }
  };
  const read: CaptureRecallEvidence = (record, query, requestId) => {
    const entry = requestId ? requests.get(requestId) : undefined;
    const saved = entry?.records.get(JSON.stringify([record.unit.bankId, record.unit.memoryId, record.unit.revision]));
    return entry?.query === query && saved && sameApplicationValue(saved.record, record) ? saved.current : undefined;
  };
  return { observe, read };
}

export function createLocalRecallEvidence(db: Database): CaptureRecallEvidence {
  return (record, query) => {
    const identity = { epochId: record.unit.authorityEpochId, bankId: record.unit.bankId, memoryId: record.unit.memoryId };
    const documentId = record.unit.documentId;
    // Opaque derived bodies without a direct Source cannot supply this stronger initiative contract.
    if (!documentId || record.unit.sourceMemoryIds.length > 0) return;
    const source = readCanonicalSource(db, { ...identity, documentId });
    if (!source) return;
    const current = () => {
      const actual = readCanonicalRecord(db, identity);
      return actual !== undefined && sameApplicationValue(actual, record)
        && recordEligible(actual, { query, now: Date.now() })
        && sameApplicationValue(source, readCanonicalSource(db, { ...identity, documentId }));
    };
    return current() ? current : undefined;
  };
}
