"""Owned synthetic PostgreSQL startup probe; no corpus or model imports/execution."""

from __future__ import annotations

import argparse
import ast
import os
import socket
import subprocess
import time
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import w5_actual_embedding_control as control

EVIDENCE = control.HERE / "w5-http-environment-checks"


def synthetic_cluster() -> SimpleNamespace:
    root = control.RUNTIME / f"w5-candidate-native-clone-http-env-{uuid.uuid4().hex}"
    assert root.resolve().parent == control.RUNTIME.resolve() and not root.exists()
    root.mkdir()
    with socket.socket() as reservation:
        reservation.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    assert port not in {18495, 18496}
    pointer = {
        "clone": str(root),
        "data": str(root / "data"),
        "port": port,
        "postgres": str(control.POSTGRES.resolve()),
    }
    control.write_json(
        root / "ownership.json",
        {
            "kind": "candidate-diagnostic-clone",
            "data": pointer["data"],
            "port": port,
            "stopped": True,
            "syntheticEmptyFixture": True,
        },
    )
    control.validate_pointer(pointer)
    init = subprocess.run(
        [
            str(control.PG_CTL.with_name("initdb.exe")),
            "-D",
            pointer["data"],
            "--username=taki_env_fixture",
            "--auth=trust",
            "--encoding=UTF8",
            "--no-locale",
        ],
        cwd=root,
        env=control.clean_environment(),
        capture_output=True,
        timeout=60,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    control.write_json(
        root / "initdb.json",
        {
            "exitCode": init.returncode,
            "stdout": init.stdout.decode("utf-8", errors="replace"),
            "stderr": init.stderr.decode("utf-8", errors="replace"),
        },
    )
    assert init.returncode == 0, "SYNTHETIC_INITDB_FAILED"
    (root / "postgresql.conf").write_text(
        "password_encryption='scram-sha-256'\nautovacuum=off\nlogging_collector=off\n",
        encoding="utf-8",
    )
    (root / "pg_hba.conf").write_text(
        "host all taki_env_fixture 127.0.0.1/32 trust\nhost all all 127.0.0.1/32 reject\n",
        encoding="utf-8",
    )
    (root / "pg_ident.conf").write_text("", encoding="utf-8")
    options = (
        f'-p {port} -h 127.0.0.1 -c config_file="{root.as_posix()}/postgresql.conf" '
        f'-c data_directory="{root.as_posix()}/data" -c hba_file="{root.as_posix()}/pg_hba.conf" '
        f'-c ident_file="{root.as_posix()}/pg_ident.conf" -c shared_preload_libraries= -c lc_messages=C'
    )
    arguments = [
        "-D",
        str(root / "data"),
        "-l",
        str(root / "postgres.log"),
        "-o",
        options,
        "-w",
        "-t",
        "30",
        "start",
    ]
    return SimpleNamespace(root=root, pointer=pointer, arguments=arguments)


def original_command(cluster: SimpleNamespace):
    # Compile only the exact frozen command function; importing its whole module
    # would transitively load real-corpus helpers that this probe must not use.
    path = control.HERE / "w5-reentry-candidate-native-clone.py"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    definition = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "pg_command"
    )
    namespace = {
        "CLONE": cluster.root,
        "REPO": control.HERE.parents[3],
        "subprocess": subprocess,
        "owner": SimpleNamespace(inspection=SimpleNamespace(PG_CTL=control.PG_CTL)),
    }
    exec(
        compile(ast.Module(body=[definition], type_ignores=[]), str(path), "exec"),
        namespace,
    )
    return namespace["pg_command"]


def run_case(cluster: SimpleNamespace, name: str, environment: dict[str, str]) -> dict:
    command = original_command(cluster)
    started = time.monotonic()
    with patch.dict(os.environ, environment, clear=True):
        version = subprocess.run(
            [str(control.PG_CTL), "--version"],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        code = command(cluster.arguments, name)
    identity = control.owned_pg(cluster.pointer)
    if identity is not None:
        identity.close()
    value = {
        "name": name,
        "environmentKeys": sorted(environment),
        "versionExitCode": version.returncode,
        "startExitCode": code,
        "startExitHex": f"0x{code & 0xFFFFFFFF:08x}",
        "ownedPostgresLive": identity is not None,
        "commandLogBytes": (cluster.root / f"{name}.log").stat().st_size,
        "postgresLogExists": (cluster.root / "postgres.log").exists(),
        "milliseconds": (time.monotonic() - started) * 1000,
    }
    value["cleanup"] = control.cleanup_pg(cluster.pointer)
    assert value["cleanup"]["stopped"] and value["cleanup"]["portReleased"]
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-synthetic", action="store_true")
    args = parser.parse_args()
    if not args.run_synthetic:
        print("executed=false; owned synthetic PG startup only")
        return
    EVIDENCE.mkdir(exist_ok=True)
    cluster = synthetic_cluster()
    evidence = {"root": str(cluster.root), "pointer": cluster.pointer, "cases": []}
    try:
        environment = control.clean_environment()
        # This is the environment emitted by the buggy ordering; it is not the
        # inherited environment used to launch this probe or initialize the DB.
        from w5_http_composition import SETTINGS

        emptied = {
            **control.OFFLINE,
            "HF_TOKEN_PATH": str(cluster.root / "missing-token"),
            **SETTINGS,
        }
        evidence["cases"].append(run_case(cluster, "lost-windows-environment", emptied))
        evidence["cases"].append(
            run_case(
                cluster, "retained-windows-environment", {**environment, **SETTINGS}
            )
        )
    finally:
        evidence["cleanup"] = control.cleanup_pg(cluster.pointer)
        control.write_json(EVIDENCE / "startup-reproduction.json", evidence)
    print(evidence)


if __name__ == "__main__":
    main()
