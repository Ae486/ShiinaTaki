"""Parent-owned current D91 drill; inert until the completed offline W6 gate.

Only a new copy is started. Product route-b capture/admit and Native backup/restore
own the artifacts; this supervisor owns process lifetime and preserved inputs.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import uuid
from pathlib import Path

from w5_actual_embedding_control import (
    PG_CTL,
    POSTGRES,
    PYTHON,
    ProcessIdentity,
    clean_environment,
    digest,
    port_released,
    write_json,
)
from w5_working_custody import no_link

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "w6_emergency_inputs", HERE / "w6-owned-emergency-runner.py"
)
emergency = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(emergency)
REPO = emergency.REPO
NATIVE = Path("H:/hindsight")
BASE = REPO / ".trellis/.runtime/stage4-w6-restore"
SECONDS = 900


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def native_sources():
    names = (
        subprocess.check_output(
            ["git", "ls-files", "-c", "-o", "--exclude-standard", "-z"], cwd=NATIVE
        )
        .decode()
        .split("\0")
    )
    return [
        {"path": name, "sha256": digest(NATIVE / name)}
        for name in sorted(set(filter(None, names)))
        if (NATIVE / name).is_file()
        and Path(name).suffix in {".py", ".toml", ".lock", ".json", ".yaml"}
    ]


def preflight():
    owner = read_json(emergency.ROOT / "ownership.json")
    assert owner.get("emergencyCompleted") is True and owner["stopped"] is True
    run = Path(owner["emergencyRun"])
    assert run.parent == emergency.ROOT / "emergency-history"
    no_link(run)
    report = read_json(run / "supervisor-result.json")
    assert report["completed"] is True and report["driverStopped"] is True
    for phase in ("emergency", "restart"):
        result = read_json(run / phase / "driver-result.json")
        assert result["completed"] is True
        assert result["additionalDispatch"] == {"native": 0, "transport": 0, "model": 0}
    emergency.verify_preserved_inputs()
    return emergency.input_inventory(emergency.ROOT)


def child(root, name, args, env):
    """One bounded child; retain its original output even on failure/timeout."""
    record = {"phase": name, "stopped": False}
    process = None
    try:
        with (
            (root / f"{name}.stdout.log").open("xb") as out,
            (root / f"{name}.stderr.log").open("xb") as err,
        ):
            process = subprocess.Popen(
                [str(arg) for arg in args],
                cwd=REPO,
                env=env,
                stdout=out,
                stderr=err,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            record["pid"] = process.pid
            write_json(root / f"{name}.process.json", record)
            record["exitCode"] = process.wait(timeout=SECONDS)
            assert record["exitCode"] == 0, "W6_PAIRED_CHILD_FAILED"
    finally:
        try:
            if process is not None and process.poll() is None:
                record["forcedStop"] = True
                process.terminate()
                process.wait(timeout=30)
        finally:
            record["stopped"] = process is None or process.poll() is not None
            write_json(root / f"{name}.process.json", record)


def pg_identity(root, port):
    """Validate the exact owned server before issuing any stop command."""
    no_link(root / "data")
    pid_path = root / "data/postmaster.pid"
    lines = pid_path.read_text(encoding="utf-8").splitlines()
    assert Path(lines[1]).resolve() == root / "data" and int(lines[3]) == port
    handle = ProcessIdentity(int(lines[0]))
    try:
        assert Path(handle.value["executable"]).resolve() == POSTGRES.resolve()
        created = handle.value["creationTicks"] / 10000000 - 11644473600
        assert abs(created - int(lines[2])) <= 3
        assert pid_path.read_text(encoding="utf-8").splitlines() == lines
        return handle
    except BaseException:
        handle.close()
        raise


def pg_start(root, port, env):
    assert not (root / "data/postmaster.pid").exists() and port_released(port)
    # Explicit clone-local config ignores inherited includes and external paths.
    (root / "data/postgresql.auto.conf").write_text(
        "# Owned restore copy.\n", encoding="utf-8"
    )
    (root / "pg_hba.conf").write_text(
        "host taki_real taki_real 127.0.0.1/32 trust\n"
        "host all all 127.0.0.1/32 reject\n",
        encoding="utf-8",
    )
    (root / "pg_ident.conf").write_text("", encoding="utf-8")
    (root / "postgresql.conf").write_text(
        "autovacuum=off\nlogging_collector=off\n", encoding="utf-8"
    )
    options = (
        f'-p {port} -h 127.0.0.1 -c config_file="{root.as_posix()}/postgresql.conf" '
        f'-c data_directory="{root.as_posix()}/data" '
        f'-c hba_file="{root.as_posix()}/pg_hba.conf" '
        f'-c ident_file="{root.as_posix()}/pg_ident.conf" '
        "-c shared_preload_libraries= -c lc_messages=C"
    )
    child(
        root,
        "pg-start",
        [
            PG_CTL,
            "-D",
            root / "data",
            "-l",
            root / "postgres.log",
            "-o",
            options,
            "-w",
            "-t",
            "30",
            "start",
        ],
        env,
    )
    handle = pg_identity(root, port)
    try:
        write_json(root / "postgres-process.json", handle.value)
    finally:
        handle.close()


def pg_stop(root, port, env):
    if not (root / "data/postmaster.pid").exists():
        assert port_released(port), "W6_PAIRED_PORT_NOT_RELEASED"
        return
    handle = pg_identity(root, port)
    try:
        recorded = root / "postgres-process.json"
        if recorded.exists():
            assert handle.value == read_json(recorded), "W6_PAIRED_POSTGRES_REPLACED"
        child(
            root,
            "pg-stop",
            [PG_CTL, "-D", root / "data", "-m", "fast", "-w", "-t", "30", "stop"],
            env,
        )
        assert not (root / "data/postmaster.pid").exists() and port_released(port)
    finally:
        handle.close()


def phases(root, report, env):
    plan = {
        "ownedRoot": str(root),
        "coreStopped": True,
        "coreDataDir": str(root / "core"),
        "coreDbPath": str(root / "core/taki.db"),
        "expectedCoreSha256": emergency.CORE_SHA,
        "initializeOwnedFixtureCustody": True,
        "connectionEnv": {
            "TAKI_HINDSIGHT_ENABLED": "true",
            "TAKI_HINDSIGHT_DEPLOYMENT_MODE": "existing-instance",
            "TAKI_HINDSIGHT_ENDPOINT": "http://127.0.0.1:18496",
            "TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS": "60000",
            "TAKI_HINDSIGHT_SETUP_TIMEOUT_MS": "120000",
        },
    }
    plan_path = root / "capture-plan.json"
    write_json(plan_path, plan)
    capture = HERE / "w6-paired-core-capture.mjs"
    child(
        root,
        "core-stage",
        [
            emergency.NODE,
            capture,
            "--run-owned-pair",
            "--plan",
            plan_path,
            "--phase",
            "stage",
        ],
        env,
    )
    stage = read_json(root / "stage-result.json")
    assert stage["completed"] is True and stage["stopped"] is True
    report["stageCompleted"] = True
    write_json(root / "supervisor-result.json", report)
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    report["pgPort"] = port
    write_json(root / "supervisor-result.json", report)
    native_env = {
        **env,
        "PYTHONPATH": str(NATIVE / "hindsight-api-slim"),
        "HINDSIGHT_API_LLM_PROVIDER": "mock",
        "LITELLM_LOCAL_MODEL_COST_MAP": "True",
    }
    try:
        pg_start(root, port, native_env)
        url_file = root / "database-url.txt"
        url_file.write_text(
            f"postgresql://taki_real@127.0.0.1:{port}/taki_real", encoding="utf-8"
        )
        native_plan = {
            "ownedRoot": str(root),
            "coreStopped": True,
            "databaseUrlFile": str(url_file),
            "sourceSchema": "public",
            "nativeRequestPath": stage["nativeRequestPath"],
        }
        write_json(root / "native-plan.json", native_plan)
        child(
            root,
            "native-restore",
            [
                PYTHON,
                "-X",
                "utf8",
                "-B",
                "-s",
                HERE / "w6-paired-native-restore.py",
                "--run-owned-restore",
                "--plan",
                root / "native-plan.json",
            ],
            native_env,
        )
    finally:
        pg_stop(root, port, native_env)
        report["pgStopped"] = True
        write_json(root / "supervisor-result.json", report)
    native = read_json(root / "native-restore-result.json")
    assert native["completed"] is True and native["sourceUnchanged"] is True
    plan.update(
        nativeResultPath=str(root / "native-restore-result.json"),
        nativeArchivePath=str(root / "native.zip"),
        initializeOwnedFixtureCustody=False,
    )
    write_json(root / "seal-plan.json", plan)
    child(
        root,
        "core-seal",
        [
            emergency.NODE,
            capture,
            "--run-owned-pair",
            "--plan",
            root / "seal-plan.json",
            "--phase",
            "seal",
        ],
        env,
    )
    sealed = read_json(root / "seal-result.json")
    assert sealed["completed"] is True and sealed["stopped"] is True
    plan.update(pairDir=sealed["pairDir"], custodyDataDir=str(root / "core"))
    write_json(root / "preflight-plan.json", plan)
    child(
        root,
        "core-preflight",
        [
            emergency.NODE,
            HERE / "w6-paired-core-restore.mjs",
            "--run-owned-preflight",
            "--plan",
            root / "preflight-plan.json",
        ],
        env,
    )
    assert read_json(root / "core-restore-preflight.json")["completed"] is True
    report.update(
        completed=True, backupId=stage["backupId"], tableCount=native["tableCount"]
    )


def run():
    expected = preflight()
    # A retained pointer prohibits a blind new attempt after partial success/failure.
    pointer = emergency.ROOT / "paired-restore-ownership.json"
    with pointer.open("x", encoding="utf-8") as stream:
        json.dump({"preparing": True}, stream)
    BASE.mkdir(exist_ok=True)
    no_link(BASE)
    root = BASE / uuid.uuid4().hex
    root.mkdir()
    write_json(pointer, {"ownedRoot": str(root), "started": True})
    report = {
        "version": 1,
        "ownedRoot": str(root),
        "completed": False,
        "pgStopped": True,
        "fixtureCredentialCustody": True,
        "externalCredentialsRead": False,
        "modelAllowance": False,
        "conversionExecuted": False,
    }
    sources, native = emergency.source_inventory(), native_sources()
    write_json(root / "source-files.json", {"taki": sources, "native": native})
    env = clean_environment()
    try:
        shutil.copytree(emergency.ROOT / "data", root / "data")
        shutil.copy2(emergency.ROOT / "application.sqlite", root / "application.sqlite")
        assert emergency.input_inventory(root) == expected, "W6_PAIRED_COPY_MISMATCH"
        (root / "core").mkdir()
        shutil.copy2(root / "application.sqlite", root / "core/taki.db")
        credentials = root / "credentials"
        credentials.mkdir()
        with (credentials / "taki-secret-catalog-master-key").open("xb") as key:
            key.write(secrets.token_bytes(32))
        env["TAKI_CREDENTIALS_DIRECTORY"] = str(credentials)
        write_json(root / "supervisor-result.json", report)
        phases(root, report, env)
    except BaseException as error:
        report["errorClass"] = type(error).__name__
        report["completed"] = False
        raise
    finally:
        try:
            emergency.verify_preserved_inputs()
            report["inputsPreserved"] = True
            assert (
                emergency.source_inventory() == sources and native_sources() == native
            )
            report["sourcesPreserved"] = True
        except BaseException as error:
            report.update(completed=False, preservationErrorClass=type(error).__name__)
            raise
        finally:
            report["pgStopped"] = not (root / "data/postmaster.pid").exists() and (
                "pgPort" not in report or port_released(report["pgPort"])
            )
            if not report["pgStopped"]:
                report["completed"] = False
            write_json(root / "supervisor-result.json", report)
            write_json(pointer, report)
            print(
                json.dumps(
                    {
                        "report": str(root / "supervisor-result.json"),
                        "completed": report["completed"],
                    }
                )
            )
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-paired-restore", action="store_true")
    if not parser.parse_args(argv).run_reviewed_paired_restore:
        print(json.dumps({"executed": False, "completed": False}))
        return 0
    return run()


if __name__ == "__main__":
    sys.exit(main())
