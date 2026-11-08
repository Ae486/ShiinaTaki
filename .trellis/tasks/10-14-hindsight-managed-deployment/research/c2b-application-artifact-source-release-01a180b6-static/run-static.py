"""Retain bounded task-only source validation results, including initial failures."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKET = HERE.parent / "docker-application-artifact"
ROUND = sys.argv[1]
commands = [
    ["G:/Roaming/Python/Python312/Scripts/ruff.exe", "check", "--select", "E,F,I", "--line-length", "120", str(PACKET)],
    ["H:/hindsight/.venv/Scripts/ty.exe", "check", "--python-platform", "linux", "--python-version", "3.11",
     "--extra-search-path", "H:/hindsight/.venv/Lib/site-packages", str(PACKET)],
    ["G:/anaconda3/python.exe", "-I", "-B", "-S", str(PACKET / "test_artifact.py")],
    ["G:/anaconda3/python.exe", "-I", "-B", "-S", "-c",
     "import ast,pathlib; root=pathlib.Path(" + repr(str(PACKET)) + "); files=sorted(root.glob('*.py')); "
     "[ast.parse(p.read_bytes(),filename=str(p)) for p in files]; print(str(len(files))+' Python source files parsed')"],
]
records = []
for argv in commands:
    result = subprocess.run(argv, cwd=PACKET, capture_output=True, timeout=60,
                            env={"SystemRoot": os.environ["SystemRoot"]}, creationflags=subprocess.CREATE_NO_WINDOW)
    records.append({"argv": argv, "returncode": result.returncode,
                    "stdout": result.stdout.decode("utf-8", errors="replace"),
                    "stderr": result.stderr.decode("utf-8", errors="replace"),
                    "stdoutSha256": hashlib.sha256(result.stdout).hexdigest(),
                    "stderrSha256": hashlib.sha256(result.stderr).hexdigest()})
destination = HERE / f"checks-{ROUND}.json"
with destination.open("x", encoding="utf-8") as stream:
    json.dump(records, stream, indent=2)
    stream.write("\n")
print(json.dumps({"record": str(destination), "codes": [record["returncode"] for record in records]}))
