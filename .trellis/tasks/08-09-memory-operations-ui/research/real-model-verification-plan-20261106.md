# Research: Minimal real-model memory verification

- Query: Reuse the first-use harness for ordinary real-model retain/recall/recovery with bounded genuine conversation.
- Scope: mixed; current local code and root-provided live observations
- Date: 2026-11-06

## Findings

Use one task-only runner and existing Core/Native/PG/RPC helpers. No production change is needed to enable real models. Root reconciled journey17: all 20 scenarios passed, including re-entry/emergency/paired restore. Do not repeat that entire journey.

Root separately verified main text connectivity and an SDK tool roundtrip (one initial TLS failure; exact retry: one actual tool, two steps, 22.51s, 820 tokens). Requested model is deepseek-v4.1-flash; returned identity is deepseek-flash. Vision returned 503; text validation can proceed. These are root observations, not researcher retests.

### Proposed gate

1. Root's private fixture is ready: G:/taki-memory-real-input-jwav_sy8/conversation-fixture.json, eight matched user/assistant messages in two slices, with source IDs/order/timestamps/hashes. Read only this fixture; never boot main on the newer owner DB or copy it. Historical messages are quoted evidence, not action authorization.
2. Boot fresh owned G: data/credentials/PG and actual Native/Core. Reuse registered Local onboarding, existing-instance setup and activation. Keep the standard tool set; no Node/OS services are necessary.
3. Read only authorized t4 text-model fields into memory/env. Supply real main and utility models; explicitly record any harness-local utility reuse of main. Native default/retain/consolidation use its existing openai adapter with supplied endpoint/key/model. Independently record embedding/reranker provider/class/model/dimension: current defaults are real cached local models, not mock LLM outputs.
4. Submit ordinary live Chat turns containing the bounded genuine conversation evidence. Require actual retain, actual committed/source-associated memory, and observed Utility work. Ask a later explicit recall plus natural follow-up; require persisted recall tool DATA with ok=true, provider=hindsight, correct epoch/scope, partial=false and expected source-associated facts. Fluent text without the required tool/result fails.
5. Query Global-appropriate preference from a fresh Character for context-independent retrieval. Character-specific study recall may retain Timeline; its tool DATA still proves retrieval, but final-answer attribution remains limited. Do not alias Banks, relabel episodic data or delete/reset custody/history. Observe fresh query input rather than treating restart as context clearing.
6. Inject one bounded Native write interruption using the existing fault helper. Require durable pending, original-request recovery, one factual application, then Core reopen and successful recall with stable authority/no redispatch. Consolidation passes only when a real call and completed producer state are observed.

Target 4-6 Chat turns, roughly 8-16 main generations plus necessary utility/Native work; one heavy runner.
The owner's later 2026-11-06 instruction explicitly increases the slow-upstream test budget and requires
model versus memory timing. Plan for supported model request timeouts around 240 seconds, individual
Chat/operation observation up to 900 seconds and a 60-minute new-scenario admission window. Already admitted
work and bounded shutdown may finish later; this is not a hard total wall-clock limit. Record actual supported
configuration overrides; do not invent knobs or extend unrelated lease/quiescence semantics. Stop admitting
additional scenarios around 48 observed calls/100k reported tokens, settle already dispatched work and clean up.
Unknown usage/outcomes remain unknown; these admission limits do not turn an incomplete operation into success.

Record upstream request headers/first response and complete-stream wall time, grouped by main, utility and
Native operation, alongside the actual setup/retain/recall/settlement spans. Do not buffer or rewrite streams
for measurement. For overlapping calls, use the union of observed intervals within each stage; call counts or
summed durations cannot be subtracted from total time. Label the remainder as time outside observed upstream
spans, not pure memory CPU time. Unobserved work and incomplete streams remain explicit.

First live attempt `G:/taki-real-memory-OckQlQ/result.json` passed actual Local retain/recall, then failed
`setup.apply` with `HINDSIGHT_TIMEOUT`. The cause was the new task launcher's missing approved-host `NO_PROXY`:
Native httpx discovered the Windows proxy at `127.0.0.1:7890`, which the test socket guard correctly refused.
Those Native attempts never reached the model. All owned Core/Native/PG resources stopped normally; this
is a harness configuration failure, not Native extraction or memory latency evidence. Real-mode helpers now
supply only the configured model host and loopback bypasses. The rerun must preserve failed/unknown Pending
states and report Native returned model identities separately from unparsed Core stream metadata.

Export only identities, hashes, tool counts/results booleans, timings, bounded errors and genuine usage. Never export raw dialogue, keys or fake-provider success evidence.

### Ownership and references

One implementer owns a new real-model-memory.mjs and real-mode Native launcher under research/first-use-runtime/, plus optional real-mode parameters in smoke-core.mjs/smoke-native.mjs preserving controlled defaults. Root owns fixture, dispatch, and result reconciliation. No H:/hindsight edits.

- research/first-use-runtime/smoke-core.mjs:27-53,72-86,103-118,125-165 — socket guard, actual Core, env, teardown, authenticated RPC.
- research/first-use-runtime/smoke-native.mjs:109-143,158-185 — owned PG and current mock-LLM env.
- research/first-use-runtime/native-smoke.mjs:83-147,310-320,633-704 — operations/live Chat/pending/teardown; fake log assertions and raw copyEvidence must not be reused.
- research/first-use-runtime/native-fault.mjs:startNativeFault — transparent owned 503 injection.
- research/first-use-runtime/post-reentry-replay.mjs:162-200 — useful boundary timings; fake assertions/fixed generated source are unsuitable. paired-restore.mjs is already accepted.
- packages/core/src/config/provider-factory.ts:20-38; main.ts:438-473 — real SDK/model and complete ordinary tool composition.
- packages/core/src/agents/chat-agent.ts:285-298,463-477; conversation-writer.ts:17-21,47-51 — actual automatic recall and persisted tool/result evidence.
- packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:75-98 — primary ingestion/Utility/tidy/custody.
- H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:1481-1484,1559-1562 — operation-specific LLM inheritance; config.py:148-153,307-352,912-935 — model env and independent real local embedding/reranker defaults.
- .trellis/tasks/08-09-hindsight-initial-cutover/research/validation/real_hindsight_network.py:68-121,124 onward — reuse narrow HTTPS/resolved-IP guard and content-free usage observer; historical hardcoded model/root/config must be adapted.
- Specs: backend/memory-authority-validation.md:25-56,79-103,126-136; backend/e2e-harness.md:9-20; backend/hindsight-application-runtime.md:55-80,97-110. Read current implement.md and validation-recovery-plan-2026-11-06.md; newer owner real-model authorization governs this isolated gate.
- External/version reference: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling ; local requirements ai ^7.0.17 / openai-compatible ^3.0.5, Native 0.9.0. Record resolved installed versions. No web fetch occurred.

## Caveats / Not Found

Only this research file was written; no services, tests, models, secrets, owner-dialogue reads or Git operations ran here. Legacy .current-task is empty; parent supplied the authoritative task/output path.

Real Native structured-output compatibility, cached model inference and Utility triggering require actual observation. Never substitute controlled results on failure. This gate does not establish vision, full corpus quality, independent automatic recall unless observed, owner UI acceptance, original-data activation or full parent acceptance.
