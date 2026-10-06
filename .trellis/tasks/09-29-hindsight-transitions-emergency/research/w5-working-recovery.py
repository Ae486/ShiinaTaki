"""PARENT ONLY: explicit working-pair e40 proof then SAME ordinary W5 reentry.

Default is inert. Initial --run-reviewed-working-copy has cap301 and no maintenance
approval. After proof exists, the same entry accepts an explicit reviewed per-Bank
--maintenance-approval and finite --submission-cap. No root/DSN/stage/renewal override.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import uuid
from pathlib import Path
from typing import Any

from w5_actual_embedding_control import digest, load, write_json
from w5_reentry_gate import ReentryGate
from w5_working_custody import (
    CORE_SHA,
    ROOT,
    SOURCE,
    TRANSITION,
    WorkingOwner,
    no_link,
    read_core,
    require_root,
    stopped,
)
from w5_working_migration import PROOF_NAME, bounded_migration, load_proof

HERE = Path(__file__).resolve().parent
PREDECESSOR = HERE / "w5-http-checked-v4-source-manifest.json"
PREDECESSOR_SHA = "d28d651db46f6c0c06d4387ac3d235026f996a1e142e6d9b0a95ecae8ad978ef"
MANIFEST = HERE / "w5-working-recovery-source-manifest.json"


def verify_sources() -> str:
    assert digest(PREDECESSOR) == PREDECESSOR_SHA, "WORKING_PREDECESSOR_CHANGED"
    previous = json.loads(PREDECESSOR.read_text(encoding="utf-8"))["files"]
    current = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert current["predecessorSha256"] == PREDECESSOR_SHA
    by_path = {row["path"]: row for row in current["files"]}
    assert len(by_path) == len(current["files"])
    assert all(by_path.get(row["path"]) == row for row in previous), "WORKING_OLD_SEAL_REPLACED"
    for row in current["files"]:
        path = Path(row["path"])
        assert path.stat().st_size == row["bytes"] and digest(path) == row["sha256"], "WORKING_SOURCE_DRIFT"
    return digest(MANIFEST)


def arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-working-copy", action="store_true")
    parser.add_argument("--maintenance-approval", type=Path)
    parser.add_argument("--submission-cap", type=int, default=301)
    args = parser.parse_args(argv)
    if args.submission_cap < 301 or (args.maintenance_approval is None and args.submission_cap != 301):
        parser.error("No approval means exact cap301; approved recovery requires a finite cumulative cap>=301")
    if not args.run_reviewed_working_copy and (args.maintenance_approval is not None or args.submission_cap != 301):
        parser.error("Approval options require the explicit parent execution switch")
    return args


def old_arguments(approval: Path | None, cap: int) -> list[str]:
    result = [str(HERE / "w5-reused-native.py"), "run", "--stage", "reentry", "--submission-cap", str(cap)]
    if approval is not None:
        result.extend(["--maintenance-approval", str(approval)])
    return result


def check_progress(before: dict, after: dict) -> None:
    old, new = before["state"], after["state"]
    assert before["bankA"] == after["bankA"] and before["preparationSha256"] == after["preparationSha256"]
    for key in ("returnAnchor", "localMutation"):
        assert old["journey"][key] == new["journey"][key], "WORKING_JOURNEY_ANCHOR_CHANGED"
    assert old["steps"]["return"] == new["steps"]["return"] and old["localChanges"] == new["localChanges"]
    entries = old["journey"]["submissions"]
    assert new["journey"]["submissions"][: len(entries)] == entries, "WORKING_OLD_SUBMISSION_CHANGED"
    for entry in new["journey"]["submissions"][len(entries) :]:
        assert entry["name"] == "reentry" and "supersession" not in entry
        assert entry["request"]["recovery"]["transitionId"] == TRANSITION, "WORKING_NEW_TRANSITION_REFUSED"


def run_reviewed(args: argparse.Namespace) -> int:
    source_sha = verify_sources()
    require_root()
    old = load("w5_working_old_supervisor", "w5-reused-native.py")
    assert old.ROOT == ROOT and old.SOURCE == SOURCE and old.PG_PORT == 18495 and old.HTTP_PORT == 18496
    sys.path[:0] = [str(old.VALIDATION), str(old.inspection.NATIVE / "hindsight-api-slim")]
    from real_hindsight_environment import crypt_bytes, exclusive_supervisor

    with exclusive_supervisor(ROOT):
        stopped()
        has_proof = (ROOT / PROOF_NAME).exists()
        if has_proof:
            load_proof(ROOT)
        else:
            assert args.maintenance_approval is None and args.submission_cap == 301, (
                "INITIAL_MIGRATION_HAS_NO_ALLOWANCE"
            )
            assert digest(ROOT / "application.sqlite") == CORE_SHA, "WORKING_INITIAL_CORE_CHANGED"
        counter = json.loads((ROOT / "model-submissions.json").read_text(encoding="utf-8"))["submitted"]
        assert type(counter) is int and 301 <= counter <= args.submission_cap
        before = read_core()
        core_before = digest(ROOT / "application.sqlite")
        checkpoint_before = digest(ROOT / "journey-checkpoint.json")
        credential_path = old.inspection.HISTORY / "native-credentials.dpapi"
        no_link(credential_path)
        private = json.loads(crypt_bytes(credential_path.read_bytes(), decrypt=True))
        assert (
            private["run_id"] == "654131f0175a" and isinstance(private["pg_password"], str) and private["pg_password"]
        )
        # Validate existing gate/allowance/accounting before any service starts.
        approval = args.maintenance_approval
        if approval is not None:
            approval = approval.absolute()
            no_link(approval)
        ReentryGate(
            ROOT,
            engine=object(),
            supervisor_attempt=uuid.uuid4().hex,
            cumulative_cap=args.submission_cap,
            approval_path=approval,
        )
        run_dir = ROOT / "working-recovery-history" / uuid.uuid4().hex
        run_dir.mkdir(parents=True)
        if approval is not None:
            shutil.copy2(approval, run_dir / "maintenance-approval.json")
            approval = run_dir / "maintenance-approval.json"
        # Add counter/proof retention to the old main's existing complete
        # checkpoint/result retention; never replace historical run artifacts.
        for name in ("model-submissions.json", "ownership.json", PROOF_NAME):
            if (ROOT / name).exists():
                shutil.copy2(ROOT / name, run_dir / name)
        report: dict[str, Any] = {
            "version": 1,
            "sourceManifestSha256": source_sha,
            "transitionId": TRANSITION,
            "bankA": before["bankA"],
            "submissionCap": args.submission_cap,
            "approved": approval is not None,
            "modelSubmissionsBefore": counter,
            "completed": False,
        }
        write_json(run_dir / "result.json", report)
        owner = WorkingOwner(old)
        original_execute = old.execute

        async def execute(password: str, mode: str, summary: dict, **kwargs: Any) -> None:
            assert password == private["pg_password"] and mode == "run" and kwargs["stage"] == "reentry"
            assert kwargs["reentry_renewal"] is None and kwargs["maintenance_approval"] == approval
            assert kwargs["submission_cap"] == args.submission_cap and owner.owned_pg()
            assert digest(ROOT / "application.sqlite") == core_before, "WORKING_CORE_CHANGED_BEFORE_MIGRATION"
            report["migration"] = await bounded_migration(owner, password, allow_migration=not has_proof)
            assert digest(ROOT / "application.sqlite") == core_before, "MIGRATION_CHANGED_CORE"
            assert digest(ROOT / "journey-checkpoint.json") == checkpoint_before, "MIGRATION_CHANGED_CHECKPOINT"
            assert json.loads((ROOT / "model-submissions.json").read_text(encoding="utf-8"))["submitted"] == counter
            write_json(run_dir / "result.json", report)
            verify_sources()
            await original_execute(password, mode, summary, **kwargs)

        old.execute = execute
        old.inspection.command = owner.checked_command
        previous_argv = sys.argv
        sys.argv = old_arguments(approval, args.submission_cap)
        try:
            code = old.main()
            report["oldSupervisorExit"] = code
            assert code == 0, "WORKING_OLD_SUPERVISOR_FAILED"
            after = read_core(after=True)
            check_progress(before, after)
            count = json.loads((ROOT / "model-submissions.json").read_text(encoding="utf-8"))["submitted"]
            assert type(count) is int and counter <= count <= args.submission_cap
            result = json.loads((ROOT / "run-result.json").read_text(encoding="utf-8"))
            if approval is None:
                assert count == counter == 301 and result["nodeExit"] == 2
                pause = json.loads((ROOT / f"reentry-pause-{result['attemptId']}.json").read_text(encoding="utf-8"))
                assert pause["bankId"] == before["bankA"] and pause["transitionId"] == TRANSITION
                assert pause["approved"] is False and pause["totalModelSubmissions"] == 301
                assert result["stagedPause"]["outcome"] == "staged_pause" and not after["state"].get("completed")
                report["actualPlan"] = pause["reviewFile"]
            report.update(modelSubmissionsAfter=count, ordinaryRecoveryPreserved=True, completed=True)
        except BaseException as error:
            report["errorClass"] = type(error).__name__
            raise
        finally:
            sys.argv = previous_argv
            old.execute = original_execute
            old.inspection.command = owner.command
            try:
                report["cleanup"] = owner.settle_and_stop()
                report["originalSiblingPreserved"] = bool(old.source_verified())
                assert verify_sources() == source_sha
                report["sealedSourcesPreserved"] = True
            except BaseException as error:
                report["completed"] = False
                report["cleanupErrorClass"] = type(error).__name__
                raise
            finally:
                write_json(run_dir / "result.json", report)
                print(
                    json.dumps(
                        {
                            "workingRecoveryReport": str(run_dir / "result.json"),
                            "completed": report["completed"],
                            "errorClass": report.get("errorClass"),
                        }
                    )
                )
        return 0


def main(argv: list[str] | None = None) -> int:
    args = arguments(argv)
    if not args.run_reviewed_working_copy:
        print(
            json.dumps(
                {
                    "parentRunOnly": True,
                    "executed": False,
                    "initialSubmissionCap": 301,
                    "stage": "reentry",
                    "renewalAccepted": False,
                }
            )
        )
        return 0
    return run_reviewed(args)


if __name__ == "__main__":
    raise SystemExit(main())
