"""Append current-Local revisions without weakening ordinary D77 commands.

The delta transaction has already proved the retired common baseline. Every
new revision records its exact predecessor and Local source hash in the delta
receipt; old original bodies and receipts remain immutable and readable.
"""

from __future__ import annotations

from pydantic import BaseModel

from ..application_state.codec import digest, json_bytes, without_hash
from ..application_state.commits import _check_body, current_native
from ..application_state.models import (
    ApplicationBodySchema,
    TakiApplicationActor,
    TakiApplicationArtifact,
    TakiApplicationArtifactDescriptor,
    TakiApplicationArtifactVersion,
    TakiApplicationAssessment,
    TakiApplicationBankBody,
    TakiApplicationBlockBinding,
    TakiApplicationBlockBody,
    TakiApplicationExactBinding,
    TakiApplicationMemoryBody,
    TakiApplicationNativeDescriptor,
    TakiApplicationOriginalWitness,
    TakiApplicationPutArtifact,
    TakiApplicationRecordDescriptor,
)
from ..application_state.publication import load_native_source_evidence, publish_event
from ..application_state.store import ApplicationStateStore, artifact_version, utc_now
from ..replication import LogicalObjectKind, load_document_logical_payload, load_memory_unit_logical_payload
from ..transition_models import TransitionError
from .current_state_schema import current_state_hash
from .transition_delta_models import (
    TakiTransitionDeltaRequest,
    TransitionApplicationDescriptor,
    TransitionArtifactLineage,
    TransitionMemoryArtifactInput,
    TransitionMemoryEvidenceInput,
    TransitionSourceEvidenceInput,
    TransitionSourceInput,
)
from .transition_delta_preflight import TransitionDeltaPlan


async def _predecessors(
    store: ApplicationStateStore, request: TakiTransitionDeltaRequest
) -> dict[tuple[str, str], TakiApplicationArtifact]:
    previous = {
        (artifact.key.artifact_kind, artifact.key.artifact_id): artifact
        for artifact in await store.artifacts(history=False)
    }
    descriptors = {(item.key.artifact_kind, item.key.artifact_id): item for item in request.application}
    represented = {key for key, item in descriptors.items() if item.expected_artifact is not None}
    if len(descriptors) != len(request.application) or represented != previous.keys():
        raise TransitionError("descriptor_mismatch")
    for key, old in previous.items():
        item = descriptors[key]
        if item.expected_artifact != artifact_version(old) or item.expected_body_hash != old.body_ref.bytes_sha256:
            raise TransitionError("artifact_conflict")
        await store.read_body(old.body_ref)
    return previous


async def _body_and_command(
    store: ApplicationStateStore,
    request: TakiTransitionDeltaRequest,
    plan: TransitionDeltaPlan,
    item: TransitionApplicationDescriptor,
    previous: TakiApplicationArtifact | None,
    source_results: dict[tuple[str, str], TakiApplicationArtifactVersion],
) -> TakiApplicationPutArtifact:
    if item.body is None:
        raise TransitionError("body_mismatch")
    input_body = item.body.root
    if isinstance(input_body, TransitionSourceEvidenceInput):
        from .transition_source_evidence import prepare_transition_source_evidence

        return await prepare_transition_source_evidence(store, request, plan, item, previous)
    if item.key.artifact_kind == "block":
        if item.native_source_id is not None:
            raise TransitionError("descriptor_mismatch")
        native = None
        binding = TakiApplicationBlockBinding()
    else:
        kinds: dict[str, LogicalObjectKind] = {"bank": "bank", "source": "document", "memory": "memory_unit"}
        kind = kinds[item.key.artifact_kind]
        if item.native_source_id is None:
            raise TransitionError("descriptor_mismatch")
        key = (kind, item.native_source_id)
        if key not in plan.descriptors or plan.descriptors[key].disposition == "delete":
            raise TransitionError("descriptor_mismatch")
        head = await store.head(kind, plan.identities[key])
        if head is None or head.version is None:
            raise TransitionError("descriptor_mismatch")
        native = head.version
        await current_native(store, native)
        binding = TakiApplicationExactBinding(native=native)
    body: BaseModel
    if isinstance(input_body, (TransitionMemoryArtifactInput, TransitionMemoryEvidenceInput)):
        if native is None:
            raise TransitionError("descriptor_mismatch")
        supplied = input_body.body
        references = []
        if isinstance(input_body, TransitionMemoryEvidenceInput):
            from .transition_source_references import transition_source_references

            references = await transition_source_references(store, request, input_body, source_results)
        else:
            for key in input_body.body.source_artifacts:
                source = await store.artifact(key)
                if source is None or source.tombstoned or key.artifact_kind != "source":
                    raise TransitionError("artifact_conflict")
                references.append(artifact_version(source))
        # Current Local policy is imported as explicit input, not as an invented
        # native model assessment. Historical assessed bodies remain untouched.
        body = TakiApplicationMemoryBody(
            policy_basis=supplied.policy_basis,
            policy=supplied.policy,
            assessment=TakiApplicationAssessment(
                state="not_required",
                target=native,
                attempts=0,
                next_attempt_at=None,
                last_failure_code=None,
                prompt_version=None,
                prompt_hash=None,
                completed_at=None,
            ),
            provenance=supplied.provenance,
            source_artifacts=references,
            original_record=supplied.original_record,
            encoded_metadata=supplied.encoded_metadata,
        )
        if supplied.original_record is not None:
            original = supplied.original_record
            actual = await load_memory_unit_logical_payload(
                conn=store.conn, fq_table=store.fq_table, bank_id=store.bank_id, memory_id=native.object_id
            )
            if (
                actual is None
                or original.unit.memoryId != item.native_source_id
                or original.policy != supplied.policy
                or original.provenance != supplied.provenance
                or actual.text != original.unit.text
                or actual.context != original.unit.context
                or actual.state != original.unit.state
                or current_state_hash(actual.metadata) != current_state_hash(original.unit.metadata)
            ):
                raise TransitionError("descriptor_mismatch")
            body = body.model_copy(update={"encoded_metadata": actual.metadata})
        if previous is not None:
            old = await store.read_body(previous.body_ref)
            if not isinstance(old, TakiApplicationMemoryBody):
                raise TransitionError("artifact_conflict")
            relocation = {"authorityEpochId", "bankId", "memoryId", "updatedAt", "policyVersion"}
            changed = json_bytes(old.policy.model_dump(exclude=relocation)) != json_bytes(
                body.policy.model_dump(exclude=relocation)
            )
            if body.policy.policyVersion < old.policy.policyVersion or (
                changed and body.policy.policyVersion <= old.policy.policyVersion
            ):
                raise TransitionError("artifact_conflict")
    elif isinstance(input_body, TransitionSourceInput):
        if native is None:
            raise TransitionError("descriptor_mismatch")
        supplied = input_body.body
        actual = await load_document_logical_payload(
            conn=store.conn, fq_table=store.fq_table, bank_id=store.bank_id, document_id=native.object_id
        )
        evidence = await load_native_source_evidence(store, native)
        original = supplied.original_source
        if (
            actual is None
            or original.documentId != item.native_source_id
            or evidence.original_text != original.retainedText
            or evidence.context != original.context
            or current_state_hash(actual.metadata) != current_state_hash(original.metadata)
        ):
            raise TransitionError("descriptor_mismatch")
        # Core's original-source projection requires this exact native witness.
        # A client prediction/old/null witness cannot certify a changed Local
        # input. Derive it only after the actual native delta has published.
        body = supplied.model_copy(
            update={
                "encoded_metadata": actual.metadata,
                "original_witness": TakiApplicationOriginalWitness(
                    source_kind=native.object_kind,
                    source_id=native.object_id,
                    source_revision=native.object_revision,
                    source_payload_hash=native.payload_hash,
                ),
            }
        )
    else:
        body = input_body.body
    schemas: dict[str, ApplicationBodySchema] = {
        "bank": "application-bank.v1",
        "source": "application-source.v1",
        "memory": "application-memory.v1",
        "block": "application-block.v1",
    }
    schema = schemas[item.key.artifact_kind]
    # Delay saving the body until validation. A failed command still rolls back
    # the outer native/app transaction, but should never leave transport debris.
    from ..application_state.codec import body_ref

    ref = body_ref(store.namespace, store.bank_id, schema, json_bytes(body))
    command = TakiApplicationPutArtifact(
        key=item.key,
        expected_artifact=item.expected_artifact,
        body_ref=ref,
        binding=binding,
        expected_native=native,
        actor=TakiApplicationActor(kind="restore", actor_ref=f"transition:{request.executor.transition_id}"),
    )
    # Reuse ordinary policy/source/Block validation. Only original-input equality
    # is replaced by the explicit baseline + predecessor + Local witness above.
    # Ordinary D77 endpoints continue to pass their real predecessor unchanged.
    await _check_body(store, command, body, previous if isinstance(body, TakiApplicationBlockBody) else None)
    if previous is not None and previous.binding == binding and not previous.tombstoned:
        if await store.body_bytes(previous.body_ref) == json_bytes(body):
            return command.model_copy(update={"body_ref": previous.body_ref})
    ref = await store.save_body(schema, body)
    return command.model_copy(update={"body_ref": ref})


async def write_transition_application_delta(
    store: ApplicationStateStore,
    request: TakiTransitionDeltaRequest,
    plan: TransitionDeltaPlan,
) -> list[TransitionArtifactLineage]:
    previous = await _predecessors(store, request)
    records: list[TakiApplicationRecordDescriptor] = []
    lineage: list[TransitionArtifactLineage] = []
    source_results: dict[tuple[str, str], TakiApplicationArtifactVersion] = {}
    order = {"bank": 0, "source": 1, "memory": 2, "block": 3}
    items = sorted(request.application, key=lambda item: (order[item.key.artifact_kind], item.key.artifact_id.encode()))
    for item in items:
        old = previous.get((item.key.artifact_kind, item.key.artifact_id))
        if item.disposition == "reuse":
            if old is None:
                raise TransitionError("artifact_conflict")
            artifact, disposition = old, "reused"
        else:
            command = (
                await _body_and_command(store, request, plan, item, old, source_results)
                if item.disposition == "upsert"
                else None
            )
            if command is None:
                if old is None:
                    raise TransitionError("artifact_conflict")
                binding, ref = old.binding, old.body_ref
            else:
                binding, ref = command.binding, command.body_ref
            if (
                old is not None
                and command is not None
                and ref == old.body_ref
                and binding == old.binding
                and not old.tombstoned
            ):
                artifact, disposition = old, "reused"
            else:
                now = utc_now()
                artifact = TakiApplicationArtifact(
                    namespace=store.namespace,
                    bank_id=store.bank_id,
                    key=item.key,
                    revision=old.revision + 1 if old else 1,
                    body_ref=ref,
                    binding=binding,
                    tombstoned=item.disposition == "retire",
                    created_at=old.created_at if old else now,
                    updated_at=now,
                    record_hash="0" * 64,
                )
                artifact.record_hash = digest(
                    "record", store.namespace, store.bank_id, without_hash(artifact, "record_hash")
                )
                await store.save_artifact(artifact)
                records.append(TakiApplicationArtifactDescriptor(artifact=artifact))
                disposition = "retired" if artifact.tombstoned else "upserted"
                if isinstance(binding, TakiApplicationExactBinding):
                    head = await store.head(binding.native.object_kind, binding.native.object_id)
                    if head is None:
                        raise TransitionError("artifact_conflict")
                    if not artifact.tombstoned and head.version != binding.native:
                        raise TransitionError("artifact_conflict")
                    if (
                        head.bound_artifact is not None
                        and head.bound_artifact.key != item.key
                        and item.key.artifact_kind != "source"
                    ):
                        raise TransitionError("artifact_conflict")
                    head = head.model_copy(
                        update={
                            "bound_artifact": artifact_version(artifact),
                            "binding_state": "tombstoned"
                            if head.version is None
                            else "binding_missing"
                            if artifact.tombstoned
                            else "bound",
                            "cause": "native_delete" if head.version is None else "application_commit",
                        }
                    )
                    if artifact.tombstoned and item.key.artifact_kind == "source":
                        from ..application_state.source_evidence import surviving_source_head

                        head = await surviving_source_head(store, head)
                    await store.save_head(head)
                    records.append(TakiApplicationNativeDescriptor(head=head))
        if item.key.artifact_kind == "source":
            source_results[(item.key.artifact_kind, item.key.artifact_id)] = artifact_version(artifact)
        lineage.append(
            TransitionArtifactLineage(
                key=item.key,
                previous=artifact_version(old) if old else None,
                previous_body_hash=old.body_ref.bytes_sha256 if old else None,
                current=artifact_version(artifact),
                source_record_hash=item.source_record_hash,
                disposition=disposition,
            )
        )
    banks = [artifact for artifact in await store.artifacts(history=False, kind="bank") if not artifact.tombstoned]
    if len(banks) != 1:
        raise TransitionError("artifact_conflict")
    bank_body = await store.read_body(banks[0].body_ref)
    if not isinstance(bank_body, TakiApplicationBankBody):
        raise TransitionError("artifact_conflict")
    for artifact in await store.artifacts(history=False):
        if artifact.tombstoned:
            continue
        body = await store.read_body(artifact.body_ref)
        if isinstance(body, TakiApplicationBlockBody) and body.scope != bank_body.scope:
            raise TransitionError("artifact_conflict")
        if (
            isinstance(body, TakiApplicationMemoryBody)
            and body.provenance.origin == "provider-derived"
            and body.provenance.characterId != bank_body.scope.characterId
        ):
            raise TransitionError("artifact_conflict")
    if records:
        await publish_event(store, records)
    return lineage
