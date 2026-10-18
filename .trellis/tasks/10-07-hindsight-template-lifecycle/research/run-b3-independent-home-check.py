"""Retain one independent Home check, exact inputs and owned temporary-root cleanup."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
RESEARCH = Path(__file__).resolve().parent
ROOT = RESEARCH.parents[3]
HELPER = ROOT / ".trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py"
spec = importlib.util.spec_from_file_location("home_check_isolation", HELPER)
isolation = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = isolation
spec.loader.exec_module(isolation)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def inputs() -> list[dict]:
    previous = json.loads((RESEARCH / "b3-home-inputs-02.json").read_text(encoding="utf-8-sig"))
    release = json.loads((RESEARCH / "b3-home-source-release-01.json").read_text(encoding="utf-8-sig"))
    paths = {row["path"] for row in [*previous, *release["files"]]}
    # Source imports also depend on inherited TypeScript/workspace configuration and the isolation helper.
    # These pre-existing inputs were absent from the old Home inventory; freeze them with the source graph.
    paths.update({"tsconfig.base.json", "pnpm-workspace.yaml", "packages/core/tsconfig.json",
                  "packages/shared/tsconfig.json", str(HELPER.relative_to(ROOT)).replace("\\", "/")})
    # Later Core/Shared handoffs can add modules after the implementer's input inventory was captured.
    # Record the complete current source graph as well, including additions during the check.
    for source_root in ["apps/desktop/src", "packages/core/src", "packages/shared/src"]:
        paths.update(str(path.relative_to(ROOT)).replace("\\", "/") for path in (ROOT / source_root).rglob("*")
                     if path.is_file() and path.suffix in {".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json", ".css"})
    paths.update(str(path.relative_to(ROOT)).replace("\\", "/") for path in
                 (ROOT / "apps/desktop/src/windows/home/pages/operations").glob("hindsight-template-*.test.*"))
    paths.add(str(Path(__file__).resolve().relative_to(ROOT)).replace("\\", "/"))
    result = []
    for relative in sorted(paths):
        path = ROOT / relative
        if not path.is_file():
            raise ValueError(f"Required source disappeared: {relative}")
        content = path.read_bytes()
        result.append({"path": relative, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
    return result


def main() -> int:
    name, *command = sys.argv[1:]
    if not name.replace("-", "").isalnum() or not command:
        raise ValueError("A bounded run name and an explicit command are required")
    prefix = RESEARCH / f"b3-independent-home-{name}"
    result_path = Path(f"{prefix}-result.json")
    log_path = Path(f"{prefix}.log")
    input_path = Path(f"{prefix}-inputs.json")
    if any(path.exists() for path in [result_path, log_path, input_path]):
        raise ValueError("Use a new run name; prior failures must remain intact")
    before = inputs()
    input_path.write_text(json.dumps(before, indent=2) + "\n", encoding="utf-8")
    temp_parent = (ROOT / ".trellis/.runtime/b3-independent-home").resolve()
    temp_root = (temp_parent / f"{name}-{uuid.uuid4().hex}").resolve()
    if not temp_root.is_relative_to(temp_parent) or not temp_parent.is_relative_to(ROOT.resolve()):
        raise ValueError("Temporary path escaped the owned workspace")
    temp_root.mkdir(parents=True, exist_ok=False)
    env = isolation.clean_environment()
    env.update({"TEMP": str(temp_root), "TMP": str(temp_root), "PYTHONIOENCODING": "utf-8",
                "NODE_DISABLE_COMPILE_CACHE": "1",
                "TAKI_G1_FIXTURE_PORT": "0", "npm_config_offline": "true", "npm_config_update_notifier": "false"})
    started_at = now()
    started = time.monotonic()
    exit_code = None
    try:
        with log_path.open("w", encoding="utf-8") as output:
            process = subprocess.run(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                     stdout=output, stderr=subprocess.STDOUT, check=False,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
        exit_code = process.returncode
    finally:
        after = {row["path"]: row for row in inputs()}
        previous = {row["path"]: row for row in before}
        changed = sorted(path for path in previous.keys() | after.keys() if previous.get(path) != after.get(path))
        remaining = [str(path.relative_to(temp_root)) for path in temp_root.iterdir()]
        # The fixtures own recursive cleanup. This wrapper removes only its now-empty exact root.
        if not remaining:
            temp_root.rmdir()
        evidence = {"command": command, "cwd": str(ROOT), "startedAt": started_at, "finishedAt": now(),
                    "exitCode": exit_code, "durationSeconds": round(time.monotonic() - started, 3),
                    "inputManifest": input_path.name, "sourceCount": len(before), "changedInputs": changed,
                    "temporaryRoot": str(temp_root), "temporaryRootRemoved": not temp_root.exists(),
                    "remainingFixtureEntries": remaining, "log": log_path.name}
        result_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(evidence, indent=2))
    print("\n".join(log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-32:]))
    return exit_code if exit_code is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
