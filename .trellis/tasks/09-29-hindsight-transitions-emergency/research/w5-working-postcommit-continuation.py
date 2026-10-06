"""PARENT ONLY: finish the exact committed W5 transition with zero model allowance.

Default is inert; there is no root, cap, approval, stage, migration or renewal CLI.
The sealed network/working entries still own startup, history, cleanup and recovery.
"""

from __future__ import annotations

import argparse
import json
import uuid
from pathlib import Path
from typing import Any

from w5_actual_embedding_control import digest, load, write_json
from w5_postcommit_custody import CAP, EPOCH, RECEIPT, ROOT, TRANSITION, read_committed
from w5_working_custody import no_link
from w5_working_migration import PROOF_NAME

HERE = Path(__file__).resolve().parent
PREDECESSOR = HERE / "w5-working-network-source-manifest.json"
PREDECESSOR_SHA = "36b8dd3c0da110d044f1b1a8c56e88c8fcace742059f0f0b2c7d880b1fe6b9e6"
MANIFEST = HERE / "w5-working-postcommit-source-manifest.json"
APPROVAL = HERE / "w5-working-postcommit-zero-allowance.json"


def verify_sources() -> str:
    assert digest(PREDECESSOR) == PREDECESSOR_SHA, "POSTCOMMIT_PREDECESSOR_DRIFT"
    previous = json.loads(PREDECESSOR.read_text(encoding="utf-8"))["files"]
    current = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert len(previous) == 5107 and current["predecessorSha256"] == PREDECESSOR_SHA
    rows = {row["path"]: row for row in current["files"]}
    assert len(rows) == len(current["files"]) and all(rows.get(row["path"]) == row for row in previous)
    for row in current["files"]:
        path = Path(row["path"])
        assert path.stat().st_size == row["bytes"] and digest(path) == row["sha256"], "POSTCOMMIT_SOURCE_DRIFT"
    return digest(MANIFEST)


def run() -> int:
    source_sha = verify_sources()
    approval = json.loads(APPROVAL.read_text(encoding="utf-8"))
    assert approval == {
        "version": 1,
        "transitionId": TRANSITION,
        "returnReceiptId": "e173dffd3612e5932f50a1df5ae7c1c1b4f7ee3d269dce9a11828debd77a8469",
        "cumulativeCap": CAP,
        "banks": [],
    }, "POSTCOMMIT_ALLOWANCE_REFUSED"
    network = load("w5_postcommit_network_entry", "w5-working-network-continuation.py")
    entry = network.entry
    assert entry.ROOT == ROOT and entry.TRANSITION == TRANSITION
    original_read, original_guard = entry.read_core, network.NetworkContinuation.install_guard
    report: dict[str, Any] = {
        "version": 1,
        "sourceManifestSha256": source_sha,
        "receiptId": RECEIPT,
        "epochId": EPOCH,
        "submissionCap": CAP,
        "modelAccess": False,
        "completed": False,
    }
    report_path: Path | None = None

    def committed_read(*, after: bool = False) -> dict:
        nonlocal report_path
        # Called by the sealed entry under its exclusive supervisor lock, after
        # require_root/stopped/proof validation, and again after ordinary cleanup.
        assert (ROOT / PROOF_NAME).is_file(), "POSTCOMMIT_MIGRATION_PROOF_REQUIRED"
        value = read_committed(after=after)
        if not after:
            assert report_path is None
            parent = ROOT / "working-postcommit-history"
            if parent.exists():
                no_link(parent)
            parent.mkdir(exist_ok=True)
            directory = parent / uuid.uuid4().hex
            directory.mkdir()
            report_path = directory / "result.json"
            report["before"] = value["postCommit"]
        else:
            assert report["before"] == value["postCommit"], "POSTCOMMIT_COMMITTED_BYTES_CHANGED"
            report["after"] = value["postCommit"]
        assert report_path is not None
        write_json(report_path, report)
        return value

    def no_model_guard(controller: Any, original: Any, pg_port: Any, listener: Any, *, model_access: bool) -> set[str]:
        # The old supervisor treats any approval file as model access, including
        # banks=[]. Narrow that permission here; original socket guards stay intact.
        assert controller.root == ROOT
        return original_guard(controller, original, pg_port, listener, model_access=False)

    entry.read_core = committed_read
    network.NetworkContinuation.install_guard = no_model_guard
    try:
        code = network.run(
            argparse.Namespace(run_reviewed_working_copy=True, maintenance_approval=APPROVAL, submission_cap=CAP)
        )
        assert code == 0 and report.get("after") == report.get("before") and report_path is not None
        report["completed"] = True
        return code
    except BaseException as error:
        report["errorClass"] = type(error).__name__
        raise
    finally:
        entry.read_core, network.NetworkContinuation.install_guard = original_read, original_guard
        try:
            assert verify_sources() == source_sha
            report["sealedSourcesPreserved"] = True
        finally:
            if report_path is not None:
                write_json(report_path, report)
                print(json.dumps({"postCommitRecoveryReport": str(report_path), "completed": report["completed"]}))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-working-copy", action="store_true")
    args = parser.parse_args(argv)
    if not args.run_reviewed_working_copy:
        print(
            json.dumps(
                {
                    "parentRunOnly": True,
                    "executed": False,
                    "receiptId": RECEIPT,
                    "submissionCap": CAP,
                    "newModelAllowance": False,
                    "modelAccess": False,
                }
            )
        )
        return 0
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
