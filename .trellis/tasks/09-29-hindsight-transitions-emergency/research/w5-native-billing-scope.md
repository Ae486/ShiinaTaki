# W5 scoped native billing-refusal repair

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Parent reviewed and approved this concrete producer extension within the existing W5 task after the real run.
Native cwd: `H:/hindsight`; branch: `main`. The complete W5 implementer owns this repair and focused verification.

## Observed failure

The isolated real maintenance run made 209 model submissions: 9 HTTP 200 and 200 HTTP 402 with the sanitized message
`Insufficient Balance`. No final proof or Core COMMIT exists. All owned processes were stopped and original file
hashes preserved. Source review found that OpenAI-compatible APIStatusError handling fast-fails 401/403 but retries
402; generic consolidation failure then recursively subdivides batches, causing more requests with the same refusal.

## Approved production scope

Paths are under `hindsight-api-slim/hindsight_api/engine/`:

- `llm_interface.py`: add a narrow `ProviderBillingError` carrying no raw response or private prompt content.
- `providers/openai_compatible_llm.py`: both `call` and `call_with_tools` classify factual HTTP 402 into that exception
  immediately. Existing 401/403 behavior and retryable 429/5xx behavior remain intact.
- `consolidation/consolidator.py`: propagate that exact exception before the generic consolidation exception path,
  preventing retry/subdivision and creation of a fabricated reusable failed plan for a provider billing refusal.

No general retry redesign, OpenAPI/dependency change or transition proof/history relaxation is authorized by this
extension. The existing transition-maintenance failure path must retain incomplete state and actual committed
actions/steps. Capture pre-edit source hashes, record W5 ownership and keep earlier manifests immutable.

## Required evidence

- Offline transport tests: each 402 entrypoint sends once with no retry sleep; 429/500 followed by success still retries.
- Consolidator test: billing refusal propagates after one call without a synthetic failed plan or subdivision.
- Owned PostgreSQL test: commit a real first step, encounter the billing refusal, verify incomplete state and preserved
  actions/requirements, then take over and resume the same finite plan without repeating the completed effect.
- Scoped native format/lint/type checks using existing instructions; do not reformat generated or unrelated files.

Real model calls remain paused pending restoration of the existing external account. The persisted count is 209 of
240, with only 31 submissions remaining; first return alone needs at least 83 more. This repair does not authorize
raising that cap, changing credentials/models or retrying the real workload before the parent resolves readiness
and a revised finite execution bound. Independent W5 review must include the native repair and recovery evidence.
