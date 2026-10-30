# Reflect Completion Diagnosis

## Feedback loop and observed failure

The unchanged grounded and hidden-memory Reflect scenarios both reached the five-minute Core/native boundary in
`api-models-1`. Native HTTP logs show the corresponding timeout, while actual DeepSeek requests returned HTTP 200 with
tool-call responses. The owner independently confirmed provider-side usage. Successful model requests are established;
an end-to-end completed answer remains unproven. The complete first attempt and source fingerprint are preserved under
`attempt-api-models-1` in the private API root; all five owned service groups stopped and the Job ended without force.

## Ranked, falsifiable hypotheses

1. Repeated policy/native revalidation dominates: `before_model_input` rechecks all previously admitted candidates and
   may repeatedly deserialize the same immutable bodies. A pure admission probe on the same copied data will show high
   cost and query counts scaling with admitted candidates, without any model call.
2. Database acquisition or query waiting dominates: isolated connection/query timers will account for most elapsed
   time; a serial admission probe will differ materially from the real parallel tool path.
3. Native tool-loop/model work dominates: admission-only work will be short and the observed remote/model/tool duration
   will explain the elapsed gap. Measure complete tool steps rather than infer completion from token consumption.

First measure the existing production admission path against the copied PostgreSQL state at controlled candidate counts.
Keep inputs, eligibility checks, namespace and native payload verification intact. Record only timing/counts/hashes publicly.
Do not optimize or weaken policy/integrity checks before this measurement identifies the expensive operation.

## Measurements and bounded-work experiment

The pure PostgreSQL probe invoked the existing admission implementation without any model call. Filtering 25 candidates
took 0.248 s (179 SQL calls), and rechecking the 24 admitted records took 0.321 s (240 calls). Filtering 100 took 1.006 s
(673 calls), and rechecking 93 admitted records took 1.057 s (905 calls). This establishes the individual check cost;
it does not yet exclude cumulative repeated checks during multiple parallel tool calls.

Generation controls returned HTTP 200 in approximately 4.7 s with no admitted memories and no retrieval tool calls. They
prove the final-generation path, not grounded reflection. The second control deliberately failed the added requirement
for real admitted memory evidence. Both raw responses are preserved by their distinct profile identities.

The native engine scales configured maximum iterations by the request budget: `low` uses 0.5x, rounded down with a
minimum of one. Its final iteration disables tools and synthesizes text. Thus base values 1 and 2 both produce a
generation-only control at `low`; base 4 permits one real tool round followed by final synthesis. The next experiment
uses that existing configuration, keeps all policy checks and model routes intact, and records real stage timers.
This changes the work allowance rather than silently calling an ungrounded control a successful memory answer.

The base-4 experiment performed a real retrieval round and admitted 383 memories. It reached final synthesis but then
returned HTTP 500 after 109.311 s. The native error was `ProviderResponseError` for empty message content. All four final
DeepSeek attempts returned HTTP 200 with `finish_reason=length`; each reported 768 completion tokens and 768 reasoning
tokens, leaving no final text. They all used the same 768-token ceiling. The complete raw failure and timings are saved
as `api-reflect-profile-3-*`.

This identifies a separate completion-budget problem that extending elapsed time cannot solve. The next controlled
attempt keeps the same query, work allowance, models and policy checks, and raises only the final completion allowance
to 8,192 tokens (within the existing canonical Reflect tool's range). The tool description now clarifies that some
providers count internal reasoning against that allowance; it does not silently increase a caller's explicit budget.

The stage profile also measures repeated validation: 15 `before_model_input` invocations accumulated 87.271 inclusive
seconds; 36,226 SQL calls accumulated 79.793 seconds across concurrent operations. These inclusive measurements overlap
and must not be summed into a purported wall time. A single 383-memory recheck took roughly 7.6-7.8 s, while nested
tool-output admission rechecked the same set twice. Performance work remains separate from obtaining a completed answer.

## Completed grounded native response

The controlled `api-reflect-profile-4` attempt kept base 4, the `low` request budget, the same query/models and every
policy check, and raised only `max_tokens` to 8,192. It returned HTTP 200 in 62.477 s, admitted 349 memories, and produced
2,236 characters with nonempty `based_on.memories`. The final DeepSeek response ended with `finish_reason=stop` and
reported 2,731 completion tokens, including 1,403 reasoning tokens. No empty-content retry was needed. The private raw
response and stage evidence remain under this distinct attempt identity. The native supervisor then stopped all owned
services without forced termination and recorded an empty Job.

The native aggregate reports 22,176 input and 1,459 output tokens; its output aggregate omits reasoning, while the raw
upstream usage includes it. Do not treat the native aggregate as billing usage or add it to upstream totals. Provider
usage, native aggregate usage, and stage durations are separate observations with different accounting boundaries.

This proves a completed, grounded native Reflect response. The final normal Taki consumer still needs to prove default
10-second REST configuration, foreground completion waiting, ordinary and exact-target Recall, automatic injection,
and the hidden-memory Reflect constraint together. That run uses the same process-only base-4 native configuration and
explicit 8,192-token Reflect requests. No native production default or explicit caller token budget is overwritten.
