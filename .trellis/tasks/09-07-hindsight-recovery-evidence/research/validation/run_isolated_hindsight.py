"""Run deterministic Hindsight checks against an owned pg0 database and clean environment.

This task-local harness never reads repository .env files or accepts an existing database URL.
PostgreSQL data and its pg0 registry entry are removed only after the PowerShell guard verifies
the exact owned instance is stopped. Logs remain in ignored .trellis/.runtime for review.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class Fixture:
    name: str
    root: str
    registry: str
    started: bool = False
    stopped: bool = False
    port: int | None = None


SCRIPT_DIR = Path(__file__).resolve().parent
TAKI_ROOT = SCRIPT_DIR.parents[4]
HINDSIGHT_ROOT = Path("H:/hindsight")
PG0 = HINDSIGHT_ROOT / ".venv/Lib/site-packages/pg0/bin/pg0.exe"
PYTHON = HINDSIGHT_ROOT / ".venv/Scripts/python.exe"


def clean_environment() -> dict[str, str]:
    """Retain Windows/toolchain necessities, never provider credentials or current DB settings."""
    allowed = {
        "PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "USERPROFILE", "TEMP", "TMP",
        "LOCALAPPDATA", "APPDATA", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
    }
    env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    env.update({
        "PYTHON_DOTENV_DISABLED": "1",
        "PYTHONUTF8": "1",
        "UV_NO_ENV_FILE": "1",
        "HINDSIGHT_API_LLM_API_KEY": "fixture-only-no-provider-access",
        "HINDSIGHT_API_LLM_PROVIDER": "openai",
        "HINDSIGHT_API_LLM_MODEL": "fixture-only",
        # Test fixtures inject deterministic embeddings and ranking. Avoid importing
        # optional local ML stacks merely while validating global configuration.
        # The network guard still refuses the dummy endpoint if a fixture omits injection.
        "HINDSIGHT_API_EMBEDDINGS_PROVIDER": "tei",
        "HINDSIGHT_API_EMBEDDINGS_TEI_URL": "http://127.0.0.1:9",
        "HINDSIGHT_API_RERANKER_PROVIDER": "rrf",
        "PYTHONPATH": os.pathsep.join([str(SCRIPT_DIR), str(HINDSIGHT_ROOT / "hindsight-api-slim")]),
    })
    return env


def save_fixture(fixture: Fixture) -> None:
    (Path(fixture.root) / "ownership.json").write_text(json.dumps(asdict(fixture)), encoding="utf-8")


def pg0_command(fixture: Fixture, env: dict[str, str], action: str, extra: list[str]) -> int:
    # Real files prevent PostgreSQL grandchildren holding a captured pipe open on Windows.
    root = Path(fixture.root)
    with (root / f"{action}.stdout.log").open("w", encoding="utf-8") as out:
        with (root / f"{action}.stderr.log").open("w", encoding="utf-8") as err:
            result = subprocess.run(
                [str(PG0), action, "--name", fixture.name, *extra], env=env,
                stdin=subprocess.DEVNULL, stdout=out, stderr=err, timeout=90,
                creationflags=subprocess.CREATE_NO_WINDOW, check=False,
            )
    return result.returncode


async def probe_database(fixture: Fixture) -> None:
    import asyncpg

    conn = await asyncpg.connect(
        host="127.0.0.1", port=fixture.port, user="taki_fixture", password="taki_fixture",
        database="taki_fixture", timeout=10,
    )
    try:
        actual_data = await conn.fetchval("SHOW data_directory")
        if Path(actual_data).resolve() != (Path(fixture.root) / "data").resolve():
            raise RuntimeError("The connected PostgreSQL process is not the owned fixture")
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        await conn.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        distance = await conn.fetchval("SELECT '[1,2,3]'::vector <=> '[1,2,3]'::vector")
        if distance != 0:
            raise RuntimeError("Fixture vector extension did not produce the expected distance")
        print("PostgreSQL:", await conn.fetchval("SHOW server_version"), "; vector/pg_trgm ready", flush=True)
    finally:
        await conn.close()


def run_pytest(fixture: Fixture, env: dict[str, str], arguments: list[str]) -> int:
    env["HINDSIGHT_API_DATABASE_URL"] = (
        f"postgresql://taki_fixture:taki_fixture@127.0.0.1:{fixture.port}/taki_fixture"
    )
    env["TAKI_G1_FIXTURE_PORT"] = str(fixture.port)
    log_path = Path(fixture.root) / "pytest.log"
    command = [str(PYTHON), "-m", "pytest", "-n", "0", "-p", "g1_fixture_network_guard", *arguments]
    print("Pytest log:", log_path, flush=True)
    with log_path.open("w", encoding="utf-8") as out:
        result = subprocess.run(
            command, env=env, cwd=HINDSIGHT_ROOT / "hindsight-api-slim", stdin=subprocess.DEVNULL,
            stdout=out, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW, check=False,
        )
    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    print("\n".join(lines[-80:]), flush=True)
    return result.returncode


def cleanup(fixture: Fixture, env: dict[str, str]) -> None:
    fixture.stopped = pg0_command(fixture, env, "stop", []) == 0
    save_fixture(fixture)
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
         str(SCRIPT_DIR / "remove_owned_pg0.ps1"), "-OwnershipFile", str(Path(fixture.root) / "ownership.json")],
        env=env, stdin=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Owned fixture cleanup refused; inspect {fixture.root}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--allow-http-fixture", action="store_true")
    parser.add_argument("pytest_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    arguments = args.pytest_args[1:] if args.pytest_args[:1] == ["--"] else args.pytest_args
    if not args.probe and not arguments:
        parser.error("use --probe or provide explicit pytest selectors after --")
    if not PG0.is_file() or not PYTHON.is_file():
        raise RuntimeError("The prevalidated Hindsight pg0/Python environment is unavailable")

    name = "taki-hindsight-g1-" + uuid.uuid4().hex[:12]
    runtime = TAKI_ROOT / ".trellis/.runtime/g1-validation"
    root = runtime / name
    registry = Path(os.environ["USERPROFILE"]) / ".pg0/instances" / name
    if root.exists() or registry.exists():
        raise RuntimeError("Fixture identity already exists")
    root.mkdir(parents=True)
    fixture = Fixture(name=name, root=str(root.resolve()), registry=str(registry.resolve()))
    env = clean_environment()
    if args.allow_http_fixture:
        # Permission is for a socket the pytest process actually owns. Tests must
        # use owned_http_listener(); a guessed/free port is never allowlisted.
        env["TAKI_G1_ALLOW_HTTP_FIXTURE"] = "1"
    save_fixture(fixture)
    print("Owned fixture:", root, flush=True)
    try:
        result = pg0_command(fixture, env, "start", [
            "--data-dir", str(root / "data"), "--username", "taki_fixture", "--password", "taki_fixture",
            "--database", "taki_fixture", "-c", "listen_addresses=127.0.0.1",
        ])
        if result != 0:
            raise RuntimeError("pg0 start failed; inspect the owned fixture start logs")
        fixture.started = True
        if pg0_command(fixture, env, "info", ["--output", "json"]) != 0:
            raise RuntimeError("Owned pg0 instance did not report its identity")
        info = json.loads((root / "info.stdout.log").read_text(encoding="utf-8"))
        if Path(info["data_dir"]).resolve() != (root / "data").resolve():
            raise RuntimeError("PostgreSQL fixture data path mismatch")
        fixture.port = int(info["port"])
        save_fixture(fixture)
        asyncio.run(probe_database(fixture))
        return 0 if args.probe else run_pytest(fixture, env, arguments)
    finally:
        cleanup(fixture, env)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
