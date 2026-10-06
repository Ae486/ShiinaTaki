"""Only the changed environment/startup seam and scoped static checks."""

import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import w5_actual_embedding_control as control

ROOT = HERE.parents[3]
EVIDENCE = Path(__file__).resolve().parent
env = control.clean_environment()
env["PYTHONPATH"] = os.pathsep.join([str(HERE), "H:/hindsight/hindsight-api-slim"])
env["PYTHONDONTWRITEBYTECODE"] = "1"


def run(argv, name, timeout=60):
    result = subprocess.run(argv, cwd=ROOT, env=env, capture_output=True, text=True,
                            encoding="utf-8", timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
    value = {"argv": argv, "cwd": str(ROOT), "exitCode": result.returncode,
             "timeoutSeconds": timeout, "stdout": result.stdout, "stderr": result.stderr}
    control.write_json(EVIDENCE / f"{name}.json", value)
    print(json.dumps(value), flush=True)
    assert result.returncode == 0


if sys.argv[1] == "tests":
    run([str(control.PYTHON), "-m", "pytest", "--noconftest", "-o", "addopts=",
         str(HERE / "test_w5_http_environment.py"), "-q", "--tb=short", "-n", "0"], "tests")
elif sys.argv[1] == "quality":
    files = [str(HERE / name) for name in (
        "w5_http_composition.py", "w5_http_inventory.py", "w5_http_environment_probe.py", "test_w5_http_environment.py",
    )]
    run(["H:/hindsight/.venv/Scripts/ruff.exe", "check", *files], "ruff")
    run(["H:/hindsight/.venv/Scripts/ruff.exe", "format", "--check", *files], "format")
    run(["H:/hindsight/.venv/Scripts/ty.exe", "check", *files[:2], "--python", "H:/hindsight/.venv",
         "--extra-search-path", "H:/hindsight/hindsight-api-slim", "--output-format", "concise"], "typecheck")
    run(["C:/Program Files/nodejs/node.exe", "--check", str(HERE / "w5-http-client.mjs")], "node-syntax")
else:
    raise SystemExit("tests or quality")
