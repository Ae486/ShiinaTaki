"""Record one serial whole-workspace gate without loading original credentials or data."""

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


RESEARCH = Path(__file__).resolve().parent
ROOT = RESEARCH.parents[3]
HELPERS = ROOT / ".trellis/tasks/09-07-hindsight-recovery-evidence/research/validation"
SPEC = importlib.util.spec_from_file_location("b3_whole_isolation", HELPERS / "run_isolated_hindsight.py")
ISOLATION = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ISOLATION
SPEC.loader.exec_module(ISOLATION)
SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".json", ".css", ".rs", ".toml", ".html", ".yaml", ".yml", ".lock"}


def snapshot() -> list[dict]:
    """Capture maintained inputs, including additions; exclude generated build outputs and original data."""
    paths = set()
    for relative in ("packages/core", "packages/shared", "apps/cli", "apps/desktop", "e2e"):
        package = ROOT / relative
        paths.update(path for path in package.iterdir() if path.is_file() and path.suffix in SOURCE_SUFFIXES)
        source = package / "src"
        paths.update(path for path in source.rglob("*") if path.is_file() and path.suffix in SOURCE_SUFFIXES)
    shell = ROOT / "apps/desktop/src-tauri"
    paths.update(path for path in shell.iterdir() if path.is_file() and path.suffix in SOURCE_SUFFIXES)
    for relative in ("src", "capabilities", "permissions", "icons"):
        paths.update(path for path in (shell / relative).rglob("*") if path.is_file())
    paths.update(path for path in (ROOT / "apps/desktop/public").rglob("*") if path.is_file())
    paths.update(path for path in (ROOT / "scripts").rglob("*")
                 if path.is_file() and path.suffix in SOURCE_SUFFIXES)
    for relative in ("docs", ".trellis/spec"):
        paths.update(path for path in (ROOT / relative).rglob("*.md") if path.is_file())
    # Existing process-level regressions load task-local drivers in addition to the TS graph.
    for directory in (RESEARCH, HELPERS, ROOT / ".trellis/tasks/09-29-hindsight-transitions-emergency/research"):
        paths.update(path for path in directory.iterdir()
                     if path.is_file() and path.suffix in {".mjs", ".py", ".ps1"})
    paths.update(ROOT / name for name in (
        "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "eslint.config.js",
    ))
    paths.update(path for path in (ROOT / ".cargo").rglob("*") if path.is_file())
    paths.update(path for path in (shell / ".cargo").rglob("*") if path.is_file())
    paths.add(HELPERS / "run_isolated_hindsight.py")
    paths.add(Path(__file__).resolve())
    return [{"path": path.relative_to(ROOT).as_posix(), "bytes": path.stat().st_size,
             "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in sorted(paths) if path.is_file()]


def main() -> int:
    name, directory, *command = sys.argv[1:]
    if not name.replace("-", "").isalnum() or not command:
        raise ValueError("Use a bounded fresh run name, working directory and explicit argv")
    working = Path(directory).resolve()
    if not working.is_relative_to(ROOT.resolve()):
        raise ValueError("Whole-workspace gate must run inside TakiAgent")
    prefix = RESEARCH / f"b3-whole-{name}"
    destinations = {kind: Path(f"{prefix}{suffix}") for kind, suffix in (
        ("log", ".log"), ("before", "-inputs.json"), ("after", "-inputs-after.json"), ("result", "-result.json"),
    )}
    if any(path.exists() for path in destinations.values()):
        raise ValueError("Historical evidence is immutable; choose another run name")
    before = snapshot()
    destinations["before"].write_text(json.dumps(before, indent=2) + "\n", encoding="utf-8")
    temporary_parent = (ROOT / ".trellis/.runtime/b3-whole-checks").resolve()
    temporary = (temporary_parent / f"{name}-{uuid.uuid4().hex}").resolve()
    if not temporary.is_relative_to(temporary_parent) or not temporary_parent.is_relative_to(ROOT.resolve()):
        raise ValueError("Temporary root escaped the workspace")
    temporary.mkdir(parents=True, exist_ok=False)
    env = ISOLATION.clean_environment()
    env.update({"TEMP": str(temporary), "TMP": str(temporary), "NODE_DISABLE_COMPILE_CACHE": "1",
                "TAKI_G1_FIXTURE_PORT": "0", "PYTHONIOENCODING": "utf-8", "CARGO_NET_OFFLINE": "true",
                "npm_config_offline": "true", "npm_config_update_notifier": "false"})
    started = time.monotonic()
    started_at = datetime.now(timezone.utc).isoformat()
    exit_code = None
    try:
        with destinations["log"].open("x", encoding="utf-8") as output:
            process = subprocess.run(command, cwd=working, env=env, stdin=subprocess.DEVNULL,
                                     stdout=output, stderr=subprocess.STDOUT, check=False,
                                     creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        exit_code = process.returncode
    finally:
        after = snapshot()
        destinations["after"].write_text(json.dumps(after, indent=2) + "\n", encoding="utf-8")
        left = {row["path"]: row for row in before}
        right = {row["path"]: row for row in after}
        changed = sorted(path for path in left.keys() | right.keys() if left.get(path) != right.get(path))
        remaining = [path.name for path in temporary.iterdir()]
        # Tests own recursive teardown; this recorder never deletes an unexamined surviving subtree.
        if not remaining:
            temporary.rmdir()
        evidence = {"command": command, "cwd": str(working), "startedAt": started_at,
                    "finishedAt": datetime.now(timezone.utc).isoformat(), "exitCode": exit_code,
                    "durationSeconds": round(time.monotonic() - started, 3), "inputCount": len(before),
                    "changedInputs": changed, "inputManifest": destinations["before"].name,
                    "afterManifest": destinations["after"].name, "log": destinations["log"].name,
                    "temporaryRoot": str(temporary), "temporaryRootRemoved": not temporary.exists(),
                    "remainingFixtureEntries": remaining}
        destinations["result"].write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(evidence, indent=2), flush=True)
    print("\n".join(destinations["log"].read_text(encoding="utf-8", errors="replace").splitlines()[-32:]))
    return exit_code if exit_code else (1 if changed or remaining else 0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
