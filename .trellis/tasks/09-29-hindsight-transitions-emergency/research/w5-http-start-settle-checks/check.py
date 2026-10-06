"""One offline startup-exception regression and related static checks only."""

import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import w5_actual_embedding_control as control

env = control.clean_environment()
env["PYTHONPATH"] = os.pathsep.join([str(HERE), "H:/hindsight/hindsight-api-slim"])
env["PYTHONDONTWRITEBYTECODE"] = "1"
files = [str(HERE / name) for name in (
    "w5_http_composition.py", "w5_http_inventory.py", "test_w5_http_environment.py",
)]
commands = [
    ("regression", [str(control.PYTHON), "-m", "pytest", "--noconftest", "-o", "addopts=",
                    str(HERE / "test_w5_http_environment.py") + "::test_exceptional_start_preserves_phase_and_monotonic_anchor",
                    "-q", "--tb=short", "-n", "0"]),
    ("ruff", ["H:/hindsight/.venv/Scripts/ruff.exe", "check", *files]),
    ("format", ["H:/hindsight/.venv/Scripts/ruff.exe", "format", "--check", *files]),
    ("typecheck", ["H:/hindsight/.venv/Scripts/ty.exe", "check", *files[:2], "--python", "H:/hindsight/.venv",
                   "--extra-search-path", "H:/hindsight/hindsight-api-slim", "--output-format", "concise"]),
    ("node-syntax", ["C:/Program Files/nodejs/node.exe", "--check", str(HERE / "w5-http-client.mjs")]),
]
for name, argv in commands:
    result = subprocess.run(argv, cwd=HERE.parents[3], env=env, capture_output=True, text=True,
                            encoding="utf-8", timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    evidence = {"argv": argv, "cwd": str(HERE.parents[3]), "timeoutSeconds": 60,
                "exitCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
    control.write_json(Path(__file__).parent / f"{name}.json", evidence)
    print(json.dumps(evidence), flush=True)
    assert result.returncode == 0
