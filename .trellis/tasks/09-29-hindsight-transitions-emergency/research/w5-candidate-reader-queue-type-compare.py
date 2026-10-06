"""Compare the exact saved baseline preimages with the scoped current Native files."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path


RESEARCH = Path(__file__).resolve().parent
NATIVE = Path("H:/hindsight")
PREIMAGES = RESEARCH / "w5-candidate-reader-queue-preimages"
MANIFEST = json.loads((PREIMAGES / "manifest.json").read_text(encoding="utf-8"))
OWNED = RESEARCH.parents[2] / ".runtime" / f"w5-candidate-reader-queue-types-{uuid.uuid4().hex}"


@dataclass(frozen=True)
class CheckResult:
    exit_code: int
    normalized: list[tuple]


def check(root: Path, label: str, paths: list[str]) -> CheckResult:
    command = [str(NATIVE / ".venv/Scripts/ty.exe"), "check", "--project", str(NATIVE),
               "--python", str(NATIVE / ".venv/Scripts/python.exe"),
               "--extra-search-path", str(root), "--output-format", "gitlab"]
    command.extend(str(root / path) for path in paths)
    result = subprocess.run(command, cwd=NATIVE, capture_output=True, text=True, encoding="utf-8", check=False)
    (OWNED / f"{label}.stdout.json").write_text(result.stdout, encoding="utf-8")
    (OWNED / f"{label}.stderr.txt").write_text(result.stderr, encoding="utf-8")
    # ty emits empty GitLab output on a clean exit. Do not confuse a failed
    # invocation with that empty-success representation.
    if result.stdout.strip():
        findings = json.loads(result.stdout)
    else:
        assert result.returncode == 0, "TYPE_CHECK_FAILED_WITHOUT_DIAGNOSTICS"
        findings = []
    normalized = []
    for finding in findings:
        path = Path(finding["location"]["path"])
        path = path if path.is_absolute() else NATIVE / path
        relative = path.relative_to(root).as_posix()
        position = finding["location"]["positions"]
        lines = path.read_text(encoding="utf-8").splitlines()
        source = "\n".join(lines[position["begin"]["line"] - 1:position["end"]["line"]])
        normalized.append((relative, finding["description"], finding["severity"],
                           position["begin"]["column"], position["end"]["column"], source))
    return CheckResult(result.returncode, sorted(normalized))


def main() -> None:
    OWNED.mkdir(parents=True, exist_ok=False)
    baseline = OWNED / "baseline"
    source = NATIVE / "hindsight-api-slim"
    # Overlay every approved file using the newly saved exact preimage bytes.
    shutil.copytree(source / "hindsight_api", baseline / "hindsight_api",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for entry in MANIFEST["files"]:
        data = (PREIMAGES / entry["path"]).read_bytes()
        assert len(data) == entry["bytes"] and hashlib.sha256(data).hexdigest() == entry["sha256"]
        (baseline / entry["path"]).write_bytes(data)
    paths = [row["path"] for row in MANIFEST["files"]]
    before = check(baseline, "baseline", paths)
    after = check(source, "current", paths)
    equivalent = before.normalized == after.normalized
    report = {"ownedPath": str(OWNED), "preimageHashesVerified": MANIFEST["files"],
              "baselineExit": before.exit_code, "baselineDiagnostics": len(before.normalized),
              "currentExit": after.exit_code, "currentDiagnostics": len(after.normalized),
              "sameDiagnosticsOnExactSource": equivalent, "realModelRequests": 0}
    (OWNED / "result.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))
    if not equivalent:
        print(json.dumps({"new": [item for item in after.normalized if item not in before.normalized],
                          "removed": [item for item in before.normalized if item not in after.normalized]}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
