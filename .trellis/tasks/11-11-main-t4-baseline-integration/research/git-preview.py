"""Produce a bounded modern merge preview without changing index/worktree/refs."""
import json
import subprocess
from pathlib import Path

result = subprocess.run(
    ["git", "merge-tree", "--write-tree", "--name-only", "9b98794a673efb561682b9fd451fe1da2db95086", "63faf8119be1747b685aacf43529d754626ab35c"],
    capture_output=True, text=True, encoding="utf-8",
)
if result.returncode not in (0, 1):
    raise SystemExit(result.stderr or result.stdout)
lines = result.stdout.splitlines()
separator = lines.index("") if "" in lines else len(lines)
paths = lines[1:separator]
groups = {}
for path in paths:
    group = "/".join(path.split("/")[:3])
    groups[group] = groups.get(group, 0) + 1
report = {"command": result.args, "exit_code": result.returncode,
          "preview_tree": lines[0], "conflict_count": len(paths),
          "conflicts": paths, "groups": groups, "diagnostics": lines[separator + 1:]}
Path(__file__).with_name("git-preview.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({key: report[key] for key in ["exit_code", "preview_tree", "conflict_count", "groups"]}, indent=2))
