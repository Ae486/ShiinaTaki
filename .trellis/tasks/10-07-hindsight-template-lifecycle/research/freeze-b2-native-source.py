"""Freeze Native implementation inputs without changing the reviewed B1 evidence."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

RESEARCH = Path(__file__).resolve().parent
NATIVE = Path("H:/hindsight")
TAKI = RESEARCH.parents[3]


def main() -> None:
    output = RESEARCH / "b2-native-start-source.json"
    if output.exists():
        raise ValueError("The original B2 source inventory is immutable")
    reviewed = json.loads((RESEARCH / "b1-reviewed-source.json").read_text(encoding="utf-8"))
    repository = next(item for item in reviewed["repositories"] if Path(item["root"]).resolve() == NATIVE.resolve())
    files = []
    for item in repository["files"]:
        raw = (NATIVE / item["path"]).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != item["sha256"]:
            raise ValueError(f"Reviewed Native source changed before B2: {item['path']}")
        files.append({"path": item["path"], "bytes": len(raw), "sha256": digest})
    spec_path = ".trellis/spec/backend/hindsight-template-lifecycle.md"
    raw_spec = (TAKI / spec_path).read_bytes()
    evidence = {
        "capturedAtUtc": datetime.now(timezone.utc).isoformat(),
        "nativeRoot": str(NATIVE),
        "nativeHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=NATIVE, text=True).strip(),
        "nativeBranch": subprocess.check_output(["git", "branch", "--show-current"], cwd=NATIVE, text=True).strip(),
        "parentMigration": "e51c2f9a8b43",
        "reservedMigration": "e62a3d0b9c54",
        "files": files,
        "takiSpec": {"path": spec_path, "bytes": len(raw_spec), "sha256": hashlib.sha256(raw_spec).hexdigest()},
    }
    output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"nativeFilesMatched": len(files), "path": str(output), "head": evidence["nativeHead"]}))


if __name__ == "__main__":
    main()
