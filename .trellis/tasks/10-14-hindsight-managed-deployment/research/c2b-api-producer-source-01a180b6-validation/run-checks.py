"""Root-slot-gated source validation only; generated tests never launch a server."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = Path("H:/hindsight/docker/standalone/managed_bootstrap")
NAMES = ["api_profile.py", "api_artifact.py", "api_state.py", "api_consumer.py", "api_database.py",
         "api_server.py", "api_child.py", "test_api_producer.py"]
files = [str(SOURCE / name) for name in NAMES]
commands = [
    ["H:/hindsight/.venv/Scripts/ruff.exe", "check", "--no-cache", "--select", "E,F,I", "--line-length", "120", *files],
    ["H:/hindsight/.venv/Scripts/ty.exe", "check", "--python-platform", "linux", "--python-version", "3.11",
     "--extra-search-path", "H:/hindsight/.venv/Lib/site-packages", "--extra-search-path", "H:/hindsight/docker/standalone",
     "--extra-search-path", "H:/hindsight/hindsight-api-slim", *files],
    ["G:/anaconda3/python.exe", "-I", "-B", "-S", str(SOURCE / "test_api_producer.py")],
    ["G:/anaconda3/python.exe", "-I", "-B", "-S", "-c",
     "import ast,pathlib; names=" + repr(files) + "; [ast.parse(pathlib.Path(p).read_bytes(),filename=p) for p in names]; print('8 Python files parsed')"],
]
destination = HERE / ("checks-" + sys.argv[1] + ".json")
assert not destination.exists()
records = []
for argv in commands:
    completed = subprocess.run(argv, cwd=HERE, env={"SystemRoot": os.environ["SystemRoot"]},
                               capture_output=True, timeout=90, creationflags=subprocess.CREATE_NO_WINDOW)
    records.append({"argv": argv, "exitCode": completed.returncode,
                    "stdout": completed.stdout.decode("utf-8", errors="replace"),
                    "stderr": completed.stderr.decode("utf-8", errors="replace"),
                    "stdoutSha256": hashlib.sha256(completed.stdout).hexdigest(),
                    "stderrSha256": hashlib.sha256(completed.stderr).hexdigest()})
result = {"files": {name: hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() for name in NAMES}, "checks": records}
with destination.open("x", encoding="utf-8") as stream:
    json.dump(result, stream, indent=2)
    stream.write("\n")
print(json.dumps({"record": str(destination), "exitCodes": [record["exitCode"] for record in records]}))
