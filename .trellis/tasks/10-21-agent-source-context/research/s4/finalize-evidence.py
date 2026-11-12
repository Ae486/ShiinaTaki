"""Compare only S4-owned paths with the saved working-tree preimages."""
import difflib
import hashlib
import json
from pathlib import Path

root = Path.cwd().resolve()
expected = Path("H:/TakiAgent-worktrees/t4").resolve()
if root != expected:
    raise SystemExit("wrong worktree")
evidence = root / ".trellis/tasks/10-21-agent-source-context/research/s4"
manifest = json.loads((evidence / "preimages.json").read_text(encoding="utf-8"))
changes = []
patch = []
violations = []
for row in manifest:
    if not row["owned"]:
        continue
    path = row["path"]
    target = root / path
    after = target.read_bytes()
    before = (evidence / "preimages" / path).read_bytes() if row["existed"] else b""
    if before == after:
        continue
    changes.append({"path": path, "new": not row["existed"], "beforeSha256": row["sha256"],
                    "afterSha256": hashlib.sha256(after).hexdigest(),
                    "ownership": "named existing index lines only; Runtime additions are independent" if path.endswith("index.md") else "S4 subset"})
    if after.startswith(b"\xef\xbb\xbf"):
        violations.append({"path": path, "error": "UTF-8 BOM"})
    text = after.decode("utf-8")
    for number, line in enumerate(text.splitlines(), 1):
        if line.rstrip(" \t") != line:
            violations.append({"path": path, "line": number, "error": "trailing whitespace"})
    patch.extend(difflib.unified_diff(before.decode("utf-8").replace("\r\n", "\n").splitlines(keepends=True),
                                    text.replace("\r\n", "\n").splitlines(keepends=True),
                                    fromfile="working-preimage/" + path, tofile="current/" + path))
(evidence / "changed-files.json").write_text(json.dumps(changes, indent=2) + "\n", encoding="utf-8")
(evidence / "working-preimage.diff").write_text("".join(patch), encoding="utf-8", newline="\n")
(evidence / "source-audit.json").write_text(json.dumps({"changedFiles": len(changes), "violations": violations}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"changedFiles": len(changes), "violations": violations}))
if violations:
    raise SystemExit(1)
