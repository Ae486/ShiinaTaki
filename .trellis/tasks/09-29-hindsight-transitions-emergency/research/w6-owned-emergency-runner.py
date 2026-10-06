"""Parent-only supervision of the prepared W6 offline emergency/restart driver.

Import and the default CLI are inert. This does not prepare another corpus copy,
start Native, restore a database, supply credentials, or retry a failed run.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from w5_actual_embedding_control import clean_environment, digest, write_json
from w5_working_custody import ROOT as PREDECESSOR
from w5_working_custody import no_link, stopped

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ROOT = REPO / ".trellis/.runtime/stage4-w6/db280d150f6340618b340a70439b43f7"
NODE = Path("C:/Program Files/nodejs/node.exe")
DRIVER = HERE / "w6-owned-emergency-driver.mjs"
CORE_SHA = "274e1ccbd651bcd8c64f88f7ceb0d80c56a3701e5a5a62309369cbfbd0235a45"
INPUT_MANIFEST_SHA = "0e5fc2cc07fd30461da4754afe4021cbaeee70223920f5e9e910db818c2ae4f4"
# An execution timeout is a retained failed drill, never permission to re-run it.
DRIVER_SECONDS = 900


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def input_inventory(root: Path) -> list[dict]:
    """Hash complete stopped inputs; reject aliases and extra/missing PG files."""
    no_link(root)
    files = [root / "application.sqlite"]
    for name in ("data", "prompt"):
        parent = root / name
        if parent.exists():
            no_link(parent)
            for path in parent.rglob("*"):
                no_link(path)
                if path.is_file():
                    files.append(path)
    rows = []
    for path in sorted(files):
        no_link(path)
        rows.append(
            {
                "path": path.relative_to(root).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": digest(path),
            }
        )
    return rows


def verify_preserved_inputs() -> list[dict]:
    stopped()
    manifest = ROOT / "source-files.json"
    no_link(manifest)
    assert digest(manifest) == INPUT_MANIFEST_SHA, "W6_INPUT_MANIFEST_DRIFT"
    expected = read_json(manifest)
    paths = [PurePosixPath(row["path"]) for row in expected]
    assert len(set(paths)) == len(paths) and all(
        not p.is_absolute() and ".." not in p.parts for p in paths
    )
    assert input_inventory(PREDECESSOR) == expected, "W6_PREDECESSOR_CHANGED"
    assert input_inventory(ROOT) == expected, "W6_PREPARED_INPUT_CHANGED"
    return expected


def source_inventory() -> list[dict]:
    """Freeze the current runtime/driver inputs, not the superseded W5 code manifest."""
    names = (
        subprocess.check_output(
            [
                "git",
                "ls-files",
                "-c",
                "-o",
                "--exclude-standard",
                "-z",
                "--",
                "packages",
                "pnpm-lock.yaml",
                "package.json",
                "pnpm-workspace.yaml",
                "tsconfig.json",
                str(HERE.relative_to(REPO)),
            ],
            cwd=REPO,
        )
        .decode("utf-8")
        .split("\0")
    )
    rows = []
    for name in sorted(set(filter(None, names))):
        path = REPO / name
        # Progress notes and logs are not runtime inputs. Keeping them outside
        # this set lets the leader record a running attempt without code drift.
        if path.suffix not in {
            ".ts",
            ".tsx",
            ".js",
            ".mjs",
            ".cjs",
            ".py",
            ".json",
            ".yaml",
        }:
            continue
        if path.is_file():
            no_link(path)
            rows.append(
                {
                    "path": name.replace("\\", "/"),
                    "bytes": path.stat().st_size,
                    "sha256": digest(path),
                }
            )
    assert any(row["path"] == DRIVER.relative_to(REPO).as_posix() for row in rows), (
        "W6_DRIVER_NOT_IN_SOURCE_SET"
    )
    return rows


def preflight() -> dict:
    no_link(ROOT)
    no_link(ROOT / "ownership.json")
    owner = read_json(ROOT / "ownership.json")
    assert owner["kind"] == "w6-private-pair" and Path(owner["root"]) == ROOT
    assert (
        Path(owner["source"]) == PREDECESSOR and owner["sourceCoreSha256"] == CORE_SHA
    )
    assert (
        owner["prepared"] is True
        and owner["started"] is False
        and owner["stopped"] is True
    )
    assert owner["manifestSha256"] == INPUT_MANIFEST_SHA
    no_link(ROOT / "core-layout.json")
    layout = read_json(ROOT / "core-layout.json")
    assert (
        Path(layout["coreDataDir"]) == ROOT / "core"
        and Path(layout["coreDbPath"]) == ROOT / "core/taki.db"
    )
    assert Path(layout["nativePgData"]) == ROOT / "data"
    assert Path(layout["preservedCoreInput"]) == ROOT / "application.sqlite"
    no_link(ROOT / "core/taki.db")
    assert digest(ROOT / "core/taki.db") == CORE_SHA, "W6_WORKING_CORE_CHANGED"
    assert not any(
        (ROOT / f"core/taki.db{suffix}").exists()
        for suffix in ("-wal", "-shm", "-journal")
    ), "W6_CORE_NOT_STOPPED"
    assert not (ROOT / "data/postmaster.pid").exists(), "W6_NATIVE_ALREADY_RUNNING"
    history = ROOT / "emergency-history"
    if history.exists():
        no_link(history)
        assert not any(history.iterdir()), "W6_PREVIOUS_EXECUTION_REQUIRES_REVIEW"
    no_link(DRIVER)
    no_link(NODE)
    verify_preserved_inputs()
    return owner


def command(result_path: Path, phase: str) -> list[str]:
    return [
        str(NODE),
        str(DRIVER),
        "--run-owned-copy",
        "--core-data-dir",
        str(ROOT / "core"),
        "--core-db-path",
        str(ROOT / "core/taki.db"),
        "--result-path",
        str(result_path),
        "--phase",
        phase,
    ]


def execute_driver(directory: Path, report: dict) -> None:
    """Own one child handle and retain WAL/logs when its execution fails."""
    process = None
    try:
        with (
            (directory / "stdout.log").open("xb") as out,
            (directory / "stderr.log").open("xb") as err,
        ):
            process = subprocess.Popen(
                command(directory / "driver-result.json", report["phase"]),
                cwd=REPO,
                env=clean_environment(),
                stdout=out,
                stderr=err,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            report["driverPid"] = process.pid
            report["driverStopped"] = False
            write_json(directory / "supervisor-result.json", report)
            report["driverExitCode"] = process.wait(timeout=DRIVER_SECONDS)
    finally:
        try:
            if process is not None and process.poll() is None:
                report["driverForcedStop"] = True
                process.terminate()
                process.wait(timeout=30)
        finally:
            report["driverStopped"] = process is None or process.poll() is not None


def execute_phase(directory: Path, report: dict, sources: list[dict]) -> None:
    """Start a fresh process only after the preceding phase fully stopped."""
    directory.mkdir()
    phase = {
        "phase": directory.name,
        "completed": False,
        "driverStopped": True,
        "driverForcedStop": False,
        "driverExitCode": None,
        "coreBeforeSha256": digest(ROOT / "core/taki.db"),
    }
    report["phases"].append(phase)
    report["driverStopped"] = False
    write_json(directory.parent / "supervisor-result.json", report)
    try:
        execute_driver(directory, phase)
        assert phase["driverExitCode"] == 0, "W6_DRIVER_FAILED"
        result = directory / "driver-result.json"
        no_link(result)
        phase["driverResultSha256"] = digest(result)
        assert read_json(result).get("completed") is True, "W6_DRIVER_INCOMPLETE"
        assert not any(
            (ROOT / f"core/taki.db{suffix}").exists()
            for suffix in ("-wal", "-shm", "-journal")
        ), "W6_CORE_NOT_STOPPED"
        assert source_inventory() == sources, "W6_EXECUTION_SOURCE_DRIFT"
        verify_preserved_inputs()
        phase["coreAfterSha256"] = digest(ROOT / "core/taki.db")
        if phase["phase"] == "emergency":
            checkpoint = ROOT / "core/w6-emergency-checkpoint.json"
            no_link(checkpoint)
            # Keep the original stopping-point evidence independently of any
            # later recovery report. The driver owns its schema and identity join.
            (directory / "checkpoint.json").write_bytes(checkpoint.read_bytes())
            phase["checkpointSha256"] = digest(directory / "checkpoint.json")
        phase["completed"] = True
    except BaseException as error:
        phase["errorClass"] = type(error).__name__
        raise
    finally:
        report.update(
            driverStopped=phase["driverStopped"],
            driverForcedStop=report["driverForcedStop"] or phase["driverForcedStop"],
            driverExitCode=phase["driverExitCode"],
        )
        write_json(directory / "supervisor-result.json", phase)
        write_json(directory.parent / "supervisor-result.json", report)


def run() -> int:
    # The lock is create-only and is acquired before any input is opened. A stale
    # lock is an explicit review boundary; this script never guesses it is safe.
    no_link(ROOT)
    lock = ROOT / "emergency-supervisor.lock"
    with lock.open("x", encoding="utf-8") as handle:
        handle.write(str(os.getpid()))
    directory = None
    owner = None
    report = {
        "version": 1,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "completed": False,
        "driverStopped": True,
        "driverForcedStop": False,
        "driverExitCode": None,
        "startsNative": False,
        "modelAllowance": False,
        "phases": [],
    }
    try:
        owner = preflight()
        sources = source_inventory()
        directory = ROOT / "emergency-history" / uuid.uuid4().hex
        directory.mkdir(parents=True)
        write_json(directory / "source-files.json", sources)
        report["sourceManifestSha256"] = digest(directory / "source-files.json")
        report["coreBeforeSha256"] = digest(ROOT / "core/taki.db")
        owner.update(started=True, stopped=False, emergencyRun=str(directory))
        write_json(ROOT / "ownership.json", owner)
        write_json(directory / "supervisor-result.json", report)
        execute_phase(directory / "emergency", report, sources)
        execute_phase(directory / "restart", report, sources)
        report["completed"] = True
    except BaseException as error:
        report["errorClass"] = type(error).__name__
        raise
    finally:
        try:
            if directory is not None:
                try:
                    verify_preserved_inputs()
                    report["preservedInputsVerified"] = True
                    assert source_inventory() == sources, "W6_EXECUTION_SOURCE_DRIFT"
                    report["sourcesPreserved"] = True
                    report["coreAfterSha256"] = digest(ROOT / "core/taki.db")
                except BaseException as error:
                    report["completed"] = False
                    report["preservationErrorClass"] = type(error).__name__
                    raise
                finally:
                    report["endedAt"] = datetime.now(timezone.utc).isoformat()
                    write_json(directory / "supervisor-result.json", report)
                    if owner is not None:
                        owner.update(
                            stopped=report["driverStopped"],
                            emergencyCompleted=report["completed"],
                        )
                        write_json(ROOT / "ownership.json", owner)
                    print(
                        json.dumps(
                            {
                                "report": str(directory / "supervisor-result.json"),
                                "completed": report["completed"],
                            }
                        )
                    )
        finally:
            if report["driverStopped"]:
                # Only this exact create-owned file is removed; incident/data
                # directories and failed execution evidence always remain.
                no_link(lock)
                lock.unlink()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-emergency", action="store_true")
    if not parser.parse_args(argv).run_reviewed_emergency:
        print(
            json.dumps(
                {
                    "executed": False,
                    "parentRunOnly": True,
                    "startsNative": False,
                    "modelAllowance": False,
                }
            )
        )
        return 0
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
