"""Run one explicitly scheduled Native B3 check with clean environment and retained source/exit evidence."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
RESEARCH = Path(__file__).resolve().parent
TAKI = RESEARCH.parents[3]
NATIVE = Path("H:/hindsight")
HELPERS = TAKI / ".trellis/tasks/09-07-hindsight-recovery-evidence/research/validation"
spec = importlib.util.spec_from_file_location("b3_native_isolation", HELPERS / "run_isolated_hindsight.py")
isolation = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = isolation
spec.loader.exec_module(isolation)


def source_hashes(*, include_core: bool = False) -> dict[str, str]:
    files = list((NATIVE / "hindsight-api-slim/hindsight_api").rglob("*.py"))
    files.extend((NATIVE / "hindsight-api-slim/tests").rglob("*.py"))
    files.append(TAKI / "packages/shared/src/fixtures/hindsight-template-backup-v2.json")
    files.extend(
        NATIVE / name
        for name in (
            "hindsight-clients/template-backup-v2-fixture.json",
            "hindsight-dev/hindsight_dev/generate_openapi.py",
            "scripts/generate-clients.sh",
            "scripts/openapi-generator-backend.sh",
            "scripts/postprocess-go-client.py",
            "hindsight-clients/rust/build.rs",
        )
    )
    for directory, pattern in (
        ("hindsight-clients/python/tests", "*.py"),
        ("hindsight-clients/typescript/tests", "*.ts"),
        ("hindsight-clients/rust/tests", "*.rs"),
        ("hindsight-clients/go", "*_test.go"),
    ):
        files.extend((NATIVE / directory).rglob(pattern))
    files.extend(RESEARCH / name for name in ("pin-b3-generated.py", "run-b3-native-clients.py"))
    # SQL fixtures and dependency/configuration inputs can alter the executed
    # graph without changing a Python/TypeScript source. Preserve their bytes
    # along with the isolation and cleanup code; never inspect repository .env.
    files.extend((NATIVE / "hindsight-api-slim/tests").rglob("*.json"))
    files.extend((NATIVE / "hindsight-api-slim/tests").rglob("*.sql"))
    files.extend(HELPERS.glob("*.py"))
    files.extend(HELPERS.glob("*.ps1"))
    for root in (NATIVE, NATIVE / "hindsight-api-slim"):
        for pattern in ("pyproject.toml", "uv.lock", "ruff.toml", "alembic.ini", "pytest.ini", ".python-version"):
            files.extend(root.glob(pattern))
    if include_core:
        # Node's import hook reads non-TS fixtures and package exports directly.
        # Include the full source trees and root/package config and lock inputs,
        # not just the test entry or package.json. This is still evidence, not a
        # substitute for the root owner's pre-run shared-source freeze.
        for package in ("core", "shared"):
            files.extend(path for path in (TAKI / "packages" / package / "src").rglob("*") if path.is_file())
        for root in (TAKI, TAKI / "packages/core", TAKI / "packages/shared"):
            for pattern in ("*.json", "*.js", "*.mjs", "*.cjs", "*.ts", "*.yaml", "*.yml", "*.lock"):
                files.extend(root.glob(pattern))
        files.append(RESEARCH / "b3-core-joint-entry.mjs")
    files.append(Path(__file__).resolve())
    return {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(set(files))}


def main() -> None:
    name, directory, *command = sys.argv[1:]
    if not name.replace("-", "").replace("_", "").isalnum() or not command:
        raise ValueError("A bounded check name, working directory and command are required")
    log = RESEARCH / f"b3-native-{name}.log"
    result_path = RESEARCH / f"b3-native-{name}-result.json"
    sources = RESEARCH / f"b3-native-{name}-sources.json"
    if any(path.exists() for path in (log, result_path, sources)):
        raise ValueError("Prior evidence is immutable; choose a new run suffix")
    runtime = (TAKI / ".trellis/.runtime/b3-native-checks").resolve()
    runtime.mkdir(parents=True, exist_ok=True)
    owned_temp = Path(tempfile.mkdtemp(prefix=name + "-", dir=runtime)).resolve()
    if not owned_temp.is_relative_to(runtime):
        raise ValueError("Temporary check root escaped its owned directory")
    env = isolation.clean_environment()
    toolchain = TAKI / ".trellis/.runtime/g1-toolchain"
    env.update(
        {
            "PYTHONIOENCODING": "utf-8",
            "TAKI_G1_FIXTURE_PORT": "0",
            "TEMP": str(owned_temp),
            "TMP": str(owned_temp),
            "HINDSIGHT_OPENAPI_GENERATOR_JAR": str(NATIVE / "hindsight-clients/go/openapi-generator-cli.jar"),
            "HINDSIGHT_GENERATOR_PYTHON": str(isolation.PYTHON),
            "CARGO_NET_OFFLINE": "true",
            "GOPROXY": "off",
            "GOSUMDB": "off",
            "GOCACHE": str(toolchain / "go-build"),
            "GOMODCACHE": str(toolchain / "go-modules"),
            "npm_config_offline": "true",
            "npm_config_update_notifier": "false",
            "PATH": os.pathsep.join(
                [str(toolchain / "jre/jdk-17.0.20.1+1-jre/bin"), str(toolchain / "go/go/bin"), env.get("PATH", "")]
            ),
        }
    )
    include_core = name.startswith("joint-")
    before = source_hashes(include_core=include_core)
    started = time.time()
    try:
        with log.open("x", encoding="utf-8") as output:
            result = subprocess.run(
                command,
                cwd=directory,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                check=False,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        after = source_hashes(include_core=include_core)
        sources.write_text(json.dumps({"before": before, "after": after}, indent=2) + "\n", encoding="utf-8")
        evidence = {
            "command": command,
            "cwd": directory,
            "exitCode": result.returncode,
            "durationSeconds": round(time.time() - started, 3),
            "log": str(log),
            "sources": str(sources),
            "changedInputs": [key for key in before.keys() | after.keys() if before.get(key) != after.get(key)],
            "ownedTemp": str(owned_temp),
        }
    finally:
        if not owned_temp.resolve().is_relative_to(runtime) or owned_temp.resolve() == runtime:
            raise ValueError("Unsafe temporary cleanup target")
        shutil.rmtree(owned_temp)
    evidence["ownedTempRemoved"] = not owned_temp.exists()
    result_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    print("\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-36:]))
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
