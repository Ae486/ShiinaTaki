/**
 * INPUT: one synchronous boundary, its actual SQLite owner and immutable native evidence rows
 * OUTPUT: phase-local verified evidence with isolated body views; every independent boundary starts fresh
 * POS: core/memory/transitions — avoids repeated corpus validation without caching current ownership or configuration
 */
import { MemoryTransitionNativeEvidenceSchema, type MemoryTransitionNativeEvidence } from "@taki/shared";
import { readTransitionDocument } from "../../db/memory-transition-document-repo.ts";
import type { Database, SqlRow } from "../../db/sqlite.ts";
import type { HindsightApplicationBundle } from "../hindsight/hindsight-application-bundle.ts";
import { verifyTransitionNativeEvidence } from "./transition-native-evidence.ts";

export function readFreshTransitionEvidence(db: Database, id: string) {
  const evidence = readTransitionDocument(db, "native_evidence", { id, schema: MemoryTransitionNativeEvidenceSchema });
  if (!evidence) invalid();
  return { evidence, bundle: verifyTransitionNativeEvidence(evidence) };
}

type Verified = ReturnType<typeof readFreshTransitionEvidence> & { row: SqlRow & { body: Uint8Array } };

/** Constructed only by the scoped runner. No cache survives its synchronous callback. */
class EvidenceContext {
  readonly #db: Database;
  readonly #byId = new Map<string, Verified>();
  #byObject = new WeakMap<MemoryTransitionNativeEvidence, Verified>();
  #active = true;
  constructor(db: Database) { this.#db = db; }

  assertOwner(db: Database): void { if (!this.#active || db !== this.#db) invalid(); }

  read(db: Database, id: string): MemoryTransitionNativeEvidence {
    this.assertOwner(db);
    const row = db.prepare("SELECT id,transition_id,slot,body FROM memory_transition_native_evidence WHERE id=:id").get({ id });
    if (!row || !(row.body instanceof Uint8Array)) invalid();
    const prior = this.#byId.get(id);
    if (prior) {
      // Even inside one boundary, a changed/deleted row must not reuse its old
      // validation. Compare the actual stored bytes and identity, not just ID.
      if (row.id !== prior.row.id || row.transition_id !== prior.row.transition_id || row.slot !== prior.row.slot
        || !Buffer.from(row.body).equals(prior.row.body)) invalid();
      return prior.evidence;
    }
    const loaded = readFreshTransitionEvidence(db, id);
    freezeJson(loaded.evidence);
    freezeJson(loaded.bundle.manifest); freezeJson(loaded.bundle.pages);
    for (const body of loaded.bundle.bodies.values()) { freezeJson(body.ref); freezeJson(body.content); }
    const entry = { ...loaded, row: { ...row, body: row.body } };
    this.#byId.set(id, entry); this.#byObject.set(entry.evidence, entry);
    return entry.evidence;
  }

  bundle(evidence: MemoryTransitionNativeEvidence): HindsightApplicationBundle {
    this.assertOwner(this.#db);
    const cached = this.#byObject.get(evidence);
    // A caller-created envelope, even with the same ID, is not our freshly
    // verified stored object. All unscoped callers retain full verification.
    if (!cached) invalid();
    this.read(this.#db, evidence.evidenceId);
    return { manifest: cached.bundle.manifest, pages: cached.bundle.pages,
      bodies: new Map([...cached.bundle.bodies].map(([id, body]) => [id, { ...body, bytes: Uint8Array.from(body.bytes) }])) };
  }

  close(): void { this.#active = false; this.#byId.clear(); this.#byObject = new WeakMap(); }
}

export type TransitionEvidenceContext = EvidenceContext;

export function withTransitionEvidenceContext<T>(db: Database, run: (context: TransitionEvidenceContext) => T,
  existing?: TransitionEvidenceContext): T {
  existing?.assertOwner(db);
  const context = existing ?? new EvidenceContext(db);
  try {
    const result = run(context);
    if (result !== null && (typeof result === "object" || typeof result === "function") && "then" in result) invalid();
    return result;
  } finally { if (!existing) context.close(); }
}

function freezeJson(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const item of Object.values(value)) freezeJson(item);
  Object.freeze(value);
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
