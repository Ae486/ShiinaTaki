# Research: Provider JSON-Schema compatibility and conservative normalization

- Query: Which MCP JSON-Schema shapes accepted by DeepSeek/OpenAI-compatible providers fail Gemini FunctionDeclaration conversion, what can be normalized without guessing, and which offline fixtures should lock the contract?
- Scope: mixed (TakiAgent and Hermes source, installed dependency behavior, recorded runtime evidence, provider documentation, and public issue evidence)
- Date: 2026-08-07

## Findings

### Executive conclusion

The known Tavily failure is a dialect-conversion failure, not a tool execution or image-routing failure. TakiAgent sends every model through `@ai-sdk/openai-compatible`; the provider or proxy behind a Gemini endpoint converts the OpenAI-style function schema into Gemini's narrower `FunctionDeclaration.parameters` `Schema`. A JSON-Schema-valid property such as:

```json
{
  "anyOf": [
    { "type": "string", "enum": ["day", "week", "month", "year"] },
    { "type": "null" }
  ],
  "default": null
}
```

has no scalar `type` at the union wrapper. DeepSeek accepted and invoked the discovered Tavily tool, while the Gemini-backed slot rejected the whole request before generation because `parameters.time_range` did not specify the FunctionDeclaration schema type (`docs/HANDOFF.md:158-167`; `.trellis/tasks/archive/2026-08/08-03-settings-panel/closeout.md:62-68`). The same missing-type failure for MCP-produced `anyOf` is independently reported in Google ADK issue 3424.

The conservative cross-provider repair is intentionally narrow:

1. Only collapse an exact nullable union when it is a **property that is not listed in its parent object's `required` array**, the union contains exactly one non-null schema plus exactly one `{ "type": "null" }` branch, and `null` has no distinct tool meaning beyond omission.
2. Replace that wrapper with the recursively normalized non-null branch, keep the property optional, preserve its string enum and descriptions, and remove `default: null` because it no longer validates against the narrowed schema.
3. Treat required-nullable properties, null-only types, genuine multi-type unions, unresolved references, malformed `required`, and unsupported validation keywords as incompatible. Skip only that tool and log its original MCP identity plus a JSON-pointer-like failure path.
4. Do not copy Hermes's availability-first fallbacks wholesale. Replacing malformed schemas with `{type:"object",properties:{}}`, pruning required names, or dropping numeric enums/constraints may keep a request alive, but those operations guess or widen the contract and are not conservative normalization.

### Evidence classification

#### Verified local behavior

- TakiAgent uses `createOpenAICompatible` for both main and vision slots; it does not instantiate a Google-native provider or expose a provider-dialect capability flag (`packages/core/src/config/provider-factory.ts:10,21-38`). Therefore this batch should produce a provider-portable schema before tool construction rather than branch on a guessed provider name.
- MCP discovery currently calls `client.tools()` directly and receives already-built AI SDK dynamic tools (`packages/core/src/mcp/mcp-manager.ts:72-74`). The archived installed-package inspection proves that `client.tools()` is `listTools()` followed by `toolsFromDefinitions()`, and that the official seam exists between those calls (`.trellis/tasks/archive/2026-07/07-10-mcp-and-skills/research/ai-sdk-mcp-client.md:54`).
- `@ai-sdk/mcp@2.0.10` wraps each discovered `inputSchema` with `properties: inputSchema.properties ?? {}` and root `additionalProperties: false` when `toolsFromDefinitions()` builds the dynamic tool (`ai-sdk-mcp-client.md:18,54`). The implementation should normalize cloned definitions, filter incompatible definitions, and then call the official `toolsFromDefinitions()` method. It should not rebuild execution closures.
- Renaming only TakiAgent's ToolSet record key remains safe because AI SDK execution closes over the original MCP definition name (`ai-sdk-mcp-client.md:132`; `packages/core/src/mcp/mcp-manager.ts:89-97`). Schema filtering must preserve that original definition name.
- The recorded provider split is exact: DeepSeek submitted and called the tool; Gemini rejected before model generation. The recorded error attributes the rejection to `time_range`'s nullable union lacking a top-level FunctionDeclaration `type`; image input only selected the vision slot (`docs/HANDOFF.md:158-167`).

#### Verified reference implementation behavior

- Hermes's general sanitizer collapses `anyOf`/`oneOf` only when one non-null branch remains after removing a null branch, then sets `nullable: true` and carries selected annotations (`references/hermes-agent-main/tools/schema_sanitizer.py:166-227`).
- Hermes converts `type: [T, "null"]` to scalar `type: T` plus `nullable: true`; multiple non-null types become `anyOf` without dropping a branch (`schema_sanitizer.py:282-304`). This is useful evidence that array-valued `type` is hostile, but multi-type-to-`anyOf` does not solve the Gemini missing-wrapper-type problem.
- Hermes also prunes `required` entries not present in `properties`, replaces malformed schema strings, injects empty object properties, removes `default` beside `$ref`, and strips some top-level combinators (`schema_sanitizer.py:104-160,230-356`). These are explicitly broader than the conservative policy recommended here.
- Hermes's Gemini pass uses a key allow-list, recursively handles `properties`, `items`, and `anyOf`, drops non-string numeric/boolean enums, and filters invalid `required` names (`references/hermes-agent-main/agent/gemini_schema.py:10-117`). Its regression tests record two concrete Gemini failures: typed numeric enums are rejected because Gemini's legacy `Schema.enum` is a string array, and `required` names missing from the same node's `properties` reject the whole request (`references/hermes-agent-main/tests/agent/test_gemini_schema.py:31-54,109-174`).

#### Verified external behavior and contracts

- Google's function-calling guide says function declarations use only a selected subset of OpenAPI Schema and consistently shows a scalar `type` for the parameters object and every property. It documents string enums and `required` names: <https://ai.google.dev/gemini-api/docs/function-calling>.
- The Google Gen AI JavaScript `FunctionDeclaration` reference distinguishes legacy `parameters: Schema` from `parametersJsonSchema`. The latter accepts a JSON Schema object and is mutually exclusive with `parameters`: <https://googleapis.github.io/js-genai/release_docs/interfaces/types.FunctionDeclaration.html>. TakiAgent's OpenAI-compatible path does not expose this Google-native choice.
- Google ADK issue 3424 reproduces the same MCP failure: an `anyOf` property with no wrapper `type` is valid JSON Schema but is rejected with `functionDeclaration parameters.<property> schema didn't specify the schema type field`: <https://github.com/google/adk-python/issues/3424>. This is issue evidence, not a normative API guarantee.
- DeepSeek's tool-call API describes `function.parameters` as a JSON Schema object. Its strict beta subset documents object, string, number, integer, boolean, array, enum, `anyOf`, `$ref`, and `$def`: <https://api-docs.deepseek.com/guides/tool_calls/>. The local Tavily run used the ordinary OpenAI-compatible path, not proof that every documented strict-mode shape works in TakiAgent.
- AI SDK documents `listTools()` and `toolsFromDefinitions(definitions)` as public methods: <https://ai-sdk.dev/docs/reference/ai-sdk-core/create-mcp-client>. The source implementation shows that `tools()` is the composition of those methods and that execution retains the original definition name: <https://github.com/vercel/ai/blob/08cdf6ae/packages/mcp/src/tool/mcp-client.ts>.
- Tavily's checked-in MCP source currently declares `time_range` as a plain optional string enum, while the remote MCP definition observed by TakiAgent surfaced it as nullable. This means the regression fixture must pin the **observed remote definition**, not assume the repository snapshot equals the hosted server: <https://github.com/tavily-ai/tavily-mcp/blob/926ff5da/src/index.ts>.

### 1. Shapes that cross DeepSeek/OpenAI-compatible transport but commonly fail Gemini conversion

| Input shape | Why the OpenAI-compatible side may accept it | Gemini FunctionDeclaration risk | Conservative decision |
|---|---|---|---|
| Optional property `anyOf: [T, {type:"null"}]` with no wrapper `type` | Valid JSON Schema; DeepSeek accepted the real Tavily definition | Known pre-generation 400: wrapper has no scalar Schema type | Collapse only under the optional-property preconditions below |
| Optional property `oneOf: [T, {type:"null"}]` | Valid JSON Schema; branches are disjoint when one is exactly null | Legacy converters still see a wrapper without scalar type | Same narrow collapse is valid if branches are exactly `T` and null |
| `type: ["string", "null"]` | JSON Schema permits an array of types | Gemini legacy `Schema.type` is a single enum value, not an array | Treat like the exact nullable union only for an optional property |
| Genuine `anyOf`/`oneOf` with two or more non-null types | DeepSeek strict documents `anyOf`; non-strict OpenAI-compatible gateways often pass it | Conversion may omit a wrapper type or reject/lose branch semantics | Incompatible; do not select the first branch or invent `type` |
| Standalone `{type:"null"}` or required nullable property | Valid in modern JSON Schema | Legacy Gemini Schema has `nullable` but no NULL type | Incompatible in the provider-portable profile |
| Numeric/boolean typed enum with numeric/boolean enum members | Ordinary JSON Schema semantics are unambiguous | Gemini legacy Schema enum entries are strings; Hermes has a production regression for this | Incompatible; dropping or stringifying the enum is not semantics-preserving |
| `required` includes a missing/non-string property name | Some producers/gateways defer validation | Gemini rejects the entire request with "property is not defined" | Incompatible; do not prune and silently widen |
| `$schema`, `$id`, `$comment`, examples, other annotations | Usually ignored by JSON Schema consumers | Legacy Schema conversion may reject or ignore them | Annotation-only keys may be dropped; retain `description` and supported `title` |
| `$ref`/`$defs`, `allOf`, conditional keywords, pattern properties, tuple arrays | Valid, expressive JSON Schema and partly supported by some providers | Support differs by Gemini endpoint/conversion path | Incompatible unless a separately specified, tested dereferencer/transform proves equivalence |
| Bare schema string, missing structural type, object with malformed `properties`, array without usable `items` | A permissive gateway may defer or coerce | Strict converter cannot build a FunctionDeclaration Schema | Incompatible; do not replace with an arbitrary empty object |

The important distinction is endpoint dialect. Google's native `parametersJsonSchema` can accept broader JSON Schema than the legacy `parameters: Schema` object, but TakiAgent sends OpenAI-format tools through an OpenAI-compatible endpoint and does not control which Google field the upstream converter uses. The normalizer must target the observed legacy conversion failure rather than assuming native JSON-Schema support is reachable.

### 2. Conservative transformations versus incompatible input

#### Contract-preserving or safe narrowing under explicit preconditions

1. **Deep-copy before walking.** The original MCP definition is runtime evidence and is also needed for diagnostics. Hermes tests the same non-mutation property (`test_schema_sanitizer.py:237-245`).
2. **Normalize a singleton type array.** `{type:["string"]}` to `{type:"string"}` is equivalent.
3. **Collapse an optional nullable property.** This is safe only when all conditions hold:
   - the node is reached through `parent.properties[name]`;
   - `name` is absent from the parent's valid `required` set;
   - the union is `anyOf` or `oneOf` with exactly two schema objects;
   - one branch is exactly the null type (annotation-only siblings may be ignored);
   - exactly one non-null branch remains;
   - outer `default` is absent or null;
   - the tool contract treats explicit null the same as omission. For the observed Tavily `time_range`, both mean "no relative time filter".
4. **Preserve optionality by omission.** Do not add the property to `required`. Do not emit `nullable:true` in the common profile: the narrowed schema no longer advertises explicit null, and omission is the portable absent value.
5. **Drop `default:null` only as part of that exact collapse.** Keeping it would leave a default that does not validate against `type:string`. A non-null default that validates against the retained branch is preserved.
6. **Carry annotations deterministically.** Preserve the property's outer `description` and `title` because they describe the named argument. If the outer node lacks one, retain the branch annotation. Preserve a valid string enum from the non-null branch without rewriting its members.
7. **Recurse through well-formed containers.** Normalize each object property using the same node's `required` set; normalize `items`, then nested object properties. The permission to drop null does not propagate to array elements: array items cannot be omitted individually.
8. **Drop only non-semantic annotations that the target profile does not carry**, such as `$schema`, `$id`, `$comment`, and examples. This changes neither accepted values nor requiredness.

#### Must be incompatible rather than guessed

- A nullable property that is required. Collapsing null changes a valid required-null value into an invalid value; removing it from `required` changes requiredness. `nullable:true` is a provider-specific representation, not a common JSON-Schema contract.
- A nullable array item, map value, root schema, or any context where omission cannot represent null.
- A union with zero or more than one non-null branch, or a union containing constraints beyond the recognized null wrapper. Never take "the first useful branch".
- Multiple scalar values in `type`, except the exact optional `T + null` case. Converting them to `anyOf` preserves JSON Schema meaning but reintroduces the Gemini wrapper-type failure.
- Non-string enums for a Gemini-portable schema. Dropping an enum widens the model's allowed outputs; stringifying members changes their JSON types.
- A default that does not validate against the retained schema. Do not coerce it.
- `required` names absent from `properties`, duplicate/malformed required entries, or a non-array required value. Pruning hides a producer defect and widens the accepted object.
- A schema with `properties` but no object type, or `items` but no array type. Inferring the type is technically narrowing because JSON Schema structural keywords do not themselves exclude other JSON types.
- Unresolved or cyclic `$ref`; `$ref` with meaningful siblings; `$defs` without a specified dereference algorithm. Dropping a reference removes validation.
- `allOf`, genuine `anyOf`/`oneOf`, `not`, `if`/`then`/`else`, `dependentRequired`, `dependentSchemas`, `patternProperties`, `unevaluatedProperties`, `contains`, `prefixItems`, tuple-form `items`, or custom validation keywords. Dropping these widens or changes the contract.
- Free-form or schema-valued `additionalProperties` when the downstream dialect cannot represent it. Do not silently turn a dictionary into a closed empty object.
- Any malformed schema value, including bare strings in schema positions. Hermes's coercion is an availability fallback, not a conservative transform.

### 3. Recommended normalizer contract

The normalizer should operate on MCP **tool definitions**, not on already-built AI SDK tools:

```text
MCPClient.listTools()
  -> clone each definition
  -> normalize definition.inputSchema independently
  -> validate against portable profile
  -> keep compatible definitions; warn for each rejected definition
  -> MCPClient.toolsFromDefinitions({ ...definitions, tools: kept })
  -> existing namespace + execute wrapper
```

This is the approved definition-to-tool seam and preserves transport, `callTool`, `toModelOutput`, metadata, and raw execution names.

#### Suggested result type

```ts
type SchemaCompatibilityIssue = {
  code:
    | "INVALID_ROOT"
    | "MALFORMED_SCHEMA"
    | "REQUIRED_PROPERTY_MISSING"
    | "REQUIRED_NULLABLE_UNSUPPORTED"
    | "UNION_UNSUPPORTED"
    | "NULL_UNSUPPORTED"
    | "ENUM_UNSUPPORTED"
    | "REF_UNSUPPORTED"
    | "KEYWORD_UNSUPPORTED"
    | "DEFAULT_TYPE_MISMATCH";
  path: string;              // e.g. $.properties.time_range
  message: string;           // no schema body or secret-bearing metadata
  keyword?: string;
};

type NormalizeResult =
  | { ok: true; schema: JsonObject; changes: SchemaChange[] }
  | { ok: false; issue: SchemaCompatibilityIssue };
```

The manager warning should include `server`, original `toolName`, issue code, path, and keyword. It should not dump the whole remote schema because descriptions or metadata may be large or sensitive. One incompatible definition must not reject its server siblings.

#### Root object

- Require `inputSchema` to be an object schema with scalar `type:"object"`.
- Preserve or add `properties:{}` only when `type:"object"` is already explicit; adding an empty properties map is equivalent to omitting `properties`.
- Validate that `properties` is a record and `required` is a unique array of property-name strings contained in that record.
- Do not add or remove required entries.
- Preserve root descriptions/annotations allowed by the profile. Let the installed AI SDK continue adding root `additionalProperties:false`; do not duplicate tool construction logic.

#### Required versus optional nullable properties

| Context | Action |
|---|---|
| Optional property, exact `T-or-null`, null means absent | Collapse to `T`, keep omitted from `required`, remove `default:null` |
| Optional property, `T-or-null`, null has distinct business meaning | Incompatible |
| Required property, any nullable encoding | Incompatible |
| Array item or map value, any nullable encoding | Incompatible |
| Optional property, null-only | Incompatible |

Because the "null means absent" condition is semantic, an implementation cannot prove it from arbitrary JSON Schema alone. For the initial batch, constrain the rule to the known producer pattern: optional property + exact null union + absent/null default. Record the normalization as a warning/change event so later runtime evidence can identify a server whose handler distinguishes null from omission.

#### Enums, defaults, titles, and descriptions

- Preserve string enums byte-for-byte and in order; validate that every member is a string and, if `type` exists, that it is `string`.
- Reject numeric, boolean, mixed, object, or null enums in the portable profile. Do not drop or stringify them.
- Preserve `description` exactly. For a collapsed wrapper, outer description wins; otherwise inherit the branch description.
- Preserve `title` if present and string-valued. Drop `examples`/`example` only if the chosen portable profile does not carry them; they are annotations.
- Preserve a non-null `default` only when a small deterministic type check proves it matches the normalized scalar/container type and enum. Drop `default:null` only in the safe optional-null collapse. Reject all other mismatched defaults.
- Never move allowed enum members only into description. Description is guidance, not validation.

#### Nested objects and arrays

- Walk every `properties` value with that object's own `required` set. Do not reuse the root set.
- Require nested objects to have `type:"object"`; accept empty `properties:{}` but do not fabricate a schema for malformed properties.
- Require arrays to have exactly one schema object in `items`; recurse into it. Reject missing items and tuple arrays for the initial profile.
- An optional property whose non-null branch is an array or object may be collapsed safely; after collapse, recurse into its `items` or `properties`.
- A nullable element inside an array is incompatible because omission cannot stand in for an element-level null.
- Apply depth and node-count limits to remote schemas before recursion to prevent stack/memory abuse. The exact caps are not established by current project sources and must be selected and recorded during implementation rather than invented here.

#### Combinators, references, and unsupported keywords

- Recognize `anyOf`/`oneOf` only for the exact nullable wrapper described above. Reject all other combinators for the initial portable profile.
- Do not merge `allOf`, choose a union branch, or rewrite `oneOf` as `anyOf`.
- Do not strip `$ref`/`$defs`. Either implement a separately tested local-reference resolver with cycle/depth limits or reject the tool. Initial scope should reject.
- Maintain two explicit keyword sets:
  1. supported portable keys that are recursively validated;
  2. annotation-only keys safe to discard.
- Any unknown keyword defaults to incompatible, not ignored. Later additions require a fixture and a cited provider contract.
- Validation keywords that the portable profile cannot express are incompatible even if the MCP server will revalidate during execution. Relying on downstream rejection permits the model to generate calls outside the advertised contract and can burn tool-loop steps.

### 4. Offline fixture matrix

No offline test can prove that a remote provider has not changed. The fixtures below prove (a) deterministic normalization, (b) conformance to the documented/observed Gemini legacy Schema constraints and DeepSeek/OpenAI-compatible tool envelope, (c) unchanged AI SDK serialization, and (d) tool isolation/execution identity. A small opt-in live smoke test remains the only end-to-end provider proof.

#### Pure normalization fixtures

1. **Exact Tavily regression**: root object with required `query`; optional `time_range` encoded as `anyOf[string enum, null]` plus `default:null` and description. Expect `type:string`, same enum/description, no `anyOf`, no null, no default, and `time_range` absent from `required`.
2. **Alternate nullable encoding**: optional `type:["string","null"]` produces the same result.
3. **Ordinary schema identity**: root object containing required string, optional boolean, bounded number, string enum, array-of-string, and nested fixed object remains deeply equal except for documented annotation removals. Also assert the original input object is unchanged. Hermes already has an analogous unchanged-schema test (`test_schema_sanitizer.py:192-203`).
4. **Optional nullable object**: exact object-or-null property collapses to object; nested required is preserved and optional nullable leaf properties are normalized using the nested required set.
5. **Optional nullable array**: exact array-or-null property collapses to array and recursively preserves `items`.
6. **Nullable array element**: `items:anyOf[T,null]` is incompatible.
7. **Required nullable**: required property in both `anyOf[T,null]` and `type:[T,null]` forms is incompatible with path to that property.
8. **Genuine unions**: `string|integer`, `string|array|null`, nested object union, `allOf`, and conditional schema are incompatible; assert no branch is silently chosen.
9. **Enums**: string enum survives exactly; numeric, boolean, mixed, and null-containing enums are incompatible.
10. **Defaults**: matching scalar/container defaults survive; `default:null` disappears only for safe optional-null collapse; wrong-type and out-of-enum defaults are incompatible.
11. **Malformed required**: ghost property, duplicate, non-string member, and wrong container type are incompatible rather than pruned.
12. **Malformed structural schemas**: bare string schema, properties without object type, non-record properties, array without items, tuple items, and null-only type are incompatible.
13. **Unsupported keywords**: annotation-only keys are removed; `$ref`, `$defs`, `not`, pattern properties, and an unknown assertion keyword reject with stable code/path.
14. **Traversal bounds**: over-depth and over-node schemas reject deterministically once implementation selects sourced limits.

#### Dialect conformance fixtures

Create two local structural validators over the normalized JSON, with no provider calls:

- **Gemini legacy FunctionDeclaration profile**: every reachable schema node has one supported scalar `type`; object `required` names exist in the same node's `properties`; array nodes have one `items` schema; enums are string arrays; no null type, array-valued type, unresolved ref, or unrecognized combinator remains. Validate the exact expected FunctionDeclaration `parameters` JSON.
- **OpenAI-compatible/DeepSeek envelope profile**: root is an object schema under `tools[].function.parameters`; names/descriptions are unchanged; the schema remains valid JSON and retains all portable constraints. This is envelope compatibility, not a claim that DeepSeek strict beta is enabled.

Run both validators against every successful fixture. Run known-bad pre-normalization fixtures against the Gemini validator and assert the precise reason (for Tavily: missing scalar type at `$.properties.time_range`), then assert the normalized fixture passes both profiles.

#### Installed AI SDK serialization fixture

Use the installed versions (`@ai-sdk/mcp@2.0.10`, `@ai-sdk/openai-compatible@3.0.5`, `ai@7.0.17`) and no new dependency:

1. Supply an in-memory MCP transport whose `tools/list` returns three definitions: `ordinary`, `tavily_search`, and `required_nullable_bad`.
2. Call `listTools()`, normalize definitions independently, filter only the bad definition, then call `toolsFromDefinitions()`.
3. Assert both compatible tools are present and the bad tool alone produces one structured warning.
4. Invoke both surviving tools and assert `tools/call` receives their **original raw MCP names**, not TakiAgent's namespaced ToolSet keys.
5. Capture the request emitted by an OpenAI-compatible model using an injected fake `fetch` or local HTTP fixture. Assert `tools[].function.parameters` contains the normalized schemas exactly, including the Tavily enum and omission-based optionality.
6. Use the same captured request body as the DeepSeek/OpenAI-compatible fixture and convert only its `parameters` to the expected Gemini FunctionDeclaration fixture; run both structural validators.

This covers the full approved boundary without a live provider:

```text
tools/list definition
  -> per-tool normalization/validation
  -> toolsFromDefinitions
  -> OpenAI-compatible request serialization
  -> original-name tools/call
```

#### Same-server isolation fixture

Place good, bad, good definitions in one `tools/list` response. Assert:

- discovery succeeds;
- both good definitions remain callable;
- only the incompatible definition is absent;
- one warning identifies server, raw tool name, issue code, and path;
- no schema body is logged;
- client shutdown and the existing execute error wrapper still work.

This is the main regression against "one schema poisons the whole request," which is Gemini's observed failure mode and the task's isolation requirement.

### Implementation notes derived from the evidence

- Keep one normalizer before `toolsFromDefinitions()` rather than provider-specific mutations after `Tool` construction. TakiAgent's provider abstraction currently has no reliable provider kind.
- Return stable incompatibility reasons, not booleans, because a skipped remote tool otherwise becomes operationally invisible.
- Keep a change list for successful narrowing (`NULLABLE_OPTIONAL_COLLAPSED`, `ANNOTATION_DROPPED`). This makes normalization auditable without logging full schemas.
- Validate each normalized output again. A transformation bug must skip that tool rather than hand malformed schema to the provider.
- Preserve the source definition and original execution name. Normalize only `inputSchema` on a clone.
- Do not add reactive "retry after provider 400 with a looser schema" in this batch. Such recovery would resend a materially different tool contract and make provider behavior non-deterministic.

## Files Found

- `references/hermes-agent-main/tools/schema_sanitizer.py` - broad backend-compatibility walker; useful nullable-union algorithm and examples of deliberately non-conservative availability fallbacks.
- `references/hermes-agent-main/agent/gemini_schema.py` - Gemini legacy Schema allow-list, string-enum handling, and required/property filtering.
- `references/hermes-agent-main/tests/tools/test_schema_sanitizer.py` - fixtures for nullable types, unions, nested arrays/objects, non-mutation, refs, and unchanged schemas.
- `references/hermes-agent-main/tests/agent/test_gemini_schema.py` - production regressions for Gemini numeric enums and invalid required names.
- `.trellis/tasks/archive/2026-07/07-10-mcp-and-skills/research/ai-sdk-mcp-client.md` - installed AI SDK 2.0.10 discovery/conversion seam, fixture recipe, and execution-name closure evidence.
- `.trellis/tasks/archive/2026-08/08-03-settings-panel/research/rs-mcp-and-llm-config.md` - TakiAgent MCP boot, tool merge, and approval context.
- `.trellis/tasks/archive/2026-08/08-03-settings-panel/closeout.md` - recorded DeepSeek/Gemini Tavily split and approved task boundary.
- `docs/HANDOFF.md` - authoritative next-task statement, exact `time_range` failure, required acceptance fixtures, and definition-to-tool seam.
- `docs/deferred-decisions.md` - D60 record tying the compatibility task to the temporary Tavily MCP path.
- `packages/core/src/config/provider-factory.ts` - confirms both model slots use the generic OpenAI-compatible provider.
- `packages/core/src/mcp/mcp-manager.ts` - current `client.tools()` discovery and existing namespace/execute wrappers.
- `.trellis/spec/backend/tool-design.md` - local plain-enum portability rule and provider-strict optional/null caveats.
- `.trellis/spec/guides/source-grounding-guide.md` - requires installed-source and reference-source grounding before external claims.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` - applies to the definition -> schema -> AI SDK tool -> provider -> MCP execution boundary.

## External References

- Google AI for Developers, "Function calling with the Gemini API": <https://ai.google.dev/gemini-api/docs/function-calling> (accessed 2026-08-07).
- Google Gen AI JavaScript SDK, `FunctionDeclaration` reference: <https://googleapis.github.io/js-genai/release_docs/interfaces/types.FunctionDeclaration.html> (accessed 2026-08-07).
- Google ADK issue 3424, "MCP tools with `anyOf` schemas fail Gemini validation - missing top-level `type` field": <https://github.com/google/adk-python/issues/3424> (issue evidence, accessed 2026-08-07).
- DeepSeek API Docs, "Tool Calls": <https://api-docs.deepseek.com/guides/tool_calls/> (accessed 2026-08-07).
- DeepSeek API Docs, "Create Chat Completion": <https://api-docs.deepseek.com/api/create-chat-completion> (accessed 2026-08-07).
- AI SDK Core, `createMCPClient`: <https://ai-sdk.dev/docs/reference/ai-sdk-core/create-mcp-client> (accessed 2026-08-07; page identifies v7 as latest).
- Vercel AI source, MCP client at commit `08cdf6ae`: <https://github.com/vercel/ai/blob/08cdf6ae/packages/mcp/src/tool/mcp-client.ts> (accessed 2026-08-07).
- Tavily MCP source at commit `926ff5da`: <https://github.com/tavily-ai/tavily-mcp/blob/926ff5da/src/index.ts> (accessed 2026-08-07; differs from observed hosted nullable schema).

## Related Specs

- `.trellis/spec/backend/tool-design.md` - S1/S2 require plain string enums for provider portability; S7/C-2 records strict-mode optional/null incompatibility and logged exemptions.
- `.trellis/spec/backend/error-handling.md` - incompatible remote definitions must degrade per tool with actionable, structured diagnostics rather than crash discovery.
- `.trellis/spec/backend/agent-runtime.md` - tool-loop consequences and schema-constrained model correction.
- `.trellis/spec/guides/source-grounding-guide.md` - evidence hierarchy used in this research.
- `docs/deferred-decisions.md` D60 - this compatibility batch precedes native web-search work.

## Caveats / Not Found

- The raw `tools/list` JSON from the failing hosted Tavily Remote MCP call was not persisted in the repository. The exact nullable-union shape is grounded by the recorded TakiAgent failure and the currently exposed MCP tool signature (`time_range?: "day" | "week" | "month" | "year" | null`), but the implementation fixture should capture and commit a redacted real definition before coding if it can be obtained without secrets.
- Tavily's checked-in source currently shows a plain optional string enum, not the hosted nullable wrapper. Do not use that source snapshot as the sole regression fixture.
- Google's native `parametersJsonSchema` is broader than the legacy `parameters: Schema` dialect, and Gemini API versus Vertex AI behavior can differ. TakiAgent's upstream OpenAI-compatible converter is opaque, so the report targets the observed failure and a conservative common profile.
- DeepSeek strict beta and ordinary DeepSeek tool calls have different validation rules. The local success was ordinary OpenAI-compatible submission/call; it does not prove strict-mode compatibility.
- Hermes's comments and tests record production incidents, but several repairs intentionally trade schema fidelity for availability. They are precedents to evaluate, not a specification to port verbatim.
- Offline fixtures cannot prove current remote-provider acceptance. They prove deterministic normalization, documented dialect conformance, AI SDK serialization, and execution identity. Retain a small opt-in live smoke matrix for release qualification when provider credentials and approval are available.
- No project source establishes safe recursion depth, schema node count, property count, or description-length caps for untrusted MCP definitions. Implementation must source or explicitly decide these limits rather than inventing them silently.
