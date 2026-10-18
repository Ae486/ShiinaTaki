"""Run one B1 self-check with a credential-free environment and retained real exit."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RESEARCH = Path(__file__).resolve().parent
TAKI = RESEARCH.parents[3]
NATIVE = Path("H:/hindsight")
HELPERS = TAKI / ".trellis/tasks/09-07-hindsight-recovery-evidence/research/validation"
spec = importlib.util.spec_from_file_location("b1_isolation", HELPERS / "run_isolated_hindsight.py")
isolation = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = isolation
spec.loader.exec_module(isolation)


def main() -> None:
    name, directory, *command = sys.argv[1:]
    if not name.replace("-", "").replace("_", "").isalnum() or not command:
        raise ValueError("A bounded check name, working directory and command are required")
    env = isolation.clean_environment()
    toolchain = TAKI / ".trellis/.runtime/g1-toolchain"
    env.update({
        "PYTHONIOENCODING": "utf-8",
        "TAKI_G1_FIXTURE_PORT": "0",
        "HINDSIGHT_OPENAPI_GENERATOR_JAR": str(NATIVE / "hindsight-clients/go/openapi-generator-cli.jar"),
        "HINDSIGHT_GENERATOR_PYTHON": str(isolation.PYTHON),
        "CARGO_NET_OFFLINE": "true",
        "GOPROXY": "off",
        "GOSUMDB": "off",
        "GOCACHE": str(toolchain / "go-build"),
        "GOMODCACHE": str(toolchain / "go-modules"),
        "npm_config_offline": "true",
        "npm_config_update_notifier": "false",
        "PATH": os.pathsep.join([
            str(toolchain / "jre/jdk-17.0.20.1+1-jre/bin"),
            str(toolchain / "go/go/bin"), env.get("PATH", ""),
        ]),
    })
    # Canonical cleanup stays inside its explicit generated output directories.
    if "scripts/generate-clients.sh" in command:
        for child in ("rust/target", "python/hindsight_client_api", "typescript/generated", "go"):
            target = (NATIVE / "hindsight-clients" / child).resolve()
            if not target.is_relative_to((NATIVE / "hindsight-clients").resolve()):
                raise ValueError("Generated cleanup target escaped the Native client root")
    log = RESEARCH / f"b1-{name}.log"
    result_path = RESEARCH / f"b1-{name}-result.json"
    if log.exists() or result_path.exists():
        raise ValueError("Do not overwrite a previous check; choose a new run suffix")
    started = time.time()
    with log.open("w", encoding="utf-8") as output:
        result = subprocess.run(command, cwd=directory, env=env, stdin=subprocess.DEVNULL,
                                stdout=output, stderr=subprocess.STDOUT, check=False)
    evidence = {"command": command, "cwd": directory, "exitCode": result.returncode,
                "durationSeconds": round(time.time() - started, 3), "log": str(log)}
    result_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    print("\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-24:]))
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
