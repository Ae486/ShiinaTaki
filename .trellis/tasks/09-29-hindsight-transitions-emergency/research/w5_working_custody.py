"""Narrow custody/preflight for the existing W5 pair. No actions at import."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from w5_actual_embedding_control import ProcessIdentity, port_released
from w5_reentry_gate import read_checkpoint

BASE = Path("H:/TakiAgent/.trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90")
ROOT = BASE / "w5-healthy-a7ffc67a1666400b8cc7e890d837cb97"
SOURCE = BASE / "application-ad325c12054d4d92b91a81ad2b18fee1"
CORE_SHA = "5f12a7385d6b1fa97bcd98fc1a529a891660f76fa053792ea213519109b5ceb3"
TRANSITION = "6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53"
DELTA = "6497dfc9-e287-4cb1-96b5-1020ea1eabc4"
REQUEST_SHA = "946b0a8228df74206a91ea4154e34d6592082e5afae2c069a71846e8e301b8d7"
RETURN_TRANSITION = "df47f32c-48a8-47bc-9792-2e24e8642084"
RETURN_OPERATION = "ce841c61-d207-4f51-b1fd-51cd42ed9d9e"
RETURN_RECEIPT = "e173dffd3612e5932f50a1df5ae7c1c1b4f7ee3d269dce9a11828debd77a8469"
LOCAL_EPOCH = "afb2053e-8bcd-4322-8573-0a447d560bb8"


def no_link(path: Path) -> None:
    for item in (path, *path.parents):
        stat = item.lstat()
        assert not item.is_symlink() and not getattr(stat, "st_file_attributes", 0) & 0x400, "WORKING_LINK_REFUSED"
    assert path.resolve(strict=True) == path.absolute(), "WORKING_PATH_REFUSED"
    if path.is_file():
        assert path.stat().st_nlink == 1, "WORKING_HARDLINK_REFUSED"


def require_root() -> None:
    # Lexical inspection precedes resolve and existence prevents old prepare's
    # fresh-copy branch. Never accept a CLI root, port or DSN override.
    no_link(ROOT)
    for name in ("data", "application.sqlite", "ownership.json", "journey-checkpoint.json", "model-submissions.json"):
        no_link(ROOT / name)
    for path in (ROOT / "data").rglob("*"):
        no_link(path)


def stopped() -> None:
    owner = json.loads((ROOT / "ownership.json").read_text(encoding="utf-8"))
    assert Path(owner["root"]) == ROOT and Path(owner["source"]) == SOURCE and owner["stopped"] is True
    assert owner["pgPort"] == 18495 and owner["httpPort"] == 18496
    assert not (ROOT / "data/postmaster.pid").exists(), "WORKING_PG_ALREADY_RUNNING"
    assert port_released(18495) and port_released(18496), "WORKING_PORT_IN_USE"


def read_core(root: Path = ROOT, *, after: bool = False) -> dict:
    state = read_checkpoint(root / "journey-checkpoint.json")
    assert state.get("returnCompleted") is True and state.get("conversionRequests", 0) == 0
    assert state["steps"]["return"]["transitionId"] == RETURN_TRANSITION
    assert state["steps"]["return"]["operationId"] == RETURN_OPERATION
    assert state["steps"]["reentry"]["transitionId"] == TRANSITION
    if not after:
        assert not state.get("completed"), "WORKING_REENTRY_ALREADY_COMPLETED"
    anchor = state["journey"]["returnAnchor"]
    assert anchor["receiptId"] == RETURN_RECEIPT and anchor["localEpochId"] == LOCAL_EPOCH
    plan = state["journey"]["localMutation"]
    effects = state["localChanges"]
    assert effects["revision"] == effects["blockRevision"] == 2
    assert plan["policy"]["expectedRevision"] == plan["block"]["expectedRevision"] == 1
    assert plan["desiredBlockRevision"] == 2 and plan["policy"]["epochId"] == LOCAL_EPOCH
    # Parent starts/stops the only SQLite writer. Immutable read avoids even SHM
    # creation; a remaining WAL is a stop/review boundary, never ignored content.
    wal = root / "application.sqlite-wal"
    assert not wal.exists() or wal.stat().st_size == 0, "WORKING_CORE_WAL_UNSETTLED"
    db = sqlite3.connect((root / "application.sqlite").as_uri() + "?mode=ro&immutable=1", uri=True)
    db.row_factory = sqlite3.Row
    try:
        intent = db.execute(
            "SELECT intent_json FROM memory_transition_intents WHERE transition_id=?", (TRANSITION,)
        ).fetchone()
        assert intent, "WORKING_REENTRY_NOT_ADMITTED"
        request = json.loads(intent[0])["request"]
        assert (
            request["kind"] == "transition.reenter-hindsight"
            and request["expected"]["predecessorEpochId"] == LOCAL_EPOCH
        )
        assert request["expected"]["baselineReceiptId"] == RETURN_RECEIPT
        operation = db.execute(
            "SELECT state,producer_json FROM memory_operations WHERE operation_id=?",
            (state["steps"]["reentry"]["operationId"],),
        ).fetchone()
        assert operation and operation["state"] in ({"completed", "outcome_unknown"} if after else {"outcome_unknown"})
        assert json.loads(operation["producer_json"])["transitionId"] == TRANSITION
        returned = db.execute(
            "SELECT receipt_id FROM memory_transition_receipts WHERE transition_id=?", (RETURN_TRANSITION,)
        ).fetchone()
        assert returned and returned[0] == RETURN_RECEIPT
        if not after:
            assert (
                db.execute("SELECT 1 FROM memory_transition_receipts WHERE transition_id=?", (TRANSITION,)).fetchone()
                is None
            )
        unit = db.execute(
            "SELECT u.revision,p.importance,p.policy_version FROM canonical_memory_units u "
            "JOIN canonical_memory_policy p USING(authority_epoch_id,bank_id,memory_id) "
            "WHERE u.authority_epoch_id=? AND u.bank_id=? AND u.memory_id=?",
            (LOCAL_EPOCH, plan["policy"]["bankId"], plan["policy"]["memoryId"]),
        ).fetchone()
        assert unit and unit["revision"] == 2 and unit["importance"] == effects["importance"]
        assert unit["policy_version"] == effects["policyVersion"]
        block = db.execute(
            "SELECT revision,content FROM taki_memory_blocks WHERE block_id=? AND scope_kind=? "
            "AND ifnull(character_id,'')=ifnull(?,'')",
            (plan["block"]["blockId"], plan["block"]["scope"]["kind"], plan["block"]["scope"]["characterId"]),
        ).fetchone()
        assert block and block["revision"] == 2
        assert (
            hashlib.sha256(block["content"].encode()).hexdigest()
            == plan["desiredBlockHash"]
            == effects["blockContentHash"]
        )
        preparations = [
            json.loads(row[0])
            for row in db.execute(
                "SELECT body FROM memory_transition_preparations WHERE transition_id=?", (TRANSITION,)
            )
        ]
        matches = [row for row in preparations if row["request"]["operation_id"] == DELTA]
        assert len(matches) == 1 and matches[0]["request"]["request_hash"] == REQUEST_SHA, "WORKING_DELTA_CHANGED"
        bank = matches[0]["scope"]["nativeBankId"]
        assert matches[0]["transitionId"] == TRANSITION
        assert any(row["nativeBankId"] == bank for row in anchor["banks"])
        return {
            "state": state,
            "bankA": bank,
            "preparationSha256": hashlib.sha256(json.dumps(matches[0], sort_keys=True).encode()).hexdigest(),
        }
    finally:
        db.close()


class WorkingOwner:
    """Old main owns lifecycle; this object verifies its exact PostgreSQL process."""

    CLONE = ROOT
    PORT = 18495

    def __init__(self, old: Any):
        self.old = old
        self.started_at: float | None = None
        self.process: Any = None
        self.command = old.inspection.command

    def owned_pg(self) -> bool:
        pidfile = ROOT / "data/postmaster.pid"
        no_link(pidfile)
        lines = pidfile.read_text(encoding="utf-8").splitlines()
        assert len(lines) >= 4 and Path(lines[1]).resolve() == ROOT / "data"
        assert int(lines[3]) == self.PORT, "WORKING_PG_PORT_CHANGED"
        process = ProcessIdentity(int(lines[0]))
        try:
            assert isinstance(process.value["executable"], str) and isinstance(process.value["creationTicks"], int)
            assert Path(process.value["executable"]) == self.old.inspection.PG_CTL.with_name("postgres.exe").resolve()
            created = process.value["creationTicks"] / 10000000 - 11644473600
            assert abs(created - int(lines[2])) <= 3, "WORKING_PG_PID_REUSED"
            assert self.started_at is not None and created >= self.started_at - 3, "WORKING_PG_PREEXISTED"
            if self.process is not None:
                assert self.process.value == process.value, "WORKING_PG_REPLACED"
            assert pidfile.read_text(encoding="utf-8").splitlines() == lines
            if self.process is None:
                self.process = process
            return True
        finally:
            if process is not self.process:
                process.close()

    def checked_command(self, root: Path, args: list, label: str) -> int:
        if root == ROOT and label == "start":
            assert self.started_at is None and not (ROOT / "data/postmaster.pid").exists()
            self.started_at = time.time()
        if root == ROOT and label == "stop":
            assert self.owned_pg()
        return self.command(root, args, label)

    def settle_and_stop(self) -> dict:
        """Cover old main's start-exception gap using normal fast-stop only.

        pg_ctl can return/throw before a launched server has published its PID.
        Allow the original 30s start plus a 15s settle window, without starting a
        second server or terminating a guessed PID. No immediate-stop fallback.
        """
        if self.started_at is None:
            return {"started": False, "stopped": True, "portsReleased": True}
        pidfile = ROOT / "data/postmaster.pid"
        try:
            while self.process is None and time.time() - self.started_at < 45:
                if pidfile.exists() and len(pidfile.read_text(encoding="utf-8").splitlines()) >= 4:
                    self.owned_pg()
                    break
                time.sleep(0.1)
            if pidfile.exists():
                assert self.owned_pg()
                assert (
                    self.command(
                        ROOT,
                        [
                            str(self.old.inspection.PG_CTL),
                            "-D",
                            str(ROOT / "data"),
                            "-m",
                            "fast",
                            "-w",
                            "-t",
                            "30",
                            "stop",
                        ],
                        "working-final-stop",
                    )
                    == 0
                )
            assert not pidfile.exists() and port_released(18495) and port_released(18496), "WORKING_CLEANUP_INCOMPLETE"
            return {"started": True, "stopped": True, "portsReleased": True}
        finally:
            if self.process is not None:
                self.process.close()
