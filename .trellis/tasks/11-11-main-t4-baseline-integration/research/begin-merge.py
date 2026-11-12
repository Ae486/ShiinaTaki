"""Begin the authorized isolated merge with exact-input/worktree safeguards."""
import json
import subprocess
from pathlib import Path

def git(*args):
    return subprocess.check_output(["git", *args], text=True, encoding="utf-8").strip()

assert Path.cwd().resolve() == Path("G:/TakiAgent-integration").resolve()
assert git("branch", "--show-current") == "integration/main-t4-20261111"
assert git("rev-parse", "HEAD") == "9b98794a673efb561682b9fd451fe1da2db95086"
changes = git("status", "--porcelain")
assert changes == "?? .trellis/tasks/11-11-main-t4-baseline-integration/", changes
result = subprocess.run(["git", "merge", "--no-commit", "--no-ff", "63faf8119be1747b685aacf43529d754626ab35c"],
                        capture_output=True, text=True, encoding="utf-8")
Path(__file__).with_name("merge-init.log").write_text(result.stdout + result.stderr, encoding="utf-8")
if result.returncode not in (0, 1):
    raise SystemExit(result.stderr or result.stdout)
paths = git("diff", "--name-only", "--diff-filter=U").splitlines()
Path(__file__).with_name("merge-conflicts.json").write_text(json.dumps(paths, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"merge_exit": result.returncode, "unmerged_paths": len(paths), "merge_head": git("rev-parse", "MERGE_HEAD")}, indent=2))
