"""Seal native maintenance and complete application evidence in one SQL view."""

from __future__ import annotations

import json
import uuid
from typing import Any

from .application_state.models import TakiApplicationNamespace, TakiApplicationSnapshotRequest
from .application_state.snapshot import create_bundle
from .application_state.store import ApplicationStateStore
from .cutover_verification import CUTOVER_EVIDENCE_PAGE_SIZE, CutoverVerificationError, cutover_evidence_page_hash
from .cutover_verification_certificate import CutoverCertificateBinding, maintenance_evidence_manifest
from .cutover_verification_state import TransitionStoredRun, cutover_object_witness
from .logical_snapshot import LogicalSnapshotMetadata, LogicalSnapshotRecord
from .replication import MentalModelLogicalPayload, ReplicationBankState
from .transfer.current_state_schema import current_state_hash
from .transition_application_rebind import rebind_transition_application
from .transition_maintenance_store import assert_transition_maintenance
from .transition_models import TakiTransitionFinalProof, transition_proof_hash
from .transition_snapshot import auxiliary_pages, capture_transition_baseline
from .transition_storage import append_transition_history, executor_from_row


class TransitionCertificateBinding(CutoverCertificateBinding):
    async def validate_source(
        self, conn: Any, state: ReplicationBankState, records: list[LogicalSnapshotRecord]
    ) -> None:
        assert isinstance(self.run, TransitionStoredRun)
        await super().validate_source(conn, state, records)
        by_id = {(record.object_kind, record.object_id): record for record in records}
        for item in self.run.candidate.not_required:
            record = by_id.get((item.witness.object_kind, item.witness.object_id))
            if (
                record is None
                or not isinstance(record.payload, MentalModelLogicalPayload)
                or record.payload.source_query
                or item.reason != "source_query_absent"
                or cutover_object_witness(record) != item.witness
            ):
                raise CutoverVerificationError("input_changed")

    async def publish(self, conn: Any, metadata: LogicalSnapshotMetadata, records: list[LogicalSnapshotRecord]) -> None:
        assert isinstance(self.run, TransitionStoredRun)
        run, fq_table = self.run, self.service.fq_table
        await assert_transition_maintenance(conn, fq_table, run)
        owner = await conn.fetchrow(
            f"SELECT * FROM {fq_table('memory_transition_requests')} WHERE bank_id=$1 AND transition_id=$2",
            run.candidate.bank_id,
            run.request.verification_id,
        )
        acquisition = conn.parse_json(owner["request"])
        namespace = TakiApplicationNamespace(
            provider_lineage=run.request.provider_lineage, bank_generation=run.request.bank_generation
        )
        store = ApplicationStateStore(conn, fq_table, run.candidate.bank_id, namespace)
        await rebind_transition_application(store, run.request.verification_id)
        application = await create_bundle(
            store,
            TakiApplicationSnapshotRequest(
                namespace=namespace, request_id=uuid.uuid5(run.request.verification_id, "paired-final-snapshot")
            ),
        )
        if application.checkpoint.native_cursor != metadata.manifest.end_cursor:
            raise CutoverVerificationError("source_changed")
        baseline = await capture_transition_baseline(conn, fq_table, run.candidate.bank_id, records)
        evidence = maintenance_evidence_manifest(self.evidence)
        auxiliary = auxiliary_pages(baseline.auxiliary)
        page_hashes = [
            current_state_hash({"page_number": number, "records": [record.model_dump(mode="json") for record in page]})
            for number, page in enumerate(auxiliary)
        ]
        proof = TakiTransitionFinalProof(
            certificate_id=run.request.verification_id,
            bank_id=run.candidate.bank_id,
            provider_lineage=run.request.provider_lineage,
            bank_generation=run.request.bank_generation,
            executor=executor_from_row(owner),
            request_hash=owner["request_hash"],
            delta_result_hash=run.request.delta_result_hash,
            unused_scope_hash=acquisition["unused_scope"]["proof_hash"] if acquisition.get("unused_scope") else None,
            maintenance_input_hash=current_state_hash(
                {
                    "candidate_hash": run.candidate_hash,
                    "required_set_hash": run.required_set_hash,
                    "policy_hash": run.policy_hash,
                    "records": [
                        row.model_dump(mode="json")
                        for row in self.evidence
                        if row.record_kind in {"requirement", "input"}
                    ],
                }
            ),
            maintenance_outcome_hash=current_state_hash(
                [
                    row.model_dump(mode="json")
                    for row in self.evidence
                    if row.record_kind in {"outcome", "action", "model"}
                ]
            ),
            evidence=evidence,
            not_required=run.candidate.not_required,
            native_snapshot=metadata,
            application_snapshot=application,
            native_records_hash=baseline.native_records_hash,
            application_records_hash=baseline.application_records_hash,
            auxiliary_records_hash=baseline.auxiliary_records_hash,
            auxiliary_page_hashes=page_hashes,
            baseline_hash=baseline.baseline_hash,
            proof_hash="0" * 64,
        )
        proof.proof_hash = transition_proof_hash(proof)
        pages = [
            self.evidence[offset : offset + CUTOVER_EVIDENCE_PAGE_SIZE]
            for offset in range(0, len(self.evidence), CUTOVER_EVIDENCE_PAGE_SIZE)
        ] or [[]]
        for number, page in enumerate(pages):
            await conn.execute(
                f"INSERT INTO {fq_table('memory_cutover_evidence_pages')} "
                "(bank_id,verification_id,page_number,certificate_hash,page_hash,records) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
                run.candidate.bank_id,
                run.request.verification_id,
                number,
                proof.proof_hash,
                cutover_evidence_page_hash(number, page),
                json.dumps([record.model_dump(mode="json") for record in page]),
            )
        for number, page in enumerate(auxiliary):
            await conn.execute(
                f"INSERT INTO {fq_table('memory_transition_auxiliary_pages')} "
                "(bank_id,transition_id,page_number,page_hash,records) VALUES($1,$2,$3,$4,$5::jsonb)",
                run.candidate.bank_id,
                run.request.verification_id,
                number,
                page_hashes[number],
                json.dumps([record.model_dump(mode="json") for record in page]),
            )
        await conn.execute(
            f"UPDATE {fq_table('memory_cutover_verifications')} SET state='complete',certificate=$3::jsonb,"
            "revision=revision+1,reasons='[]'::jsonb WHERE bank_id=$1 AND verification_id=$2",
            run.candidate.bank_id,
            run.request.verification_id,
            proof.model_dump_json(),
        )
        owner = await conn.fetchrow(
            f"UPDATE {fq_table('memory_transition_requests')} SET phase='proven',proof=$3::jsonb,revision=revision+1 "
            "WHERE bank_id=$1 AND transition_id=$2 RETURNING *",
            run.candidate.bank_id,
            run.request.verification_id,
            proof.model_dump_json(),
        )
        await append_transition_history(conn, fq_table, owner)
        # There is deliberately no lease release here. Neither a certificate,
        # a lost reply, nor a later expiry can choose the external Core outcome.
