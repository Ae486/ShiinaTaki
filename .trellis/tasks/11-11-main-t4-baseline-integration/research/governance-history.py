"""Export public code snapshots for read-only historical registry comparison."""
import json
import subprocess
from pathlib import Path

snapshots = {
    "original-v1": "46a84879b3e771c76bba88e941f7cfcc5374d993",
    "scheduled-task-v1": "c692c825092e2df5257ecc804026f2d88f87bf97",
    "main-v3": "c549432d2a47b6837c77d582b0c20cbcb5e12982",
    "t4-v1": "6b36d0dc6ac3e4050a7428e80a8370f8d7d03a53",
}
root = Path(__file__).with_name("governance-history")
root.mkdir(exist_ok=True)
for name, commit in snapshots.items():
    data = subprocess.check_output(["git", "show", f"{commit}:packages/shared/src/governance-registry.ts"])
    (root / f"{name}.ts").write_bytes(data)
(root / "sources.json").write_text(json.dumps(snapshots, indent=2) + "\n", encoding="utf-8")
print(json.dumps(snapshots, indent=2))
