"""Freeze reviewable B2 source bytes without changing the B1 acceptance baseline."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

RESEARCH = Path(__file__).resolve().parent
TAKI = RESEARCH.parents[3]
NATIVE = Path("H:/hindsight")
OWNED = [
    "TAKI_PATCHES.md",
    "hindsight-api-slim/hindsight_api/config_resolver.py",
    "hindsight-api-slim/hindsight_api/admin/cli.py",
    "hindsight-api-slim/hindsight_api/api/taki_template_lifecycle.py",
    "hindsight-api-slim/hindsight_api/alembic/versions/e62a3d0b9c54_add_template_label_provenance.py",
    *[f"hindsight-api-slim/hindsight_api/engine/{name}.py" for name in (
        "template_label_evidence", "template_label_publication", "template_label_store", "template_snapshot",
        "replication", "transition_snapshot", "transfer/export", "consolidation/consolidator",
        "retain/template_label_origin", "retain/receipt_context", "retain/fact_extraction", "retain/types",
        "retain/orchestrator",
    )],
    *[f"hindsight-api-slim/tests/native_results/{name}.py" for name in (
        "template_label_helpers", "test_template_labels", "test_template_label_extraction",
        "test_template_label_lifecycle", "test_template_label_recovery", "test_template_label_storage",
        "test_template_label_runtime_consumer",
    )],
]
CORE_FIXTURE = [
    "packages/core/src/testing/hindsight-template-exchange-fixture.ts",
    "packages/core/src/testing/hindsight-template-native-consumer.fixture.ts",
    "packages/core/src/memory/hindsight/hindsight-template-label-evidence.ts",
    "packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts",
    "packages/core/src/memory/hindsight/hindsight-application-binding-context.ts",
]


def record(root: Path, name: str) -> dict[str, object]:
    target = (root / name).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("Source path escaped its repository")
    data = target.read_bytes()
    return {"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main() -> None:
    name = sys.argv[1]
    if not re.fullmatch(r"[a-z0-9_-]+", name):
        raise ValueError("A unique bounded source snapshot name is required")
    baseline = json.loads((RESEARCH / "b2-native-start-source.json").read_text(encoding="utf-8"))
    files = [record(NATIVE, path) for path in sorted(set(OWNED) | {entry["path"] for entry in baseline["files"]})]
    core = [record(TAKI, path) for path in CORE_FIXTURE]
    old = {entry["path"]: entry["sha256"] for entry in baseline["files"]}
    result = {
        "capturedAtUtc": datetime.now(UTC).isoformat(),
        "nativeHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=NATIVE, text=True).strip(),
        "nativeBranch": subprocess.check_output(["git", "branch", "--show-current"], cwd=NATIVE, text=True).strip(),
        "migration": "e62a3d0b9c54", "parentMigration": "e51c2f9a8b43",
        "files": files, "coreFixtureFiles": core,
        "changedSinceStart": [entry["path"] for entry in files if old.get(entry["path"]) != entry["sha256"]],
        "lifecycleSpec": record(TAKI, ".trellis/spec/backend/hindsight-template-lifecycle.md"),
    }
    path = RESEARCH / f"b2-native-source-{name}.json"
    with path.open("x", encoding="utf-8") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps({"manifest": str(path), "nativeFiles": len(files), "coreFixtureFiles": len(core),
                      "changedSinceStart": len(result["changedSinceStart"])}))


if __name__ == "__main__":
    main()
