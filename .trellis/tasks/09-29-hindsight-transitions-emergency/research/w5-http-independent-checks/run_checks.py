"""Bounded independent verification runner; creates only NEW checker evidence."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import w5_actual_embedding_control as control

ROOT = HERE.parents[3]
EVIDENCE = Path(__file__).resolve().parent
PYTHON = str(control.PYTHON)
NODE = "C:/Program Files/nodejs/node.exe"
PYFILES = [
    str(HERE / name)
    for name in (
        "w5-http-diagnostic.py",
        "w5_http_composition.py",
        "w5_http_inventory.py",
        "test_w5_http_diagnostic.py",
        "test_w5_http_independent.py",
    )
]
JSFILES = [
    str(HERE / name) for name in ("w5-http-client.mjs", "test_w5_http_client.mjs")
]
environment = control.clean_environment()
environment["PYTHONPATH"] = os.pathsep.join(
    [str(HERE), "H:/hindsight/hindsight-api-slim"]
)
environment["PYTHONDONTWRITEBYTECODE"] = "1"


def run(argv, timeout, filename, stdin=None):
    started = time.monotonic()
    value = {"argv": argv, "cwd": str(ROOT), "timeoutSeconds": timeout}
    if stdin is not None:
        value["stdin"] = stdin
    try:
        result = subprocess.run(
            argv,
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
            input=stdin,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        value.update(
            exitCode=result.returncode, stdout=result.stdout, stderr=result.stderr
        )
    except subprocess.TimeoutExpired as error:
        value.update(
            exitCode=None,
            timeout=True,
            stdout=str(error.stdout),
            stderr=str(error.stderr),
        )
    value["milliseconds"] = (time.monotonic() - started) * 1000
    control.write_json(EVIDENCE / filename, value)
    print(json.dumps(value), flush=True)
    return value.get("exitCode") == 0


if sys.argv[1] in ("report-red", "report-green"):
    passed = run(
        [
            PYTHON,
            "-m",
            "pytest",
            "--noconftest",
            "-o",
            "addopts=",
            str(HERE / "test_w5_http_independent.py"),
            "-k",
            "contradictory_http",
            "-q",
            "--tb=short",
            "-n",
            "0",
        ],
        60,
        sys.argv[1] + ".json",
    )
    assert passed if sys.argv[1] == "report-green" else not passed
elif sys.argv[1] == "affected":
    assert run([
        PYTHON, "-m", "pytest", "--noconftest", "-o", "addopts=",
        str(HERE / "test_w5_http_diagnostic.py"), str(HERE / "test_w5_http_independent.py"),
        "-k", "reports or report_digest or prelaunch_inventory or contradictory_http",
        "-q", "--tb=short", "-n", "0",
    ], 60, "affected.json")
elif sys.argv[1] == "custody":
    assert run([
        PYTHON, "-m", "pytest", "--noconftest", "-o", "addopts=",
        str(HERE / "test_w5_http_independent.py"),
        "-k", "real_windows or real_node_handshake", "-q", "--tb=short", "-n", "0",
    ], 90, "custody-checked.json")
elif sys.argv[1] == "python":
    assert run(
        [
            PYTHON,
            "-m",
            "pytest",
            "--noconftest",
            "-o",
            "addopts=",
            str(HERE / "test_w5_http_diagnostic.py"),
            str(HERE / "test_w5_http_independent.py"),
            "-q",
            "--tb=short",
            "-n",
            "0",
        ],
        180,
        "python.json",
    )
elif sys.argv[1] == "owned-pg":
    assert run(
        [
            PYTHON,
            str(
                ROOT
                / ".trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py"
            ),
            "--",
            "--noconftest",
            "-o",
            "addopts=",
            str(HERE / "test_w5_http_independent.py")
            + "::test_independent_owned_pg_with_sealed_evidence_preserved",
            "-q",
            "--tb=short",
            "-n",
            "0",
        ],
        240,
        "owned-pg.json",
    )
elif sys.argv[1] == "node":
    assert run([NODE, "--test", JSFILES[1]], 30, "node.json")
elif sys.argv[1] == "quality":
    assert run(
        ["H:/hindsight/.venv/Scripts/ruff.exe", "check", *PYFILES], 60, "ruff.json"
    )
    assert run(
        ["H:/hindsight/.venv/Scripts/ruff.exe", "format", "--check", *PYFILES],
        60,
        "format.json",
    )
    assert run(
        [
            "H:/hindsight/.venv/Scripts/ty.exe",
            "check",
            *PYFILES[:3],
            "--python",
            "H:/hindsight/.venv",
            "--extra-search-path",
            "H:/hindsight/hindsight-api-slim",
            "--output-format",
            "concise",
        ],
        60,
        "typecheck.json",
    )
    for index, file in enumerate(JSFILES):
        assert run([NODE, "--check", file], 30, f"syntax-{index}.json")
    code = """import { ESLint } from 'eslint';
import js from '@eslint/js';
const checker = new ESLint({overrideConfigFile: true, overrideConfig: [js.configs.recommended,
{files: ['**/*.mjs'], languageOptions: {globals: Object.fromEntries(
['process','console','Buffer','URL','performance'].map(name => [name, 'readonly']))}}]});
const results = await checker.lintFiles(FILES);
console.log(await (await checker.loadFormatter('stylish')).format(results));
process.exitCode = results.some(result => result.errorCount || result.warningCount) ? 1 : 0;
""".replace("FILES", json.dumps(JSFILES))
    assert run([NODE, "--input-type=module", "-"], 60, "eslint.json", code)
else:
    raise SystemExit("Expected python, node or quality")
