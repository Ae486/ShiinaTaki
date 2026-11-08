/**
 * INPUT: one synchronous validation boundary and its SQLite owner
 * OUTPUT: byte-verified immutable evidence, isolated body views and owner-scoped synchronous admission time
 * POS: core/memory/transitions — evidence expires with the callback; no mutable ownership/configuration or publication verdict is retained
 */
import { MemoryTransitionNativeEvidenceSchema, MemorySurvivingBankEvidenceSchema,
  type MemoryTransitionNativeEvidence, type MemorySurvivingBankEvidence } from "@taki/shared";
import { readTransitionDocument } from "../../db/memory-transition-document-repo.ts";
import type { Database, SqlRow } from "../../db/sqlite.ts";
import type { HindsightApplicationBundle } from "../hindsight/hindsight-application-bundle.ts";
import { verifyTransitionNativeEvidence } from "./transition-native-evidence.ts";
import { assertEvidenceBytes, freezeEvidenceJson, transitionProjectionKey, type VerifiedEvidenceArtifact } from "./transition-evidence-artifacts.ts";
import type { projectTransitionLocalBank, projectSurvivingLocalBank } from "./transition-local-projection.ts";
import { verifySurvivingBankEvidence } from "./transition-surviving-evidence.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";

export function readFreshTransitionEvidence(db: Database, id: string) {
  const evidence = readTransitionDocument(db, "native_evidence", { id, schema: MemoryTransitionNativeEvidenceSchema });
  if (!evidence) invalid();
  return { evidence, bundle: verifyTransitionNativeEvidence(evidence) };
}

type Verified = VerifiedEvidenceArtifact;
type SurvivingInput = Omit<Parameters<typeof projectSurvivingLocalBank>[0], "verification">;
type SurvivingVerified = ReturnType<typeof loadSurviving>;

/** Constructed only by synchronous scoped runners; all retained artifacts expire with the callback. */
class EvidenceContext {
  readonly #db: Database;
  readonly #byId = new Map<string, Verified>();
  readonly #projections = new Map<string, { key: string; value: ReturnType<typeof projectTransitionLocalBank> }>();
  #byObject = new WeakMap<MemoryTransitionNativeEvidence, Verified>();
  readonly #surviving = new Map<string, SurvivingVerified>();
  readonly #survivingProjections = new Map<string, { key: string; value: ReturnType<typeof projectSurvivingLocalBank> }>();
  #survivingObjects = new WeakMap<MemorySurvivingBankEvidence, SurvivingVerified>();
  #active = true;
  readonly #admissionStartedAt: string | undefined;
  constructor(db: Database, admissionStartedAt?: string) {
    this.#db = db; this.#admissionStartedAt = admissionStartedAt;
  }

  assertOwner(db: Database): void { if (!this.#active || db !== this.#db) invalid(); }
  /** Only the operation owner's synchronous admission supplies this time; it is never a lease or execution clock. */
  get admissionStartedAt(): string | undefined { this.assertOwner(this.#db); return this.#admissionStartedAt; }

  read(db: Database, id: string): MemoryTransitionNativeEvidence {
    this.assertOwner(db);
    const row = db.prepare("SELECT id,transition_id,slot,body FROM memory_transition_native_evidence WHERE id=:id").get({ id });
    if (!row || !(row.body instanceof Uint8Array)) invalid();
    const prior = this.#byId.get(id);
    if (prior) {
      // Even inside one boundary, a changed/deleted row must not reuse its old
      // validation. Compare the actual stored bytes and identity, not just ID.
      assertEvidenceBytes({ ...row, body: row.body }, prior.row);
      return prior.evidence;
    }
    const actual = { ...row, body: row.body };
    const entry = loadVerified(db, id, actual);
    this.#byId.set(id, entry); this.#byObject.set(entry.evidence, entry);
    return entry.evidence;
  }

  projectBank(input: Omit<Parameters<typeof projectTransitionLocalBank>[0], "verification">,
    compute: () => ReturnType<typeof projectTransitionLocalBank>): ReturnType<typeof projectTransitionLocalBank> {
    this.assertOwner(this.#db);
    for (const evidence of [input.evidence, input.nativeBaseline?.evidence]) {
      if (!evidence) continue;
      if (!this.#byObject.has(evidence)) invalid();
      this.read(this.#db, evidence.evidenceId);
    }
    // An independent boundary shares only pure artifacts, never a candidate/SQL/authority verdict.
    // Keep one complete semantic variant per Bank and discard it with this synchronous context.
    const slot = input.scope.localBankId; const key = transitionProjectionKey(input);
    const prior = this.#projections.get(slot);
    if (prior?.key === key) return prior.value;
    const value = compute(); freezeEvidenceJson(value);
    this.#projections.set(slot, { key, value });
    return value;
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

  readSurviving(db: Database, id: string): MemorySurvivingBankEvidence {
    this.assertOwner(db);
    const row = db.prepare("SELECT id,transition_id,slot,body FROM memory_transition_surviving_evidence WHERE id=:id").get({ id });
    if (!row || !(row.body instanceof Uint8Array)) invalid();
    const prior = this.#surviving.get(id);
    if (prior) { assertEvidenceBytes({ ...row, body: row.body }, prior.row); return prior.evidence; }
    const entry = loadSurviving(db, id, { ...row, body: row.body });
    this.#surviving.set(id, entry); this.#survivingObjects.set(entry.evidence, entry);
    return entry.evidence;
  }

  surviving(evidence: MemorySurvivingBankEvidence) {
    this.assertOwner(this.#db); const entry = this.#survivingObjects.get(evidence);
    if (!entry) invalid(); this.readSurviving(this.#db, evidence.evidenceId);
    const { context } = entry;
    // The private closure stays immutable; callers receive isolated Maps and byte arrays, as in native bundle().
    const reader = { artifact: context.reader.artifact, body: (ref: Parameters<typeof context.reader.body>[0]) => {
      const body = context.reader.body(ref); return { ...body, bytes: Uint8Array.from(body.bytes) };
    } };
    return { ...context, artifacts: new Map(context.artifacts), reader };
  }

  projectSurvivingBank(input: SurvivingInput, compute: () => ReturnType<typeof projectSurvivingLocalBank>) {
    this.assertOwner(this.#db);
    if (!this.#survivingObjects.has(input.evidence)) invalid();
    this.readSurviving(this.#db, input.evidence.evidenceId);
    if (input.nativeBaseline) {
      if (!this.#byObject.has(input.nativeBaseline.evidence)) invalid();
      this.read(this.#db, input.nativeBaseline.evidence.evidenceId);
    }
    const slot = input.scope.localBankId; const key = survivingProjectionKey(input);
    const prior = this.#survivingProjections.get(slot);
    if (prior?.key === key) return prior.value;
    const value = compute(); freezeEvidenceJson(value);
    this.#survivingProjections.set(slot, { key, value }); return value;
  }

  close(): void {
    this.#active = false; this.#byId.clear(); this.#byObject = new WeakMap(); this.#projections.clear();
    this.#surviving.clear(); this.#survivingObjects = new WeakMap(); this.#survivingProjections.clear();
  }
}

export type TransitionEvidenceContext = EvidenceContext;

/** One owner submission captures entry once; another submission, observer or executor cannot reuse that validity. */
export function withTransitionAdmissionContext<T>(input: { db: Database; startedAt: string }, run: (context: TransitionEvidenceContext) => T): T {
  const context = new EvidenceContext(input.db, input.startedAt);
  try { return withTransitionEvidenceContext(input.db, run, context); }
  finally { context.close(); }
}

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

function loadVerified(db: Database, id: string, row: SqlRow & { body: Uint8Array }): Verified {
  const loaded = readFreshTransitionEvidence(db, id);
  freezeEvidenceJson(loaded.evidence);
  freezeEvidenceJson(loaded.bundle.manifest); freezeEvidenceJson(loaded.bundle.pages);
  for (const body of loaded.bundle.bodies.values()) { freezeEvidenceJson(body.ref); freezeEvidenceJson(body.content); }
  return { ...loaded, row };
}
function loadSurviving(db: Database, id: string, row: SqlRow & { body: Uint8Array }) {
  const evidence = readTransitionDocument(db, "surviving_evidence", { id, schema: MemorySurvivingBankEvidenceSchema });
  if (!evidence) invalid();
  const context = verifySurvivingBankEvidence(evidence); freezeEvidenceJson(evidence);
  freezeEvidenceJson(context.heads);
  for (const artifact of context.artifacts.values()) freezeEvidenceJson(artifact);
  for (const entry of evidence.bodies) {
    const body = context.reader.body(entry.ref); freezeEvidenceJson(body.ref); freezeEvidenceJson(body.content);
  }
  return { evidence, context, row };
}
function survivingProjectionKey(input: SurvivingInput): string {
  const { evidence, nativeBaseline, survivingPolicies, ...rest } = input;
  // Maps stringify as {}. Include every policy's committed source/history and Canonical content explicitly;
  // mappings/ancestry/time/scope and future semantic fields remain in rest, not an incomplete hand-picked key.
  const identity = { ...rest, evidence: evidence.evidenceId,
    nativeBaseline: nativeBaseline ? { ...nativeBaseline, evidence: nativeBaseline.evidence.evidenceId } : nativeBaseline,
    survivingPolicies: survivingPolicies === undefined ? undefined : [...survivingPolicies].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) };
  const entries = Object.entries(identity).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => [key, value === undefined ? ["undefined"] : ["value", value]]);
  return transitionLocalHash(["taki-transition-surviving-bank.v1", entries]);
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
