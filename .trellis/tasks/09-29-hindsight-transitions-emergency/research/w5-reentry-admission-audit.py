"""Read-only preservation/static audit; write a new admission delivery inventory only."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess


ROOT = Path("H:/TakiAgent")
RESEARCH = ROOT / ".trellis/tasks/09-29-hindsight-transitions-emergency/research"
INPUT = ROOT / ".trellis/.runtime/w5-reentry-stale-5e63660aa04c4eb4816122fcee449a7c"
CORPUS = ROOT / ".trellis/.runtime/w5-admission-acceptance-b2c21fe0-fb59-4f96-abe7-a66a3cd3c2a4/result.json"
NEW = [
    "packages/core/src/memory/transitions/transition-admission-verification.test.ts",
    "packages/core/src/memory/transitions/transition-independent-projection.test.ts",
]
RESEARCH_NEW = [
    "w5-reentry-renewal.mjs", "w5-reentry-renewal.test.mjs", "w5-reentry-renewal-usage.md",
    "w5-reentry-admission-replay.mjs", "w5-reentry-admission-audit.py",
    "w5-reentry-admission-implementation.md", "w5-reentry-admission-checkpoint.md",
    "w5-reentry-admission-preimages.json", "w5-reentry-admission-red.log",
    "w5-reentry-admission-green-initial.log", "w5-reentry-admission-corpus.log",
    "w5-reentry-admission-regression.log", "w5-reentry-admission-projection-regression.log",
    "w5-reentry-admission-types.log", "w5-reentry-admission-types-final.log",
    "w5-reentry-admission-lint.log", "w5-reentry-admission-lint-final.log",
    "w5-reentry-admission-helper-final.log", "w5-reentry-admission-gate.log",
    "w5-reentry-admission-independent-gate.log", "w5-reentry-admission-boot.log",
    "w5-reentry-admission-cli.log",
]


def digest(path: Path) -> dict:
    body = path.read_bytes()
    return {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    preimages = read(RESEARCH / "w5-reentry-admission-preimages.json")
    modified = []
    for name, expected in preimages["files"].items():
        assert digest(Path(preimages["root"]) / name) == expected, f"Preimage changed: {name}"
        if digest(ROOT / name) != expected:
            modified.append(name)
    assert len([name for name in modified if name.endswith(".ts")]) == 14
    corpus = read(CORPUS)
    assert corpus["launchHashes"] == corpus["endHashes"]
    for name, expected in corpus["launchHashes"].items():
        assert digest(ROOT / name)["sha256"] == expected, f"Corpus-tested source changed: {name}"
    assert corpus["before"] == corpus["after"] == {"intents": 1, "attempts": 1, "operations": 8}
    assert corpus["externalCalls"] == corpus["modelCalls"] == 0 and corpus["sourcePreserved"]
    assert not corpus.get("harnessError")
    result = next(row for row in corpus["events"] if row["boundary"] == "submit-result")
    assert result["message"] == "W5_DIAGNOSTIC_ADMISSION_REACHED_ROLLBACK" and result["milliseconds"] < 120_000
    inputs = read(INPUT / "copy-manifest.json")["files"]
    for name, expected in inputs.items():
        assert digest(INPUT / name) == expected, f"Input changed: {name}"
    anchors = {
        "w5-reentry-helper-independent-source-manifest.json": "22e8c9eda7b0b7a5bd50873c58bf9b274e45cbf2a271dbcfe08dd0f7319ed78c",
        "w5-reentry-stale-diagnostic-manifest.json": "d5197d0260a1e10e68477195c3b925ed1d1f3475cf90d24b9c150cc2dd6335b0",
    }
    for name, expected in anchors.items():
        assert digest(RESEARCH / name)["sha256"] == expected, f"Earlier manifest changed: {name}"
    prior = read(RESEARCH / "w5-reentry-helper-independent-source-manifest.json")
    preserved = []
    for category in ["sources", "preserved", "unchangedCombinedSourcesSpecsConfig", "evidence", "independentPreimages"]:
        for entry in prior[category]:
            if entry["path"] in modified:
                continue
            actual = digest(ROOT / entry["path"])
            assert actual == {"sha256": entry["sha256"], "bytes": entry["bytes"]}, f"Unowned predecessor changed: {entry['path']}"
            preserved.append(entry)
    paths = modified + NEW + [str((RESEARCH / name).relative_to(ROOT)).replace("\\", "/") for name in RESEARCH_NEW]
    inventory = {}
    syntax = []
    for name in paths:
        path = ROOT / name
        body = path.read_bytes()
        assert not body.startswith(b"\xef\xbb\xbf"), f"BOM: {name}"
        content = body.decode("utf-8")
        if path.suffix != ".log":
            assert content.endswith("\n"), f"Missing newline: {name}"
            assert all(line == line.rstrip() for line in content.splitlines()), f"Whitespace: {name}"
        if path.suffix == ".mjs":
            subprocess.run(["node", "--check", str(path)], check=True, capture_output=True)
            syntax.append(name)
        if path.suffix == ".py":
            compile(content, str(path), "exec")
            syntax.append(name)
        if path.suffix == ".ts" and not name.endswith(".test.ts"):
            assert content.startswith("/**") and all(marker in content.split("*/", 1)[0]
                                                       for marker in ["INPUT:", "OUTPUT:", "POS:"]), name
            assert path.name in (path.parent / "index.md").read_text(encoding="utf-8")
        inventory[name] = digest(path)
    audit = {"version": 1, "preimages": len(preimages["files"]), "changedExisting": modified,
             "productionSources": 14, "inputsPreserved": len(inputs), "priorEntriesPreserved": len(preserved),
             "artifacts": len(inventory), "syntaxChecks": len(syntax), "utf8NoBomWhitespaceHeadersIndexes": "pass",
             "corpusMilliseconds": result["milliseconds"], "corpusSourceMatchesCurrent": True,
             "externalCalls": 0, "modelCalls": 0}
    (RESEARCH / "w5-reentry-admission-audit.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    manifest = {"version": 1, "scope": "Independent synchronous admission verification and explicit task-only renewal",
                "files": inventory, "preservedInputs": inputs, "preservedPredecessors": preserved,
                "priorManifestHashes": anchors, "corpusResult": {"path": str(CORPUS), **digest(CORPUS)},
                "audit": digest(RESEARCH / "w5-reentry-admission-audit.json")}
    (RESEARCH / "w5-reentry-admission-source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(audit))


if __name__ == "__main__":
    main()
