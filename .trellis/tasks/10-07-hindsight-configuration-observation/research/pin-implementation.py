"""Capture the final source delta while preserving the pre-5A dirty baseline."""

import hashlib
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
baseline = json.loads((HERE / "pre-implementation-baseline-2026-10-07.json").read_text(encoding="utf-8"))
repositories = []
for previous in baseline:
    root = Path(previous["root"])
    original = {row["path"]: row["sha256"] for row in previous["files"]}
    status = subprocess.check_output(["git", "status", "--porcelain", "-uall"], cwd=root, text=True, encoding="utf-8")
    files, preserved = [], []
    for line in status.splitlines():
        relative = line[3:].replace("\\", "/")
        if relative.startswith((".trellis/tasks/", ".trellis/workspace/", ".trellis/.")):
            continue
        path = root / relative
        if not path.is_file():
            raise RuntimeError(f"Unexpected non-file source delta: {relative}")
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        row = {"file": relative, "bytes": len(content), "sha256": digest}
        if original.get(relative) == digest:
            preserved.append(row)
            continue
        content.decode("utf-8")
        assert not content.startswith(b"\xef\xbb\xbf"), f"Unexpected BOM: {relative}"
        files.append(row)
    repositories.append({"root": str(root), "head": previous["head"], "files": files, "preservedBaselineSource": preserved})
(HERE / "implementation-source-identities.json").write_text(json.dumps(repositories, indent=2) + "\n", encoding="utf-8")
print(json.dumps([{ "root": row["root"], "changed": len(row["files"]), "preservedBaselineSource": len(row["preservedBaselineSource"]) } for row in repositories]))
