"""Seal complete native evidence on the logical snapshot's exact MVCC view."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .cutover_verification import (
    CUTOVER_EVIDENCE_PAGE_SIZE,
    CutoverEvidenceCounts,
    CutoverEvidenceManifest,
    CutoverEvidenceRecord,
    CutoverInputRecord,
    CutoverMaintenanceCertificate,
    CutoverRequirementRecord,
    CutoverVerificationError,
    cutover_certificate_hash,
    cutover_evidence_page_hash,
    cutover_input_manifest_hash,
    cutover_lifecycle_list_hash,
    cutover_witness_list_hash,
)
from .cutover_verification_candidate import assert_no_accepted_work
from .cutover_verification_state import CutoverStoredRun, MaintenanceRun
from .cutover_verification_store import (
    assert_cutover_attempt,
    persist_cutover_certificate,
    read_cutover_actions,
    read_cutover_steps,
)
from .cutover_verification_view import CutoverInputView
from .logical_snapshot import LogicalSnapshotMetadata, LogicalSnapshotRecord
from .replication import ReplicationBankState
from .transfer.current_state_schema import current_state_bytes, current_state_hash

if TYPE_CHECKING:
    from .cutover_verification_runner import CutoverVerificationService


def maintenance_evidence_manifest(records: list[CutoverEvidenceRecord]) -> CutoverEvidenceManifest:
    pages = [
        records[offset : offset + CUTOVER_EVIDENCE_PAGE_SIZE]
        for offset in range(0, len(records), CUTOVER_EVIDENCE_PAGE_SIZE)
    ] or [[]]
    return CutoverEvidenceManifest(
        total_pages=len(pages),
        total_records=len(records),
        counts=CutoverEvidenceCounts(
            requirements=sum(row.record_kind == "requirement" for row in records),
            outcomes=sum(row.record_kind == "outcome" for row in records),
            inputs=sum(row.record_kind == "input" for row in records),
            actions=sum(row.record_kind == "action" for row in records),
            models=sum(row.record_kind == "model" for row in records),
        ),
        records_hash=current_state_hash([row.model_dump(mode="json") for row in records]),
        page_hashes=[cutover_evidence_page_hash(index, page) for index, page in enumerate(pages)],
    )


@dataclass
class CutoverCertificateBinding:
    service: CutoverVerificationService
    run: MaintenanceRun
    evidence: list[CutoverEvidenceRecord] = field(default_factory=list)

    async def lock_source(self, conn: Any) -> None:
        await assert_cutover_attempt(conn=conn, fq_table=self.service.fq_table, run=self.run)

    async def validate_source(
        self,
        conn: Any,
        state: ReplicationBankState,
        records: list[LogicalSnapshotRecord],
    ) -> None:
        await assert_cutover_attempt(conn=conn, fq_table=self.service.fq_table, run=self.run)
        await self.service.check_policy(self.run)
        await assert_no_accepted_work(conn, self.service.fq_table, self.run.candidate.bank_id)
        view = CutoverInputView(self.run, self.service.fq_table)
        await view.load_actions(conn)
        await view.validate_snapshot(conn, state, records)
        steps = await read_cutover_steps(conn=conn, fq_table=self.service.fq_table, run=self.run)
        actions = await read_cutover_actions(conn=conn, fq_table=self.service.fq_table, run=self.run)
        requirements = self.run.candidate.requirements
        required = {row.requirement_key: row for row in requirements}
        outcomes = [row for step in steps if step.state == "complete" for row in step.outcome_records]
        if sorted(row.requirement_key for row in outcomes) != sorted(required):
            raise CutoverVerificationError("partial_native_actions")
        models = [step.model_record for step in steps if step.state == "complete" and step.model_record is not None]
        if sorted(row.requirement_key for row in models) != sorted(
            key for key, requirement in required.items() if requirement.kind == "mental_model"
        ):
            raise CutoverVerificationError("native_model_failed")
        all_inputs = [row for step in steps for row in step.input_records]
        unique_inputs = {
            current_state_bytes(row.model_dump(mode="json", exclude={"ordinal"})): row for row in all_inputs
        }
        inputs = [unique_inputs[key] for key in sorted(unique_inputs)]
        groups: dict[str, list[CutoverInputRecord]] = defaultdict(list)
        for row in inputs:
            if row.requirement_key not in required:
                raise CutoverVerificationError("evidence_corrupt")
            groups[row.input_manifest_hash].append(row)
        if any(digest != cutover_input_manifest_hash(rows) for digest, rows in groups.items()):
            raise CutoverVerificationError("evidence_corrupt")
        action_by_key = {action.receipt.action_key: action.receipt for action in actions}
        for action in action_by_key.values():
            if (
                action.input_manifest_hash not in groups
                or not action.requirement_keys
                or any(key not in required for key in action.requirement_keys)
                or action.verified_cursor > state.current_cursor
            ):
                raise CutoverVerificationError("evidence_corrupt")
        for outcome in outcomes:
            if outcome.input_manifest_hash not in groups or outcome.verified_cursor > state.current_cursor:
                raise CutoverVerificationError("evidence_corrupt")
            for key in outcome.action_keys:
                action = action_by_key.get(key)
                if action is None or outcome.requirement_key not in action.requirement_keys:
                    raise CutoverVerificationError("evidence_corrupt")
            if outcome.disposition != "not_required" and not outcome.action_keys:
                raise CutoverVerificationError("partial_native_actions")
        for model in models:
            outcome = next(row for row in outcomes if row.requirement_key == model.requirement_key)
            selected = [
                row for row in groups[outcome.input_manifest_hash] if row.requirement_key == model.requirement_key
            ]
            for role in ("eligible", "retrieved", "consumed"):
                witnesses = [row.witness for row in selected if row.role == role and row.witness is not None]
                if getattr(model, f"{role}_hash") != cutover_witness_list_hash(witnesses):
                    raise CutoverVerificationError("evidence_corrupt")
            lifecycle = [row.lifecycle for row in selected if row.lifecycle is not None]
            if model.lifecycle_hash != cutover_lifecycle_list_hash(lifecycle):
                raise CutoverVerificationError("evidence_corrupt")
            if model.skipped_operation_count or model.outcome.startswith("refresh_failed"):
                raise CutoverVerificationError("native_model_failed")
        # Chunks are not canonical logical rows. Their actual native text is a
        # private input, revalidated again in the same snapshot transaction.
        chunks = [
            row.witness
            for row in inputs
            if row.witness is not None
            and row.witness.object_kind
            in {
                "chunk",
                "document_content",
            }
        ]
        await view.check_inputs(conn, chunks)
        ordered: list[CutoverEvidenceRecord] = [
            *[CutoverRequirementRecord(ordinal=0, requirement=row) for row in requirements],
            *sorted(outcomes, key=lambda row: row.requirement_key),
            *inputs,
            *sorted(action_by_key.values(), key=lambda row: row.action_key),
            *sorted(models, key=lambda row: row.requirement_key),
        ]
        self.evidence = [record.model_copy(update={"ordinal": index}) for index, record in enumerate(ordered)]

    async def publish(
        self,
        conn: Any,
        metadata: LogicalSnapshotMetadata,
        records: list[LogicalSnapshotRecord],
    ) -> None:
        # The transition subclass publishes its independent paired proof.
        # First activation retains the exact original transfer-bound receipt.
        assert isinstance(self.run, CutoverStoredRun)
        evidence = maintenance_evidence_manifest(self.evidence)
        request = self.run.request
        certificate = CutoverMaintenanceCertificate(
            verification_id=request.verification_id,
            request_hash=request.request_hash,
            bank_id=self.run.candidate.bank_id,
            source_bank_id=request.source_bank_id,
            provider_lineage=request.provider_lineage,
            bank_generation=request.bank_generation,
            local_manifest_digest=request.local_manifest_digest,
            transfer_operation_id=request.transfer_operation_id,
            transfer_request_hash=request.transfer_request_hash,
            transfer_result_hash=request.transfer_result_hash,
            candidate_hash=self.run.candidate_hash,
            candidate_cursor=self.run.candidate.cursor,
            required_set_hash=self.run.required_set_hash,
            source_scope_count=sum(row.kind == "source_scope" for row in self.run.candidate.requirements),
            model_count=sum(row.kind == "mental_model" for row in self.run.candidate.requirements),
            policy_hash=self.run.policy_hash,
            evidence=evidence,
            snapshot_records_hash=current_state_hash([row.model_dump(mode="json") for row in records]),
            snapshot=metadata,
            certificate_hash="0" * 64,
        )
        certificate = certificate.model_copy(update={"certificate_hash": cutover_certificate_hash(certificate)})
        await persist_cutover_certificate(
            conn=conn,
            fq_table=self.service.fq_table,
            run=self.run,
            certificate=certificate,
            records=self.evidence,
        )
