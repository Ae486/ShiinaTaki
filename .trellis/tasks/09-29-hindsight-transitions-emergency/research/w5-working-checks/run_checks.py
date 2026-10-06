"""Scoped NEW working-copy helper checks; only self-owned synthetic data."""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import w5_actual_embedding_control as control  # noqa: E402 -- standalone task runner resolves sibling helpers.

TEST = str(HERE / "test_w5_working_recovery.py")
FILES = [
    str(HERE / name)
    for name in (
        "w5-working-recovery.py",
        "w5_working_custody.py",
        "w5_working_migration.py",
        "test_w5_working_recovery.py",
        "w5-working-checks/run_checks.py",
    )
]
env = control.clean_environment()
env["PYTHONPATH"] = os.pathsep.join([str(HERE), "H:/hindsight/hindsight-api-slim"])
env["PYTHONDONTWRITEBYTECODE"] = "1"
checks = {
    "lint": [str(control.PYTHON.with_name("ruff.exe")), "check", "--select", "E,F,I", "--line-length", "120", *FILES],
    "format": [str(control.PYTHON.with_name("ruff.exe")), "format", "--check", "--line-length", "120", *FILES],
    "types": [
        str(control.PYTHON.with_name("ty.exe")),
        "check",
        "--project",
        "H:/hindsight",
        "--python",
        str(control.PYTHON),
        "--extra-search-path",
        "H:/hindsight/hindsight-api-slim",
        "--extra-search-path",
        str(HERE),
        "--extra-search-path",
        str(HERE.parents[1] / "08-09-hindsight-initial-cutover/research/validation"),
        *FILES,
        "--output-format",
        "concise",
    ],
    "tests": [
        str(control.PYTHON),
        "-B",
        "-m",
        "pytest",
        "--noconftest",
        "-o",
        "addopts=",
        "-o",
        "asyncio_mode=auto",
        "-n",
        "0",
        "-q",
        "-s",
        "--tb=short",
        TEST,
    ],
}
checks["offline"] = [*checks["tests"], "-k", "not owned_authenticated_postgresql"]

for name in sys.argv[1:] or checks:
    started = time.monotonic()
    result = subprocess.run(
        checks[name],
        env=env,
        cwd=HERE.parents[3],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    evidence = {
        "argv": checks[name],
        "exitCode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "seconds": time.monotonic() - started,
    }
    control.write_json(Path(__file__).resolve().parent / f"{name}.json", evidence)
    print(json.dumps({"check": name, **evidence}), flush=True)
