"""Pin-check and execute the authorized read-only V4 comparison once; retain all outputs."""

import difflib
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PACKET = ROOT / "dependency-comparison-v4"
V3 = ROOT / "dependency-comparison-v3"
DESTINATION = HERE / "execution.json"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


if DESTINATION.exists():
    raise ValueError("comparison_evidence_already_exists")
release = read(PACKET / "release.json")
release_hash = sha(PACKET / "release.json")
assert release_hash == "38b3529030e7b7273a2f95e67df9f3e54dc75199962472eec96af5828dda3eed"
assert set(path.name for path in PACKET.iterdir()) == {"README.md", "compare.py", "release.json", "source-pyproject.toml"}
assert all(sha(PACKET / name) == digest for name, digest in release["files"].items())
assert (PACKET / "source-pyproject.toml").read_bytes() == (V3 / "source-pyproject.toml").read_bytes()
previous = read(V3 / "release.json")
assert release["archive"] == previous["archive"] and release["inventoryResultSha256"] == previous["inventoryResultSha256"]
assert release["hostPython"] == previous["hostPython"] and release["packaging"] == previous["packaging"]
assert Path(sys.executable).resolve() == Path(release["hostPython"]["path"]).resolve()
assert sha(Path(sys.executable)) == release["hostPython"]["sha256"]
parser = Path(release["packaging"]["path"])
assert {path.relative_to(parser).as_posix() for path in parser.rglob("*.py")} == set(release["packaging"]["files"])
assert all(sha(parser / name) == digest for name, digest in release["packaging"]["files"].items())
diff = "".join(difflib.unified_diff((V3 / "compare.py").read_text().splitlines(True),
                                    (PACKET / "compare.py").read_text().splitlines(True),
                                    fromfile="v3/compare.py", tofile="v4/compare.py"))
(HERE / "source-delta.diff").write_text(diff, encoding="utf-8")
input_path = Path(release["archive"]) / "result.json"
before = sha(input_path)
assert before == release["inventoryResultSha256"] == "51afb014ed47b811813880d0b0c6f8e16beaae9cb8db0aa9cee0cec5dc6bf71e"
preserve = [V3 / "release.json", V3 / "compare.py",
            ROOT / "c2b-dependency-comparison-v3-review-01a180b6/comparison-execution.json",
            ROOT / "c2b-dependency-comparison-v3-review-01a180b6/diagnostic-closure.json"]
old_hashes = {str(path): sha(path) for path in preserve}
argv = [release["hostPython"]["path"], "-I", "-B", "-S", str(PACKET / "compare.py")]
started = datetime.now(timezone.utc).isoformat()
completed = subprocess.run(argv, cwd="H:/TakiAgent", capture_output=True, timeout=15, check=False)
after = sha(input_path)
record = {"argv": argv, "startedAt": started, "completedAt": datetime.now(timezone.utc).isoformat(),
          "exitCode": completed.returncode, "stdout": completed.stdout.decode("utf-8"), "stderr": completed.stderr.decode("utf-8"),
          "stdoutBytes": len(completed.stdout), "stdoutSha256": hashlib.sha256(completed.stdout).hexdigest(),
          "releaseSha256": release_hash, "rawInputSha256Before": before, "rawInputSha256After": after,
          "inputUnchanged": before == after, "preservedEvidenceSha256": old_hashes,
          "originalArchiveInput": True, "modifiedInputDiagnostic": False, "dockerExecuted": False}
with DESTINATION.open("x", encoding="utf-8") as stream:
    stream.write(json.dumps(record, indent=2) + "\n")
assert before == after and all(sha(path) == digest for path, digest in [(Path(name), value) for name, value in old_hashes.items()])
assert all(sha(PACKET / name) == digest for name, digest in release["files"].items())
answer = json.loads(completed.stdout)
assert completed.returncode == 0 and not record["stderr"]
assert "metadataCompatible" not in answer and answer["comparisonComplete"] is True
assert answer["dependencyConstraintsSatisfied"] is True and answer["metadataConformant"] is False
assert answer["deploymentReady"] is False and answer["issues"] == []
assert answer["installedDistributionCount"] == 221 and answer["reachableDistributionCount"] == 195
assert answer["evaluatedRequirements"] == 2026 and len(answer["metadataWarnings"]) == 1
warning = answer["metadataWarnings"][0]
assert warning == {"kind": "noncanonical_declared_extra", "package": "litellm", "version": "1.93.0",
                   "metadataVersion": "2.4", "file": "litellm-1.93.0.dist-info/METADATA",
                   "sha256": "2079a96229cf0dabfb2c2f87b5109a7b36108818fa790a2a1da86bd0db97a1ce",
                   "rawExtra": "extra_proxy", "normalizedExtra": "extra-proxy"}
assert answer["inventoryResultSha256"] == before and answer["comparatorSha256"] == release["files"]["compare.py"]
summary = {"verdict": "PASS_ORIGINAL_INPUT_CONSTRAINT_REPORT", "comparisonComplete": answer["comparisonComplete"],
           "dependencyConstraintsSatisfied": answer["dependencyConstraintsSatisfied"], "metadataConformant": answer["metadataConformant"],
           "metadataConformanceScope": answer["metadataConformanceScope"], "metadataWarnings": answer["metadataWarnings"],
           "installedDistributionCount": 221, "reachableDistributionCount": 195, "evaluatedRequirements": 2026,
           "issues": answer["issues"], "inputUnchanged": before == after, "deploymentReady": False}
(HERE / "verification.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary))
