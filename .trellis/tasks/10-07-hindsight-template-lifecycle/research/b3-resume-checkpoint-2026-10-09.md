# B3 resumption contract checkpoint

Read-only source reconciliation by root while the independent B2 Core check runs. This does not start B3
implementation or accept B2. `b3-dispatch-plan.md` and `b3-backup-design-proposal.md` retain the approved design.

## Reconfirmed source and boundary

- Native `engine/taki_compatibility.py` still advertises the exact
  `taki-memory-hindsight-0.9.0-template-lifecycle-v1` build and optional `template_lifecycle` 1.0.0.
  B3 will use the proposed exact `taki-memory-hindsight-0.9.0-template-backup-v1` build and separate optional
  `template_backup` 1.0.0 producer. Keep old build allowlists and all mandatory transition contracts intact.
- Shared `hindsight-backup-schema.ts` and Native `admin/taki_backup.py` remain strict v1 request/proof producers.
  The common Core `hindsight-backup-pair.ts` still checks ordinary Bank/cursor/receipt membership, not complete
  template inventory/equality. This is the planned B3 gap; do not claim B2 closes it.
- Use strict separate v1/v2 schemas and explicit branches at every real consumer. Existing v1 proof bodies have
  no version discriminator, and the current Core identity uses `Pick<...>`; preserve variant information when
  introducing v2 so a projection cannot silently discard template evidence. The store's current `.shape`
  derivation must also use an explicit versioned base instead of a permissive optional-field schema.
- The actual Core read methods are `memory.templates.preview`, `memory.templates.preview.bank`,
  `memory.templates.status`, and `memory.templates.derived`. `detail` is the registry property name, not
  a `memory.templates.detail` wire method. Home must consume the released Shared constants.
- Shared user choices already preserve explicit value/inherit/suppress modes, full resource definitions and
  separate user revision. The derived schema explicitly distinguishes observed/stale/unavailable. Keep these
  producer facts intact rather than reconstructing them from effective Native values in Home.

## Dispatch checkpoint after B2 passes

1. Reconcile the Core checker's final plan/hold/publication/selection readers and any Shared/spec changes.
2. Give the Core implementer sole Shared/public-entry and backup/healthy-transition ownership; the Native
   implementer owns Pydantic, real observer/CLI/backup producers and canonical generation; Home owns its
   released read/write adapters and Operations surface. The original seven label files stay frozen unless
   an actual cross-layer correction needs coordinated ownership.
3. Agree exact new public component names and one strict shared wire fixture before Native/Core consumers
   finalize. Keep the full original selected apply requests, independent full Native receipt inventory and
   actual configuration observation separate, with the already approved byte/cardinality caps.
4. Refresh and validate implement/check contexts with the accepted B2 report and B3 source/design/readiness
   documents; then dispatch the three cohesive implementations. All heavy work remains serial at <=2 Vitest
   workers, and whole-slice review follows the existing Native/Core/Home ownership split.

No new migration is presumed necessary. Managed route-b still uses the live authenticated service observer;
D91 remains a stopped-writer operator preflight, not automatic startup/restore orchestration. Preserve W9 and
offline W6, and stop after the whole 5B gate rather than entering 5C.

## Named cross-language handoff

Root rechecked the existing Shared request/proof/manifest exports and Native schema hook. The names below do not
exist in the released source yet. They freeze the implementation handoff under the accepted B3 design; they do
not assert a producer or start implementation before the B2 gate.

| Shared schema export | Native public component | Contract |
| --- | --- | --- |
| `HindsightBackupNativeRequestV2Schema` | `TakiBackupRequestV2` | Strict version-2 complete request, including request hash and original selected Apply requests. |
| `HindsightBackupNativeProofV2Schema` | `TakiBackupProofV2` | Strict version-2 endpoint proof; its separately named body omits archive location/digest fields. |
| `HindsightTemplateBackupBankProofV2Schema` | `TemplateBackupBankProofV2` | Exact target, complete receipt inventory and selected/unselected observation variant. |
| `HindsightTemplateBackupObservationRequestSchema` | `TemplateBackupObservationRequest` | Strict `{ version: 2, nonce, request }` read request. |
| `HindsightTemplateBackupObservationResponseSchema` | `TemplateBackupObservationResponse` | Exact nonce/request/schema-bound proof-only response, never an archive. |

Core owns the Shared definitions, versioned attestation/manifest variants, public exports, canonical hash helpers
and `packages/shared/src/fixtures/hindsight-template-backup-v2.json`. Native owns corresponding Pydantic models
and canonical OpenAPI/client generation. The common fixture must include a complete selected original request,
an explicitly unselected Bank, the empty/nonempty receipt-inventory vectors, and invalid/missing/version cases.
Native/Core agree its concrete wire and digest values before finalizing consumers; neither side hand-edits the
other's definitions or generated output. Preserve lifecycle subtrees' existing snake_case; the enclosing existing
backup contract retains camelCase. Do not silently alias or normalize fields differently across languages.

Keep the existing aggregate public exports as explicit versioned unions where required, with separately named
v1/v2 bases for consumers such as staged manifests. Preserve `HindsightTemplateBackupEvidenceSchema` and Native
`TemplateBackupEvidence` unchanged; the new proof does not reinterpret their older placeholder contract.

The new read route is `POST /ext/taki-memory/template/backup-observation`. The exact build is
`taki-memory-hindsight-0.9.0-template-backup-v1`, optional contract `template_backup` version `1.0.0`. Receipt
inventory hashing uses `taki-template-backup-receipts.v1`; request/attestation/database-facet commitments each use
their own documented backup-domain hash and shared vectors. Existing lifecycle hashes remain unchanged.

The existing caps remain the implementation authority: 640 MiB complete compact UTF-8 request, 512 KiB per Apply,
2 MiB proof/observation response and 4 MiB manifest, with 256 Banks and 1,000,000 operation IDs. The observation
wrapper must have an explicit bound for its fixed overhead as well; it must not silently reduce the valid request
capacity. Boundary checks must not require allocating maximum-size test payloads merely to prove arithmetic.

Home's read/write contract is already released by B2 and stays independent of this new wire. Core owns its
Shared dependencies; Home owns only the Desktop adapter/composition files and the Operations template section.
The fixture, generated schemas and final reports must name the exact accepted source used for cross-layer tests.

## Implementer read-only reconciliation

The original Core and Native implementers confirmed readiness without file changes or checks. Their source
findings refine the handoff: Native's existing `_TemplateRoute` applies a 512-KiB bound in both directions and
must not carry the new backup/observation transport unchanged; `_ConfigResolutionStatus` proves invocation-local
resolution success, not the new complete inherited-config/source-context observation; `_backup_on_connection`
needs an injected authorized resolver or authenticated service adapter while retaining its own COPY snapshot.
Core's staged request currently uses pretty JSON and an unbounded read; v2 requires compact serialization and
bounded reads. Version-specific pair/manifest bases must preserve version and template attestation through every
projection. These are resolved implementation obligations within B3, not new product decisions.
