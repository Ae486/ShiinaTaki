"""Run one B3 Core/Shared self-check with a credential-free environment and retained real exit."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import shutil

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RESEARCH = Path(__file__).resolve().parent
TAKI = RESEARCH.parents[3]
NATIVE = Path("H:/hindsight")
HELPERS = TAKI / ".trellis/tasks/09-07-hindsight-recovery-evidence/research/validation"
spec = importlib.util.spec_from_file_location("b3_isolation", HELPERS / "run_isolated_hindsight.py")
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
        for child in (
            "rust/target", "python/hindsight_client_api", "python/.openapi-generator",
            "typescript/generated", "typescript/core", "typescript/models", "typescript/services",
            "go", "go/docs", "go/.openapi-generator",
        ):
            target = (NATIVE / "hindsight-clients" / child).resolve()
            if not target.is_relative_to((NATIVE / "hindsight-clients").resolve()):
                raise ValueError("Generated cleanup target escaped the Native client root")
    log = RESEARCH / f"b3-core-{name}.log"
    result_path = RESEARCH / f"b3-core-{name}-result.json"
    if log.exists() or result_path.exists():
        raise ValueError("Do not overwrite a previous check; choose a new run suffix")
    temp = (TAKI / ".trellis/.runtime" / f"b3-core-{name}-temp").resolve()
    boundary = (TAKI / ".trellis/.runtime").resolve()
    if not temp.is_relative_to(boundary) or temp.exists():
        raise ValueError("Use a new owned TEMP inside the task runtime boundary")
    temp.mkdir()
    env.update(TEMP=str(temp), TMP=str(temp), NODE_DISABLE_COMPILE_CACHE="1")
    started = time.time()
    cleanup = {"path": str(temp), "leftovers": [], "removed": False}
    try:
        with log.open("w", encoding="utf-8") as output:
            result = subprocess.run(command, cwd=directory, env=env, stdin=subprocess.DEVNULL,
                                    stdout=output, stderr=subprocess.STDOUT, check=False,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    finally:
        cleanup["leftovers"] = [str(path.relative_to(temp)) for path in sorted(temp.rglob("*"))]
        # The unique directory was created by this invocation. Preserve its inventory
        # before cleanup; never hide whether tests left files behind.
        cleanup_path = RESEARCH / f"b3-core-{name}-cleanup.json"
        cleanup_path.write_text(json.dumps(cleanup, indent=2) + "\n", encoding="utf-8")
        if temp.resolve() != temp or not temp.is_relative_to(boundary):
            raise ValueError("Owned cleanup path changed")
        if cleanup["leftovers"]:
            shutil.rmtree(temp)
        else:
            temp.rmdir()
        cleanup["removed"] = not temp.exists()
        cleanup_path.write_text(json.dumps(cleanup, indent=2) + "\n", encoding="utf-8")
    evidence = {"command": command, "cwd": directory, "exitCode": result.returncode,
                "durationSeconds": round(time.time() - started, 3), "log": str(log), "cleanup": cleanup}
    result_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    print("\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-24:]))
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
