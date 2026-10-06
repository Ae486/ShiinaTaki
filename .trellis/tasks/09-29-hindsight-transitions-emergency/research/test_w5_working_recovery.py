"""One coherent offline/synthetic working-continuation gate; no real pair access."""

from __future__ import annotations

import copy
import hashlib
import json
import secrets
import socket
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import asyncpg
import pytest
import w5_actual_embedding_control as control
import w5_working_custody as custody
import w5_working_migration as migration

entry = control.load("w5_working_test_entry", "w5-working-recovery.py")


def test_default_and_rejected_options_never_access_pair(capsys) -> None:
    with patch.object(entry, "run_reviewed", side_effect=AssertionError("runtime access")):
        assert entry.main([]) == 0
        assert json.loads(capsys.readouterr().out)["executed"] is False
        for argv in (
            ["--submission-cap", "329"],
            ["--submission-cap", "300"],
            ["--maintenance-approval", "approval.json"],
            ["--stage", "return"],
            ["--reentry-renewal", "old.json"],
            ["--root", "elsewhere"],
        ):
            with pytest.raises(SystemExit):
                entry.main(list(argv))
    assert "torch" not in sys.modules


def test_exact_existing_reentry_wiring_and_zero_permissions(tmp_path: Path) -> None:
    assert entry.old_arguments(None, 301)[1:] == ["run", "--stage", "reentry", "--submission-cap", "301"]
    approval = tmp_path / "reviewed.json"
    assert entry.old_arguments(approval, 350)[-2:] == ["--maintenance-approval", str(approval)]
    control.write_json(tmp_path / "model-submissions.json", {"submitted": 301})
    gate = entry.ReentryGate(
        tmp_path, engine=object(), supervisor_attempt="a" * 32, cumulative_cap=301, approval_path=None
    )
    assert gate.cap == 301 and gate.approval is None and gate.allowance({}, {}) is None
    budget_module = control.load("w5_working_test_budget", "w5-model-budget.py")
    budget = budget_module.ModelSubmissionBudget(tmp_path, {}, cap=301)
    assert budget.state["submitted"] == budget.cap == 301


@pytest.mark.asyncio
async def test_credential_adapter_restores_on_failure(tmp_path: Path) -> None:
    owner = SimpleNamespace(CLONE=tmp_path, PORT=19991, owned_pg=lambda: True)
    connect = AsyncMock(side_effect=RuntimeError("synthetic connect refused"))
    with patch.object(asyncpg, "connect", connect):
        with pytest.raises(RuntimeError, match="synthetic connect refused"):
            await migration.capture(owner, "private-password")
        assert asyncpg.connect is connect
        assert connect.call_args.kwargs["password"] == "private-password"
        assert connect.call_args.kwargs["port"] == 19991


def test_completed_proof_refuses_identity_catalog_and_row_drift(monkeypatch) -> None:
    function = "WHERE id::text IN " * 3 + " ".join(["item->>'unit_id'"] * 9)
    monkeypatch.setattr(migration.rehearsal, "PRE_FUNCTION_HASH", migration.sha(function))
    before = {
        "identity": {"root": "fixture"},
        "catalog": {"columns": ["original"]},
        "state": {
            "revisions": [migration.PREVIOUS],
            "function": function,
            "tables": {"history": {"count": 1, "sha256": "a" * 64}},
            "function_oid": "50",
        },
    }
    after = copy.deepcopy(before)
    after["state"].update(revisions=[migration.CURRENT], function=migration.rehearsal.expected_function(function))
    migration.compare(before, after)
    faults = [
        ("identity", "root", "foreign"),
        ("catalog", "columns", []),
        ("state", "tables", {}),
        ("state", "function_oid", "51"),
        ("state", "function", function),
        ("state", "revisions", [migration.PREVIOUS]),
    ]
    for section, key, value in faults:
        corrupt = copy.deepcopy(after)
        corrupt[section][key] = value
        with pytest.raises(AssertionError):
            migration.compare(before, corrupt)


@pytest.mark.asyncio
async def test_e40_without_proof_and_incomplete_proof_never_migrate(tmp_path: Path) -> None:
    owner = SimpleNamespace(CLONE=tmp_path)
    current = {"state": {"revisions": [migration.CURRENT]}}
    with (
        patch.object(migration, "capture", AsyncMock(return_value=current)),
        patch.object(migration, "upgrade_once") as upgrade,
    ):
        with pytest.raises(AssertionError, match="UNREVIEWED_RUNTIME_REVISION"):
            await migration.migrate_or_verify(owner, "secret", allow_migration=True)
        with pytest.raises(AssertionError, match="APPROVAL_REQUIRES"):
            await migration.migrate_or_verify(owner, "secret", allow_migration=False)
        upgrade.assert_not_called()
        (tmp_path / "working-e40-migration-before.json").write_text("incomplete", encoding="utf-8")
        with patch.object(migration, "validate_before"), pytest.raises(AssertionError, match="INCOMPLETE_MIGRATION"):
            await migration.migrate_or_verify(owner, "secret", allow_migration=True)
        upgrade.assert_not_called()


def test_preflight_derives_bank_from_exact_preparation_and_preserves_recovery(tmp_path: Path) -> None:
    body_hash = hashlib.sha256(b"already applied").hexdigest()
    state = {
        "returnCompleted": True,
        "steps": {
            "return": {"transitionId": custody.RETURN_TRANSITION, "operationId": custody.RETURN_OPERATION},
            "reentry": {"transitionId": custody.TRANSITION, "operationId": "recoverable-operation"},
        },
        "journey": {
            "version": 1,
            "submissions": [],
            "returnAnchor": {
                "receiptId": custody.RETURN_RECEIPT,
                "localEpochId": custody.LOCAL_EPOCH,
                "banks": [{"nativeBankId": "bank-z"}, {"nativeBankId": "bank-a"}],
            },
            "localMutation": {
                "policy": {
                    "expectedRevision": 1,
                    "epochId": custody.LOCAL_EPOCH,
                    "bankId": "local-a",
                    "memoryId": "memory-a",
                },
                "block": {
                    "expectedRevision": 1,
                    "blockId": "profile",
                    "scope": {"kind": "global", "characterId": None},
                },
                "desiredBlockRevision": 2,
                "desiredBlockHash": body_hash,
            },
        },
        "localChanges": {
            "revision": 2,
            "blockRevision": 2,
            "importance": 6,
            "policyVersion": 2,
            "blockContentHash": body_hash,
        },
    }
    payload = json.dumps(state)
    control.write_json(
        tmp_path / "journey-checkpoint.json",
        {"version": 1, "sequence": 1, "payloadJson": payload, "sha256": hashlib.sha256(payload.encode()).hexdigest()},
    )
    db = sqlite3.connect(tmp_path / "application.sqlite")
    try:
        db.executescript(
            "CREATE TABLE memory_transition_intents(transition_id TEXT,intent_json TEXT); "
            "CREATE TABLE memory_operations(operation_id TEXT,state TEXT,producer_json TEXT); "
            "CREATE TABLE memory_transition_receipts(transition_id TEXT,receipt_id TEXT); "
            "CREATE TABLE canonical_memory_units(authority_epoch_id TEXT,bank_id TEXT,memory_id TEXT,revision INT); "
            "CREATE TABLE canonical_memory_policy(authority_epoch_id TEXT,bank_id TEXT,memory_id TEXT,"
            "importance INT,policy_version INT); "
            "CREATE TABLE taki_memory_blocks(block_id TEXT,scope_kind TEXT,character_id TEXT,"
            "revision INT,content TEXT); "
            "CREATE TABLE memory_transition_preparations(transition_id TEXT,body BLOB);"
        )
        request = {
            "request": {
                "kind": "transition.reenter-hindsight",
                "expected": {"predecessorEpochId": custody.LOCAL_EPOCH, "baselineReceiptId": custody.RETURN_RECEIPT},
            }
        }
        db.execute("INSERT INTO memory_transition_intents VALUES(?,?)", (custody.TRANSITION, json.dumps(request)))
        db.execute(
            "INSERT INTO memory_operations VALUES(?,?,?)",
            ("recoverable-operation", "outcome_unknown", json.dumps({"transitionId": custody.TRANSITION})),
        )
        db.execute(
            "INSERT INTO memory_transition_receipts VALUES(?,?)", (custody.RETURN_TRANSITION, custody.RETURN_RECEIPT)
        )
        db.execute("INSERT INTO canonical_memory_units VALUES(?,?,?,2)", (custody.LOCAL_EPOCH, "local-a", "memory-a"))
        db.execute(
            "INSERT INTO canonical_memory_policy VALUES(?,?,?,6,2)", (custody.LOCAL_EPOCH, "local-a", "memory-a")
        )
        db.execute("INSERT INTO taki_memory_blocks VALUES('profile','global',NULL,2,'already applied')")
        prepared = {
            "transitionId": custody.TRANSITION,
            "scope": {"nativeBankId": "bank-a"},
            "request": {"operation_id": custody.DELTA, "request_hash": custody.REQUEST_SHA},
        }
        db.execute(
            "INSERT INTO memory_transition_preparations VALUES(?,?)",
            (custody.TRANSITION, json.dumps(prepared).encode()),
        )
        db.commit()
    finally:
        db.close()
    before = custody.read_core(tmp_path)
    assert before["bankA"] == "bank-a"  # Deliberately not anchor's first Bank.
    after = copy.deepcopy(before)
    after["state"]["journey"]["submissions"].append(
        {"name": "reentry", "request": {"recovery": {"transitionId": custody.TRANSITION}}}
    )
    entry.check_progress(before, after)
    after["state"]["journey"]["submissions"][-1]["request"]["recovery"]["transitionId"] = "foreign"
    with pytest.raises(AssertionError, match="WORKING_NEW_TRANSITION_REFUSED"):
        entry.check_progress(before, after)


def test_start_exception_gets_identity_checked_normal_stop(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(custody, "ROOT", tmp_path)
    data = tmp_path / "data"
    data.mkdir()
    pid = data / "postmaster.pid"
    calls = []

    def command(root, argv, label):
        if label == "start":
            pid.write_text("123\n" + str(data) + "\n1\n18495\n", encoding="utf-8")
            raise OSError("startup ACK lost")
        calls.append((root, argv, label))
        pid.unlink()
        return 0

    old = SimpleNamespace(inspection=SimpleNamespace(command=command, PG_CTL=Path("pg_ctl.exe")))
    owner = custody.WorkingOwner(old)
    with pytest.raises(OSError, match="startup ACK lost"):
        owner.checked_command(tmp_path, ["pg_ctl.exe", "start"], "start")
    handle = Mock()

    def identify():
        owner.process = handle
        return True

    monkeypatch.setattr(owner, "owned_pg", identify)
    monkeypatch.setattr(custody, "port_released", lambda port: True)
    result = owner.settle_and_stop()
    assert result["stopped"] and result["portsReleased"]
    assert len(calls) == 1 and calls[0][1][-6:] == ["-m", "fast", "-w", "-t", "30", "stop"]
    handle.close.assert_called_once()


@pytest.mark.asyncio
async def test_owned_authenticated_postgresql_migration(monkeypatch) -> None:
    """Fresh synthetic cluster, real e30 history, authenticated e40, no models."""
    root = control.RUNTIME / f"w5-working-synthetic-{uuid.uuid4().hex}"
    root.mkdir()
    assert root.parent == control.RUNTIME and root.name.startswith("w5-working-synthetic-")
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    assert port not in {18495, 18496}
    password = secrets.token_urlsafe(24) + "%@:/+"
    pwfile = root / "synthetic-password.txt"
    pwfile.write_text(password + "\n", encoding="utf-8")
    env = control.clean_environment()
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    sys.path.insert(0, str(migration.rehearsal.NATIVE))

    def run(argv):
        # pg_ctl's detached postmaster must not inherit a communicate() PIPE:
        # its open write handle would keep subprocess.run waiting after pg_ctl exits.
        with (root / "commands.log").open("ab") as output:
            result = subprocess.run(
                [str(part) for part in argv],
                env=env,
                stdout=output,
                stderr=output,
                stdin=subprocess.DEVNULL,
                timeout=60,
                creationflags=subprocess.CREATE_NO_WINDOW,
                check=False,
            )
        assert result.returncode == 0, "SYNTHETIC_PG_COMMAND_FAILED"

    async def connect(database="taki_real", supplied=password):
        return await asyncpg.connect(
            host="127.0.0.1", port=port, user="taki_real", password=supplied, database=database, timeout=10
        )

    def owned_pg():
        lines = (root / "data/postmaster.pid").read_text(encoding="utf-8").splitlines()
        assert Path(lines[1]).resolve() == root / "data" and int(lines[3]) == port
        process = control.ProcessIdentity(int(lines[0]))
        try:
            assert isinstance(process.value["executable"], str) and isinstance(process.value["creationTicks"], int)
            assert Path(process.value["executable"]) == control.POSTGRES.resolve()
            assert abs(process.value["creationTicks"] / 10000000 - 11644473600 - int(lines[2])) <= 3
        finally:
            process.close()
        return True

    owner = SimpleNamespace(CLONE=root, PORT=port, owned_pg=owned_pg)
    initialized = False
    passed = False
    try:
        run(
            [
                control.PG_CTL.with_name("initdb.exe"),
                "-D",
                root / "data",
                "-U",
                "taki_real",
                "--auth-host=scram-sha-256",
                "--auth-local=scram-sha-256",
                "--encoding=UTF8",
                "--no-locale",
                f"--pwfile={pwfile}",
            ]
        )
        initialized = True
        pwfile.unlink()
        run(
            [
                control.PG_CTL,
                "-D",
                root / "data",
                "-l",
                root / "postgres.log",
                "-o",
                f"-p {port} -h 127.0.0.1 -c shared_preload_libraries= -c autovacuum=off",
                "-w",
                "-t",
                "30",
                "start",
            ]
        )
        conn = await connect("postgres")
        try:
            await conn.execute("CREATE DATABASE taki_real")
        finally:
            await conn.close()
        conn = await connect()
        try:
            await conn.execute("CREATE EXTENSION vector; CREATE EXTENSION pg_trgm")
        finally:
            await conn.close()
        from alembic import command
        from alembic.config import Config
        from sqlalchemy import URL

        config = Config()
        config.set_main_option("script_location", str(migration.rehearsal.NATIVE / "hindsight_api/alembic"))
        url = URL.create(
            "postgresql",
            username="taki_real",
            password=password,
            host="127.0.0.1",
            port=port,
            database="taki_real",
            query={"connect_timeout": "10", "options": "-c statement_timeout=10000 -c lock_timeout=2000"},
        )
        config.set_main_option("sqlalchemy.url", url.render_as_string(hide_password=False).replace("%", "%%"))
        config.set_main_option("target_schema", "public")
        config.set_main_option("path_separator", "os")
        command.upgrade(config, migration.PREVIOUS)
        conn = await connect()
        try:
            await conn.execute(
                "INSERT INTO banks(bank_id,name) VALUES('synthetic','synthetic'); "
                "CREATE TABLE migration_probe(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, "
                "body bytea NOT NULL CHECK(octet_length(body)>0)); "
                "INSERT INTO migration_probe(body) VALUES(decode('abcdef','hex')); "
                "CREATE VIEW migration_probe_view AS SELECT id FROM migration_probe; "
                "CREATE MATERIALIZED VIEW migration_probe_materialized AS SELECT * FROM migration_probe"
            )
        finally:
            await conn.close()
        with pytest.raises(asyncpg.InvalidPasswordError):
            await migration.capture(owner, "wrong-synthetic-password")
        proof = await migration.bounded_migration(owner, password, allow_migration=True)
        assert proof["migrated"] and migration.load_proof(root)
        conn = await connect()
        try:
            await conn.execute("INSERT INTO migration_probe(body) VALUES(decode('1234','hex'))")
        finally:
            await conn.close()
        reused = await migration.bounded_migration(owner, password, allow_migration=False)
        assert reused["verifiedExistingProof"] and not reused["migrated"]
        conn = await connect()
        try:
            await conn.execute("ALTER TABLE migration_probe ADD COLUMN unauthorized text")
        finally:
            await conn.close()
        with pytest.raises(AssertionError):
            await migration.bounded_migration(owner, password, allow_migration=False)
        passed = True
    finally:
        if initialized and (root / "data/postmaster.pid").exists():
            assert owned_pg()
            run([control.PG_CTL, "-D", root / "data", "-m", "fast", "-w", "-t", "30", "stop"])
        assert not (root / "data/postmaster.pid").exists() and control.port_released(port)
        if pwfile.exists():
            pwfile.unlink()
        control.write_json(
            root / "synthetic-result.json",
            {
                "passed": passed,
                "root": str(root),
                "port": port,
                "stopped": True,
                "portReleased": True,
                "realWorkingPairAccessed": False,
                "authenticatedMigration": passed,
                "proofReuseAndDriftRefusal": passed,
            },
        )
        print(json.dumps({"syntheticEvidence": str(root / "synthetic-result.json"), "passed": passed}))
