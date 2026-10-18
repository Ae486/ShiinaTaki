import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { HindsightTemplateSnapshot } from "@taki/shared";
import { withoutApplicationHash } from "../hindsight-application-integrity.ts";
import { templateHash } from "./template-integrity.ts";
import { previewTemplateOverlay } from "./template-preview.ts";
import { deriveTemplateOwnership, verifyTemplateApplication } from "./template-receipt.ts";
import { fixtureCommit, fixtureProof, signFixtureSnapshot, templateFixture } from "./template-test-fixtures.ts";

type ResourceKind = "model" | "directive";
type ObjectProof = NonNullable<HindsightTemplateSnapshot["models"][number]["proof"]>;

function nextPreview(kind?: ResourceKind) {
  const f = templateFixture(); const first = fixtureCommit(f.preview);
  const template = { ...f.template, revision: "review-next-template",
    models: f.template.models.map((model) => kind === "model" ? { ...model, source_query: "Changed definition" } : model),
    directives: f.template.directives.map((directive) => kind === "directive" ? { ...directive, content: "Changed definition" } : directive) };
  return previewTemplateOverlay({ ...f.input, template, snapshot: first.snapshot, requestId: randomUUID(),
    previous: { projection: f.preview.projection, ownership: deriveTemplateOwnership(null, f.preview.request) } });
}

function replaceProof(snapshot: HindsightTemplateSnapshot, kind: ResourceKind, proof: ObjectProof): HindsightTemplateSnapshot {
  return signFixtureSnapshot({ ...snapshot,
    models: snapshot.models.map((model) => kind === "model" ? { ...model, proof } : model),
    directives: snapshot.directives.map((directive) => kind === "directive" ? { ...directive, proof } : directive) });
}

describe("all-resource current evidence independently of refresh children", () => {
  for (const kind of ["model", "directive"] as const) {
    it.each(["regressed", "same-revision-different-payload"] as const)(`refuses %s ${kind} evidence without a refresh child`, (failure) => {
      const preview = nextPreview(); const commit = fixtureCommit(preview);
      const resource = kind === "model" ? commit.snapshot.models[0]! : commit.snapshot.directives[0]!;
      const proof = { ...resource.proof!, ...(failure === "regressed" ? { revision: resource.proof!.revision - 1 }
        : { payload_hash: "e".repeat(64) }) };
      expect(preview.request.refresh).toEqual([]);
      expect(() => verifyTemplateApplication({ preview, receipt: commit.receipt,
        snapshot: replaceProof(commit.snapshot, kind, proof) })).toThrow("HINDSIGHT_RESPONSE_INVALID");
    });

    it(`requires an advanced ${kind} revision after a definition change`, () => {
      const preview = nextPreview(kind); const commit = fixtureCommit(preview);
      const before = kind === "model" ? preview.request.expected_snapshot.models[0]! : preview.request.expected_snapshot.directives[0]!;
      const after = kind === "model" ? commit.snapshot.models[0]! : commit.snapshot.directives[0]!;
      expect(after.definition).not.toEqual(before.definition);
      expect(() => verifyTemplateApplication({ preview, receipt: commit.receipt,
        snapshot: replaceProof(commit.snapshot, kind, { ...after.proof!, revision: before.proof!.revision }) })).toThrow("HINDSIGHT_RESPONSE_INVALID");
    });

    it(`accepts unchanged and legitimately advanced ${kind} evidence without rewriting the original receipt`, () => {
      const preview = nextPreview(); const commit = fixtureCommit(preview); const receipt = structuredClone(commit.receipt);
      const resource = kind === "model" ? commit.snapshot.models[0]! : commit.snapshot.directives[0]!;
      expect(() => verifyTemplateApplication({ preview, ...commit })).not.toThrow();
      const refreshed = replaceProof(commit.snapshot, kind, fixtureProof(resource.definition, resource.proof!.revision + 1));
      expect(() => verifyTemplateApplication({ preview, receipt: commit.receipt, snapshot: refreshed })).not.toThrow();
      expect(commit.receipt).toEqual(receipt);
    });
  }

  it.each([false, true])("requires exact logical-journal movement for changed=%s", (changed) => {
    const preview = nextPreview(changed ? "model" : undefined); const commit = fixtureCommit(preview);
    const body = { ...withoutApplicationHash(commit.receipt, "receipt_hash"),
      journal_after: commit.receipt.journal_before + (changed ? 0 : 1) };
    const receipt = { ...commit.receipt, journal_after: body.journal_after, receipt_hash: templateHash("receipt", body) };
    expect(() => verifyTemplateApplication({ preview, receipt, snapshot: commit.snapshot })).toThrow("HINDSIGHT_RESPONSE_INVALID");
  });
});
