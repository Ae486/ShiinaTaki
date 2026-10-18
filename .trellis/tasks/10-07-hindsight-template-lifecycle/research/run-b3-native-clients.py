"""Guard exact generator-owned paths and preserve maintained files around canonical SDK generation."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path("H:/hindsight").resolve(strict=True)
TAKI = HERE.parents[3]


def main() -> int:
    name = sys.argv[1]
    if not re.fullmatch(r"clients-[a-z0-9_-]+", name):
        raise ValueError("A unique clients run name is required")
    evidence = HERE / f"b3-native-{name}-guards.json"
    if evidence.exists():
        raise ValueError("Prior generation guard evidence must not be replaced")
    module_spec = importlib.util.spec_from_file_location("b3_generated_inputs", HERE / "pin-b3-generated.py")
    inputs = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(inputs)
    inputs.inspect_schema(
        json.loads((ROOT / "hindsight-docs/static/openapi.json").read_text(encoding="utf-8")), require_backup=True
    )
    temporary = Path(os.environ["TEMP"]).resolve(strict=True)
    if not temporary.is_relative_to((TAKI / ".trellis/.runtime/b3-native-checks").resolve(strict=True)):
        raise ValueError("Canonical generation must use the scheduled owned TEMP")
    jar = ROOT / "hindsight-clients/go/openapi-generator-cli.jar"
    if (
        hashlib.sha256(jar.read_bytes()).hexdigest()
        != "615e014705af34861e789e0b2a11075d3c80db134f881e937265479a4a83996e"
    ):
        raise ValueError("The installed generator JAR differs from the pinned 7.10.0 input")
    destructive = [
        "hindsight-clients/rust/target",
        "hindsight-clients/python/hindsight_client_api",
        "hindsight-clients/python/.openapi-generator",
        "hindsight-clients/typescript/generated",
        "hindsight-clients/typescript/core",
        "hindsight-clients/typescript/models",
        "hindsight-clients/typescript/services",
        "hindsight-clients/typescript/index.ts",
        "hindsight-clients/go/docs",
        "hindsight-clients/go/.openapi-generator",
        "hindsight-clients/go/.openapi-generator-ignore",
        "hindsight-clients/go/go.mod",
        "hindsight-clients/go/go.sum",
    ]
    for name in (
        "setup.py",
        "setup.cfg",
        "requirements.txt",
        "test-requirements.txt",
        "tox.ini",
        "git_push.sh",
        ".travis.yml",
        ".gitlab-ci.yml",
        ".gitignore",
        "README.md",
    ):
        destructive.append("hindsight-clients/python/" + name)
    for pattern in (
        "api_*.go",
        "model_*.go",
        "client.go",
        "configuration.go",
        "response.go",
        "utils.go",
        "git_push.sh",
        ".travis.yml",
        ".gitlab-ci.yml",
    ):
        destructive.extend(path.relative_to(ROOT).as_posix() for path in (ROOT / "hindsight-clients/go").glob(pattern))
    resolved = [(ROOT / name).resolve() for name in destructive]
    if any(path == ROOT or not path.is_relative_to(ROOT / "hindsight-clients") for path in resolved):
        raise ValueError("A canonical generator deletion target escaped the Native clients workspace")
    originals = {name: (ROOT / name).read_bytes() for name in inputs.MAINTAINED}
    guard_root = temporary / "maintained-generator-inputs"
    guard_root.mkdir()
    for name, content in originals.items():
        copy = guard_root / name
        copy.parent.mkdir(parents=True, exist_ok=True)
        copy.write_bytes(content)
    environment = dict(os.environ)
    environment["TMPDIR"] = temporary.as_posix()
    probe = subprocess.run(
        ["G:/Git/bin/bash.exe", "-c", "cygpath -m /tmp"],
        env=environment,
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=True,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    legacy_temp = Path(probe.stdout.strip()).resolve(strict=True)
    legacy_backups = [
        legacy_temp / name for name in ("hindsight_client_backup.py", "hindsight_python_readme_backup.md")
    ]
    if any(path.exists() for path in legacy_backups):
        raise ValueError("Existing fixed-name legacy generator staging files must not be overwritten")
    print(
        json.dumps(
            {
                "resolvedDeletionTargets": [str(path) for path in resolved],
                "guardedInputs": list(originals),
                "ownedGuardRoot": str(guard_root),
            }
        ),
        flush=True,
    )
    changed = []
    result = None
    try:
        result = subprocess.run(
            ["G:/Git/bin/bash.exe", "scripts/generate-clients.sh"],
            cwd=ROOT,
            env=environment,
            stdin=subprocess.DEVNULL,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    finally:
        for name, content in originals.items():
            path = ROOT / name
            actual = path.read_bytes() if path.is_file() else None
            if actual != content:
                changed.append(
                    {
                        "file": name,
                        "before": hashlib.sha256(content).hexdigest(),
                        "after": hashlib.sha256(actual).hexdigest() if actual is not None else None,
                    }
                )
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
        record = {
            "generatorExitCode": result.returncode if result is not None else None,
            "restoredChangedMaintainedInputs": changed,
            "maintainedSha256": {name: hashlib.sha256(content).hexdigest() for name, content in originals.items()},
            "resolvedDeletionTargets": [str(path) for path in resolved],
        }
        with evidence.open("x", encoding="utf-8") as output:
            json.dump(record, output, indent=2)
            output.write("\n")
        print(json.dumps({"evidence": str(evidence), **record}), flush=True)
    # Restoration protects maintained source, but must never turn generator
    # corruption of that source into a successful canonical-generation verdict.
    return result.returncode if not changed else 1


if __name__ == "__main__":
    raise SystemExit(main())
