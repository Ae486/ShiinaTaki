"""Seal the approved repair and evidence without rewriting earlier manifests."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


RESEARCH = Path(__file__).resolve().parent
TAKI = RESEARCH.parents[3]
NATIVE = Path("H:/hindsight/hindsight-api-slim")
RUNTIME = TAKI / ".trellis/.runtime"
OUTPUT = RESEARCH / "w5-candidate-baseline-source-manifest.json"
DIAGNOSTIC = RESEARCH / "w5-reentry-candidate-diagnostic-manifest.json"
DIAGNOSTIC_SHA256 = "637cc0fbcbe4b971bf7ecf09926967ff1495993c22fbab30e2a20c27c39361dc"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    assert sha256(DIAGNOSTIC) == DIAGNOSTIC_SHA256
    preimages = RESEARCH / "w5-candidate-baseline-preimages"
    before = json.loads((preimages / "manifest.json").read_text(encoding="utf-8"))
    changed = {(NATIVE / row["path"]).as_posix() for row in before["files"]}
    diagnostic = json.loads(DIAGNOSTIC.read_text(encoding="utf-8"))
    mismatches = {row["path"] for row in diagnostic["files"] if sha256(Path(row["path"])) != row["sha256"]}
    assert mismatches == changed, sorted(mismatches ^ changed)
    for row in before["files"]:
        assert sha256(preimages / row["path"]) == row["sha256"]
    paths = [NATIVE / row["path"] for row in before["files"]]
    paths.extend(NATIVE / path for path in before["newFiles"])
    paths.extend([
        NATIVE / "tests/native_results/test_transition_baseline_reads.py",
        TAKI / ".trellis/spec/backend/memory-transition-healthy-drivers.md",
        RESEARCH / "w5-candidate-baseline-implementation.md",
        RESEARCH / "w5-candidate-baseline-type-compare.py",
        Path(__file__), DIAGNOSTIC, preimages / "manifest.json",
        RESEARCH / "w5-reentry-candidate-native-clone.py",
    ])
    paths.extend(preimages / row["path"] for row in before["files"])
    for fixture in ("eb76280c7997", "f29f18ecddd8", "eca4208ff82e", "7ef850b84205"):
        root = RUNTIME / "g1-validation" / f"taki-hindsight-g1-{fixture}"
        ownership = json.loads((root / "ownership.json").read_text(encoding="utf-8"))
        assert ownership["stopped"] and not (root / "data").exists() and not Path(ownership["registry"]).exists()
        paths.extend([root / "pytest.log", root / "ownership.json"])
    type_root = RUNTIME / "w5-candidate-baseline-types-0d7722abb5e44504b70fa9ab58828a29"
    paths.extend(type_root / name for name in ("result.json", "baseline.stdout.json", "current.stdout.json"))
    entries = []
    for path in paths:
        data = path.read_bytes()
        if path.suffix in {".py", ".md", ".json"}:
            data.decode("utf-8")
            assert not data.startswith(b"\xef\xbb\xbf"), path
        entries.append({"path": path.as_posix(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    report = {
        "version": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "meaning": "Immutable scoped Native candidate-baseline repair. Correctness evidence only; fresh corpus performance and independent review are parent-owned remaining gates.",
        "approvedProductionPaths": sorted(changed | {(NATIVE / path).as_posix() for path in before["newFiles"]}),
        "diagnosticManifestSha256": DIAGNOSTIC_SHA256,
        "unchangedDiagnosticEntries": len(diagnostic["files"]) - len(changed),
        "files": entries,
    }
    with OUTPUT.open("x", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(report, indent=2) + "\n")
    # Read back every seal entry, including preimages and completed log evidence.
    sealed = json.loads(OUTPUT.read_text(encoding="utf-8"))
    assert all(sha256(Path(row["path"])) == row["sha256"] for row in sealed["files"])
    print(json.dumps({"manifest": OUTPUT.as_posix(), "entries": len(entries), "sha256": sha256(OUTPUT),
                      "unchangedDiagnosticEntries": report["unchangedDiagnosticEntries"]}))


if __name__ == "__main__":
    main()
