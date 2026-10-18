"""Wrap the existing credential-free runner with complete current Core/Shared input identities."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys

RESEARCH = Path(__file__).resolve().parent
ROOT = RESEARCH.parents[3]


def snapshot() -> list[dict[str, str]]:
    files = set()
    for package in ("core", "shared"):
        files.update((ROOT / "packages" / package / "src").rglob("*.ts"))
        files.update((ROOT / "packages" / package / "src").rglob("*.json"))
        files.update((ROOT / "packages" / package).glob("*config*"))
        files.add(ROOT / "packages" / package / "package.json")
    files.update(ROOT / name for name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "eslint.config.js"))
    files.update(RESEARCH / name for name in ("b3-core-joint-entry.mjs", "run-b3-core-check.py", "run-b3-core-source-check.py"))
    files.add(ROOT / ".trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py")
    return [{"path": path.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in sorted(files) if path.is_file()]


def main() -> None:
    name, *arguments = sys.argv[1:]
    path = RESEARCH / f"b3-core-{name}-source.json"
    after_path = RESEARCH / f"b3-core-{name}-source-after.json"
    if path.exists() or after_path.exists():
        raise ValueError("Keep previous source identities; use a new check suffix")
    before = snapshot()
    path.write_text(json.dumps(before, indent=2) + "\n", encoding="utf-8")
    result = subprocess.run([sys.executable, str(RESEARCH / "run-b3-core-check.py"), name, *arguments], check=False)
    after = snapshot()
    after_path.write_text(json.dumps(after, indent=2) + "\n", encoding="utf-8")
    left = {row["path"]: row["sha256"] for row in before}
    right = {row["path"]: row["sha256"] for row in after}
    mismatches = sorted(key for key in left.keys() | right.keys() if left.get(key) != right.get(key))
    result_path = RESEARCH / f"b3-core-{name}-result.json"
    evidence = json.loads(result_path.read_text(encoding="utf-8"))
    evidence.update(sourceIdentity=str(path), sourceAfter=str(after_path), inputCount=len(before), sourceMismatches=mismatches)
    result_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"inputCount": len(before), "sourceMismatches": mismatches, "exitCode": result.returncode}))
    raise SystemExit(result.returncode or (1 if mismatches else 0))


if __name__ == "__main__":
    main()
