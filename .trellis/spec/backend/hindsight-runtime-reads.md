# Hindsight Native Runtime Reads

## 1. Scope / Trigger

Use this contract when changing the authenticated native recall/reflect transport in `core/memory/hindsight/`.
These methods target the admitted Hindsight 0.9.0 API and return native wire data. They do not install a MemoryProvider,
resolve Taki policy, hydrate Canonical records, synchronize a replica or change authority.

## 2. Signatures

`createHindsightClient` includes optional `HindsightRuntimeClient` methods for compatibility with existing setup clients:

```ts
recallNative(input: {
  bankId: string;
  request: HindsightNativeRecallRequest;
  context: HindsightCallContext;
}): Promise<HindsightNativeRecallResponse>;

reflectNative(input: {
  bankId: string;
  request: HindsightNativeReflectRequest;
  context: HindsightCallContext;
}): Promise<HindsightNativeReflectResponse>;
```

The paths are `POST /v1/default/banks/{bankId}/memories/recall` and
`POST /v1/default/banks/{bankId}/reflect`. The Bank is validated and encoded as one path component; `.` and `..` are refused.
`HindsightCallContext` carries required `timeoutMs` and optional `signal`/`attemptId`.

## 3. Contracts

- Route through the existing `HindsightRequestInput<T>` requester. Reuse just-in-time secret resolution, authentication,
  total transport deadline, abort propagation, redirect refusal, response-byte cap and bounded errors. Add no client retry.
- Keep native field names and server defaults. Omitted and explicit null/empty values remain distinct. Recall supports
  query/types/budget/max_tokens/query_timestamp, preference/trace, tag filters, include options and min_scores. Reflect
  supports context, structured response schema, evidence/tool-call includes, fact types and mental-model/directive controls.
- Validate the actual API schema. Keep the already adopted Shared query/budget/token domains and existing Bank path
  validation. Other native string/JSON fields follow native types and refinements, without Canonical or snapshot field
  quotas. Those later domains are not a raw-read admission policy.
- Do not use the response-byte limit as a request-byte limit; they are independent contracts. A large schema-valid request
  is serialized intact, while the response remains under the existing 512 KiB cap.
- Preserve native typed JSON, nested null/empty/scalar values and own keys such as `__proto__` and `constructor` with
  quota-free structural/finite-number/cycle validation at this raw-wire boundary. Snapshot-specific container/key/string
  limits must not reject native filters, response schemas, metadata or corresponding outputs. Do not convert metadata into
  a string map or invent a depth limit. Existing G1/D78/snapshot codecs keep their own independent contracts unchanged.
- Raw recall hits do not contain the complete revision/lifecycle/provenance/policy needed by a Canonical record. Return
  their actual fields; later hydration must use exact verified native state and real Taki policy. Never manufacture them.
- Reflection remains native. Preserve actual evidence and usage; missing usage stays absent rather than becoming zero.
- Keep existing setup, template, G1 and D78 methods, commands and hashes intact. HTTP 400/422 on the two new read paths must
  not tell the user to repair a Bank Template; the bounded existing `HINDSIGHT_RESPONSE_INVALID` classification applies.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Invalid Bank or request fields | Refuse before transport with a bounded error; no raw payload in diagnostics |
| Missing key | `HINDSIGHT_SECRET_UNAVAILABLE`; do not send an unauthenticated request |
| Caller cancelled / deadline elapsed | Preserve existing cancellation/timeout classification and abort propagation |
| Response malformed, incompatible or oversized | Refuse through the existing response boundary; no partial fabricated result |
| Read endpoint responds 400/422 | `HINDSIGHT_RESPONSE_INVALID`; no provider body, credential or Template repair instruction |
| Existing template endpoint responds 400/422 | Preserve its existing Template error behavior, including a Bank named `reflect` |
| Metadata has supported special own keys or deep typed values | Preserve them without prototype assignment or JSON-looking-string conversion |
| Native fields needed for Canonical hydration are missing | Keep the result native; do not synthesize authoritative records |

## 5. Good / Base / Bad Cases

- Good: send an encoded Bank's actual native recall request and preserve its null metadata, evidence and real scores.
- Base: native empty results remain an empty native result; absent usage stays absent and does not claim measured zero cost.
- Bad: returning a fake Canonical revision/policy, rejecting a large valid request using a response-only limit, or logging
  a failed provider response body as the diagnostic.

## 6. Tests Required

- Injected transport: exact encoded paths, POST/body options, omission/null/empty semantics and authorization headers.
- Actual native response fixtures: recall/reflect evidence, scores, optional usage, typed JSON and special own keys.
- Invalid schema, unknown fields, mutually exclusive filters, malformed/oversized responses and valid large requests.
- Paired native request/response boundaries: empty/long tags and IDs, 257+ tag-group members/branches, 257-property output
  schemas and results, long legal property names, long context/text and valid long ISO fractions. Shared acyclic subtrees
  remain valid; cycles, accessors and non-JSON data are rejected.
- Missing secret, authentication rejection, timeout, abort, redirect refusal and closed error-body handling.
- Narrow 400/422 path classification plus unchanged existing template/G1/D78 client behavior.
- Scoped lint, Core typecheck, direct Node strip-only import and an isolated real Core boot after startup imports change.
  These offline checks do not establish live Hindsight health or MemoryProvider readiness.

## 7. Wrong vs Correct

Wrong: label a partial native hit with invented local defaults.

```ts
return { memoryId: hit.id, revision: 1, visibility: "retrieved", importance: 5 };
```

Correct: preserve the wire response at this layer and leave exact hydration to its own authority-bound component.

```ts
return requester({ path, init, context, schema: HindsightNativeRecallResponseSchema });
```
