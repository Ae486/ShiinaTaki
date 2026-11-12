"""Retain latest main Hindsight task decisions in conflicting historical drafts."""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[4]
if subprocess.check_output(["git", "branch", "--show-current"], cwd=ROOT, text=True).strip() != "integration/main-t4-20261111":
    raise RuntimeError("unexpected integration branch")
TASK = ROOT / ".trellis/tasks/08-09-memory-operations-ui"
PATTERN = re.compile(r"^<<<<<<<[^\n]*\n(.*?)^=======\n(.*?)^>>>>>>>[^\n]*\n", re.M | re.S)
for name in ["design.md", "grill.md", "implement.md", "prd.md", "check.jsonl", "implement.jsonl"]:
    path = TASK / name
    original = path.read_text(encoding="utf-8")
    # T4's conflicting text is the older planning/no-implementation snapshot of
    # the same Hindsight task. Nonconflicting T4 additions remain in the merge.
    result, count = PATTERN.subn(lambda match: match[1], original)
    if count:
        path.write_text(result, encoding="utf-8", newline="\n")
    print(f"{name}: {count} latest-main task conflicts reconciled")
