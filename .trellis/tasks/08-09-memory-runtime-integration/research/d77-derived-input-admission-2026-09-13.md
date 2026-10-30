# Derived Input Admission Correction

## Owner disposition (2026-09-13)

The owner prioritizes already scoped work and B7 before this broader capability. D81 now tracks the derived-visibility
gap in [the follow-up inventory](memory-capability-followups-2026-09-13.md). The blanket observation experiment was
removed in the owner-approved [bounded B6 closeout](b6-closeout-validation-2026-09-13.md). Ordinary own-policy admission
is restored and verified; complete derived propagation is still unimplemented. Preserve the real failure and do not
restart general proof-system work before B7.

At the owner's pause, Core focused/related regressions passed 178 tests in seven files, Core types and root lint passed;
native isolated regressions passed eight tests, with Ruff/format/ty passing. The new full real-model acceptance and final
implementation review were not performed. The sections below preserve the original diagnosis and experiment plan.

## Observed failure and preserved evidence

`api-defaults-2` passed the four default-budget Recall cases, automatic recall and grounded Reflect. The latter completed
in 56.080 seconds with 2,320 characters and 83 cited memory IDs. Hidden-content Reflect also completed, in 20.347 seconds,
but its answer disclosed the synthetic hidden checklist nickname. The full attempt remains a failure; its 31-file copy
and hash manifest are retained under the private `attempt-api-defaults-2` directory. All owned services stopped normally,
the Job had no remaining members, and original storage plus the previous acceptance target remained byte-unchanged.

A read-only SQLite comparison identified exactly two records containing the nickname: the original hidden `world` unit,
which was absent from Reflect evidence, and a separate valid `observation` with `retrieved` visibility, which was present
in that evidence. The nickname appeared in the observation's text, not its context. Removing source citations cannot
remove information that has already been summarized into a derived body.

The model-free real PostgreSQL probe `api-hidden-lineage-red-3` confirmed one persisted source ID on that observation,
pointing to the hidden original. The production admission implementation rejected the original and admitted the derived
observation. The unchanged protected-input assertion failed as expected. Its first two diagnostic launches stopped before
this assertion because the legacy B5 raw table did not contain these later D77 records; the probe now loads actual sealed
D77 native bodies and lets the production guard verify them. These diagnostic failures remain recorded separately.

## Existing contract and root cause

[The accepted implementation contract](d77-implementation-contract-2026-09-11.md), section 4, already requires complete
verifiable admission or explicit version-bound evidence for opaque derived bodies; otherwise the input is withheld while
its data remains stored. A model's declared `based_on` subset does not prove the complete input it consumed.

The native `_binding` gate checked each observation's own policy/binding and existence of original Source artifacts. It
did not establish complete input admission. The old synthetic fixture even declared visible and hidden source IDs but
expected the observation to enter the model because its artificial text omitted the hidden canary.

Persisted `source_memory_ids` are useful support references, but ordinary consolidation receives more facts/observations
than the model's declared subset. No current D77 admission consumer connects complete consumed inputs to the exact output
version and every dependency's current policy. D78 proof capture is tied to cutover runs, views, plans and receipts; it is
not silently reinterpreted as that missing general runtime proof.

Core's healthy Recall projection, verified replica search, captured rows and policy-curator targets share a direct-unit
policy gate. They can expose the same derived text to Taki consumers. This is separate from the ordinary native Recall
contract, which retrieves native candidates before Core hydration and does not promise a Taki policy filter before the
native reranker. Guarded Reflect has the stronger native pre-rerank/model-input guarantee.

## Bounded correction and ownership

- Native worker: reject unproven observation bodies at the unified guarded Reflect binding gate. Prove exclusion from
  candidate reranking, tool output, cache/model submissions and response using a body canary, including empty or
  visible-only declared source subsets. Positive raw facts remain admitted. Keep the wire schema and unguarded native/D78
  behavior unchanged.
- Core worker: add an explicit consumer-only refusal at `hindsightPolicyAdmission`, covering healthy projection, replica
  fallback, captured prompt rows and curator inputs. Retain neutral policy, original artifacts and native maintenance.
  Ordinary direct facts remain eligible before detailed assessment; mood/intention exceptions cannot waive this check.
- Root: retain the failed attempt, rerun the exact PostgreSQL assertion after repair, add a real hidden Recall assertion,
  and repeat the integrated model acceptance with a fresh identity. Native and Core source/check evidence must match the
  final run. No original-data activation, B7 action or publication is included.

This temporarily withholds observations from these protected consumers because the current protocol cannot prove their
complete input admission. Classification, manual policy visibility or declared source IDs alone do not supply that proof.
Adding a complete version-bound admission producer/consumer is separate future work; it must preserve current-policy
revalidation and must not rely on text matching, deletion or model promises.

## Verification status

The real failure and model-free RED are established. Focused experiment checks are recorded above; final review and real
acceptance remain unperformed. Broader correction is deferred as D81. The earlier 3,005-test Core gate is evidence for
the preceding lifetime correction, not a final gate for the later containment experiment.
