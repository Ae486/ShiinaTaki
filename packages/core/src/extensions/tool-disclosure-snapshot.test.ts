import { describe, expect, it } from "vitest";
import { createExtensionRegistry, type ExtensionCandidate } from "./extension-registry.ts";
import { createToolDisclosureSnapshot } from "./tool-disclosure-snapshot.ts";

const CORE = "11111111-1111-4111-8111-111111111111";
const REMOTE = "22222222-2222-4222-8222-222222222222";
const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function skill(name: string, options: { owner?: string; mode?: "skill-load" | "skill-resource"; available?: boolean; subject?: string } = {}): ExtensionCandidate {
  return {
    identity: {
      kind: "skill", ownerHostId: options.owner ?? CORE, subjectId: options.subject ?? `skill.${name}`,
      subjectRevision: `revision.${name}`, connectionGeneration: 1, catalogGeneration: 1,
    },
    displayName: name,
    summary: "Skill instructions",
    callMode: options.mode ?? "skill-load",
    available: options.available ?? true,
    call: () => ({ ok: true }),
    isCurrent: () => true,
  };
}

describe("tool disclosure snapshot", () => {
  it("records only unique available Core Skill-load identities", () => {
    const registry = createExtensionRegistry({
      runId: RUN, primaryHostId: CORE, hosts: [],
      candidates: [
        skill("known"), skill("support", { mode: "skill-resource" }), skill("foreign", { owner: REMOTE }),
        skill("disabled", { available: false }), skill("duplicate", { subject: "skill.a" }),
        skill("duplicate", { subject: "skill.b" }),
      ],
    });
    const metadata = createToolDisclosureSnapshot(registry, {}, CORE);
    const known = registry.snapshot.entries.find((entry) => entry.displayName === "known")!;

    expect(metadata).toEqual({
      deferredToolNames: [], describedTools: {},
      skills: { known: { extensionId: known.identity.extensionId, contentRevision: "revision.known" } },
    });
    expect(Object.isFrozen(metadata.skills.known)).toBe(true);
  });

  it("does not disclose a descriptor whose exact direct tool is absent", () => {
    const registry = createExtensionRegistry({
      runId: RUN, primaryHostId: CORE, hosts: [],
      candidates: [{
        ...skill("mcp"), identity: { ...skill("mcp").identity, kind: "mcp-tool" },
        callMode: "mcp-tool", modelToolName: "server_missing",
      }],
    });
    expect(registry.describe({ extensionId: registry.snapshot.entries[0]!.identity.extensionId }).toolName)
      .toBe("server_missing");
    expect(createToolDisclosureSnapshot(registry, {}, CORE).describedTools).toEqual({});
  });
});
