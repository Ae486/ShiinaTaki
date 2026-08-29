# Harness prompt-prefix cache stability design

## 1. Problem and invariant

DeepSeek stores KV cache upstream, but TakiAgent owns whether adjacent requests present an identical token prefix. The
current extension instructions include a fresh Run UUID before replayed history, so every conversational Run invalidates
the expensive history suffix after roughly 6,912 stable tokens.

The governing invariant is:

> Execution identity and authority remain Core-owned. Model-visible request content includes only semantic guidance.
> When semantic state is unchanged, provider/model/config, system instructions, and tool definitions have one canonical
> representation independent of fresh Run/Attempt identity or registration order.

This task does not make the provider cache authoritative and does not add a local KV cache.

## 2. Request-prefix contract

### 2.1 Stable header

For one provider/model/config epoch and unchanged Character/capability state, these surfaces must be deterministic:

1. provider/model and omitted/default call settings;
2. base or canonical memory procedure prompt;
3. same-day date line;
4. Character persona, stable memory blocks and pinned memory;
5. Skill list and avatar vocabulary;
6. Host/extension semantic guidance without execution ids;
7. tool names, descriptions, JSON schemas and a locale-independent canonical order.

A new Run object, closure, telemetry correlation, or approval handle must not alter this header.

### 2.2 Deterministic replay

The ConversationStore projection remains deterministic for unchanged rows and budgets. Compaction, window movement,
summary substitution, actual memory/capability changes, provider/model changes, day rollover and image-budget changes are
legitimate explained prefix boundaries.

### 2.3 Volatile tail

Current time, perception, costume notice and current image bytes remain attached to the newest user message. They stay
in-flight and non-persistent. Therefore cross-Turn requests share the prefix through the prior plain user text, not
through its old `<turn-context>` suffix. Within one ToolLoopAgent Run, tool continuation requests remain strict
append-extensions.

## 3. Production changes

### 3.1 Stable extension instructions

`ExtensionRegistry.renderContext()` will stop rendering `snapshot.runId`. It will retain the eligible-extension count and
the existing immutable-snapshot, permission and Host-selection guidance. Snapshot schemas and tool results remain
unchanged, so discover/describe results may still return the internal Run id after the reusable prefix as structured tool
output.

The private registry Map, captured Skill/MCP/Host closures, generation leases, Governance, Approval, Run Event and Effect
identity remain untouched. Prompt prose never selected authority before this change and will not do so afterward.

### 3.2 Canonical model-facing tool order

ChatAgent will assemble the ToolSet once per attempt and pass an explicit `toolOrder` containing all tool keys sorted by
UTF-16 code-unit comparison (`a < b ? -1 : a > b ? 1 : 0`). This affects only provider-facing definition order. Tool
lookup and execution continue to use the original ToolSet and sealed closures.

Canonical order is included because AI SDK v7 otherwise serializes `Object.entries(tools)` insertion order and DSH
explicitly closes this cache-stability class. No recursive JSON canonicalizer is introduced; schema property order and
Host arrays remain unchanged unless a focused test later proves real drift.

## 4. Test seams

### 4.1 Extension authority regression

Two registries with identical semantic inputs and different Run ids must render byte-identical context with neither UUID
present. Their snapshots and discover/describe outputs retain distinct Run ids, and each `extension_call` reaches only
its own captured spy.

### 4.2 Chat request-shape regression

A focused MockLanguageModelV4 test captures the provider-facing system message and tool definitions for two otherwise
identical Runs with different execution ids. It asserts identical system/tool header values and canonical tool order.
The same fixture proves:

- within-Run tool continuation is a strict append-extension;
- across conversational Turns, stable replay reaches the prior plain user text while the old volatile tail is absent;
- Run/Attempt ids remain available only to the correct internal execution binding.

Tests compare structured values or bounded digests and never snapshot prompt contents into logs.

### 4.3 Real DeepSeek acceptance

A key-gated E2E uses an isolated temporary Core data directory, real configured provider, stable capability set and
55k-80k deterministic history below the compaction/window boundary. It performs a harmless tool Turn followed
immediately by an ordinary new Turn, reads normalized `run_usage`, and reports only counts:

```text
request_kind | provider | model | input | no_cache | cache_read | ratio | output | quality
```

Acceptance for the comparable first request of the follow-up Turn:

- `cache_read / input >= 0.50`;
- improvement over the measured 10.1% baseline is at least 30 percentage points;
- every request after the cold first request reports a positive cache read unless an explicit semantic boundary is
  recorded;
- normal reply and one structured/names-only tool path complete correctly.

Run the isolated probe twice with fresh local data directories and adjacent requests. Never persist prompts, raw tool
payloads, provider bodies, credentials, or raw internal ids in the evidence artifact.

## 5. Compatibility and risk

- Removing a UUID from instructions is additive from the authority perspective but changes model input as intended.
- Canonical tool ordering may cause a one-time cache reset and may slightly change model tool-choice priors; subsequent
  requests become deterministic. Existing tool behavior and schemas do not change.
- Provider cache eviction and cache domains remain external; the live threshold is therefore measured on immediate,
  comparable requests and repeated twice.
- Legacy memory can still vary relative-age/intention text before history. It is not active in the reproduced canonical
  environment and remains outside this minimal task; a later measured regression can address it separately.
- Host `lastSeenAt` and source ordering are latent invalidators. They are not tied to the fixed 6,912-token breakpoint;
  changing Host projection without evidence would expand semantic risk.

## 6. Rollout and rollback

No migration or protocol version is needed. Deploying the Core code activates the stable prompt immediately. Rollback is
the ordinary code revert: restore the prior extension sentence and remove explicit `toolOrder`. Durable Run/Event,
Conversation, Memory and extension snapshot data remain compatible in both directions.

## 7. Reference decision

Copy DSH's stable request-header, canonical tool order, explained-rewrite and per-request real-cache verification
patterns. Adapt the assertion to TakiAgent's deliberate non-persistent turn tail, names-only tool replay and in-flight
images rather than copying DSH's strict cross-Turn full-message append contract.
