# Skill and MCP tool disclosure

## 1. Scope / Trigger

Apply when changing which registered definitions reach a ChatAgent model step. Registration, Governance, Execution
Host selection, MCP connections and immutable Run bindings stay with existing owners. This is a generic Agent
facility; Co-Watching is one consumer. Standard Skills contain instructions/resources, not executable registration
manifests. `allowed-tools` never grants authority.

## 2. Signatures

```ts
type SkillToolBundle = { readonly skillName: string; readonly tools: ToolSet };
// Trusted product hook, not a model tool. Optional fields use the existing TimelineEntry and TurnContext types.
ChatAgentDeps.skillTools?: (input: { characterId: string; userEntry?: TimelineEntry; turn?: TurnContext }) => readonly SkillToolBundle[];

type ToolDisclosureSnapshot = {
  readonly deferredToolNames: readonly string[];
  readonly describedTools: Readonly<Record<string, string>>; // captured extensionId -> existing tool key
  readonly skills: Readonly<Record<string, { readonly extensionId: string; readonly contentRevision: string }>>;
};

// ExtensionDescribeResult adds optional toolName to its existing Shared result fields.
extension_describe({ extensionId }) -> { entry?, toolName?, ...existingFields };
prepareStep: ({ steps }) => ({ activeTools: disclosure.activeTools(steps) });
```

`toolName` uses the existing MCP key alphabet and maximum length (256). Only an available, current, admitted MCP
binding with an actual direct tool returns it. It is neither a display label nor an execution permission.

## 3. Contracts

- Capture and deep-freeze disclosure metadata with the existing Extension Run snapshot. Keep original MCP closures
  in execution context for governed Core work; hiding a schema never removes/reconnects its client.
- Register a trusted product bundle only when its Skill exists in the captured Core Host catalog. Match successful
  full loads to the captured extension identity and content revision. Ambiguous duplicate names are ineligible.
- Bind model-facing `load_skill({ name })` to the captured `extension_call` Skill closure. Reuse its catalog
  generation/currentness and Governance checks once. A compatibility loader cannot read a newer same-name package
  behind an old Run. A missing captured entry/bridge yields a bounded failed load.
- Each generation starts with ordinary tools and discovery/loaders. Successful full Skill loading reveals its small
  bundle on the next step; exact MCP describe reveals one direct tool. Derive from completed SDK steps only, never
  persisted history or a shared mutable active set. New turns/retries/continuations have independent initial subsets.
- Initial extension context must explain this loading contract before any Skill body is read. Instructions hidden
  inside the Skill cannot teach the model how to discover its absent tools; prior historical instructions do not activate them.
- Preserve canonical history, completed results and Effect identities. `prepareStep` changes only `activeTools`,
  never messages for disclosure. Primary capability guidance follows the same active subset without expanding it.
  D70's same-loop message reduction remains deferred.
- Model projection is independent of activation: raw Skill revisions and extension identity/toolName remain in
  completed SDK results. Skill text may omit its revision in the model view; directory views omit generation
  bookkeeping but preserve selectors, availability and overflow. The sealed extension bridge reuses the exact
  captured Skill's projector. Unknown MCP payloads retain their complete existing JSON view: blindly applying the
  direct SDK content projector would lose unique structuredContent or isError. The direct MCP adapter is unchanged;
  the indirect bridge's existing JSON-only image/resource presentation is not a new multimodal rendering path.
- SDK validation uses the active subset: a hidden call in the same response as its loader fails even if loading
  finishes first. Disclosure cannot bypass Governance, retired generations, cancellation or initiative restrictions.
- Product composition chooses non-primary eligibility; the generic hook needs no fake user message. Co-Watching
  control retains its actual primary-turn/operator/Run/Attempt boundary.
- Initial request, compaction admission and detached next-request measurement use initial visible schemas. Actual
  provider-step telemetry remains authoritative for tools disclosed later in that generation.
- The existing directory budget defaults to 128 entries. Overflow MCP tools stay hidden and cannot be described in
  that Run, while their raw internal closures remain intact. No silent budget increase, eager fallback, catalog
  recapture or claim of unlimited/paginated discovery.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Initial step or historical-only Skill load | No dedicated/MCP schemas in outgoing tool definitions |
| Successful full captured Skill load | Only its bundle appears on the next step |
| Failed, resource-only, incomplete or mismatched-revision load | No activation |
| Replaced same-name Skill under an old captured generation | Captured guard refuses; no fresh-loader fallback |
| Exact current MCP describe | Reveal original captured key and closure |
| Unknown, stale, unavailable or overflow descriptor | No direct disclosure or alternate routing |
| Hidden call in the loader's response | SDK rejects execution; a later disclosed call may execute |
| Governance denies a disclosed tool | Normal governed denial; no underlying side effect |
| New generation / other Run | Independent initial subset with readable original history |

## 5. Good / Base / Bad Cases

- Good: load `taki-co-watching`, then call `manage_co_watching(list_analyses)` to read existing registered references
  without accepting a session, submitting native work or reading full video analysis.
- Base: ordinary conversation uses normal tools without installed integration schemas consuming tool-definition space.
- Bad: moving documentation into SKILL.md while still sending every schema on each request.

## 6. Tests Required

- Real ToolLoopAgent coverage for initial omission, separate bundles, next-step activation/reset, captured full loads,
  stale replacement, denied execution, same-step rejection and permitted non-primary work.
- Inspect serialized provider request bodies as well as model mocks. Transport fixtures prove SDK schema filtering;
  distinguish this evidence from a real paid-model invocation.
- Extension tests cover deep immutability, source mutation, duplicates/foreign Skills, stale/unavailable identities,
  optional Shared `toolName` validation and overflow retaining internal closures.
- Inventory tests assert registered-reference scope, empty versus failed reads, offline availability and no submission,
  reconciliation, preparation or acceptance side effects. Listing does not verify upstream completion/availability.
  Real Home checks record the actual chat ACK, tool results and native request counts.

## 7. Wrong vs Correct

```ts
// Wrong: uses historical transcript content to activate the present registry.
if (history.includes("load_skill")) return allTools;

// Correct: existing SDK selects governed definitions from this generation's completed steps.
prepareStep: ({ steps }) => ({ activeTools: disclosure.activeTools(steps) });
```

References: `docs/research/SKILL-TOOL-DISCLOSURE-REFERENCES-2026-10-17.md`. Installed `ai@7.0.17` has
`prepareStep`/`activeTools` but no exported `toolSearch`; native provider deferred-loading APIs are not required.
