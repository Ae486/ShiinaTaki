"""One source-only freeze with retained subprocess evidence; never invokes Docker."""

import hashlib
import json
import os
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKET = HERE.parent / "docker-application-artifact"
TARGET = HERE / "freeze-execution.json"
assert not TARGET.exists()
records = []
for mode in ("--freeze", "--verify"):
    argv = ["G:/anaconda3/python.exe", "-I", "-B", "-S", str(PACKET / "prepare.py"), mode]
    result = subprocess.run(argv, capture_output=True, cwd=PACKET, timeout=60,
                            env={"SystemRoot": os.environ["SystemRoot"]}, creationflags=subprocess.CREATE_NO_WINDOW)
    records.append({"argv": argv, "returncode": result.returncode,
                    "stdout": result.stdout.decode("utf-8", errors="replace"),
                    "stderr": result.stderr.decode("utf-8", errors="replace"),
                    "stdoutSha256": hashlib.sha256(result.stdout).hexdigest(),
                    "stderrSha256": hashlib.sha256(result.stderr).hexdigest()})
    if result.returncode:
        break
with TARGET.open("x", encoding="utf-8") as stream:
    json.dump(records, stream, indent=2)
    stream.write("\n")
print(json.dumps(records))
