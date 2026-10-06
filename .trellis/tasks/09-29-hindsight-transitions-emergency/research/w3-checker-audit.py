"""Independently hash W3 review outputs without rewriting the delivery manifest."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

TAKI = Path("H:/TakiAgent")
NATIVE = Path("H:/hindsight")
RESEARCH = TAKI / ".trellis/tasks/09-29-hindsight-transitions-emergency/research"
NEW_NATIVE = "hindsight-api-slim/tests/native_results/test_transition_unused_sources.py"
REPAIRED_TAKI = {
    "packages/core/src/memory/transitions/transition-unused-delta.ts",
    "packages/core/src/memory/transitions/transition-unused-delta.test.ts",
    "packages/core/src/memory/transitions/index.md",
    ".trellis/spec/backend/memory-transitions.md",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(name: str):
    return json.loads((RESEARCH / name).read_text(encoding="utf-8-sig"))


def git(root: Path, *args: str):
    return subprocess.run(["git", *args], cwd=root, text=True, capture_output=True, check=False)


def main() -> None:
    manifest_path = RESEARCH / "w3-source-ownership.json"
    delivery_hash = digest(manifest_path)
    delivery = read(manifest_path.name)
    final_w2 = read("w2-checker-source-hashes.json")
    baseline = {row["path"]: row["sha256"] for row in read("native-preimplementation-baseline.json")["files"]}
    baseline.update({row["path"]: row["sha256"] for row in read("w2-native-files.json")["files"]})
    baseline.update({row["path"]: row["after"] for row in final_w2["native"]})
    report = {"deliveryManifestSha256": delivery_hash, "heads": {}, "taki": [], "native": []}
    encoding_failures, index_failures, whitespace_failures = [], [], []
    for label, root in (("taki", TAKI), ("native", NATIVE)):
        report["heads"][str(root)] = git(root, "rev-parse", "HEAD").stdout.strip()
        rows = delivery[label] + ([{"path": NEW_NATIVE, "sha256": None}] if label == "native" else [])
        for row in rows:
            path = root / row["path"]
            current = digest(path)
            report[label].append({"path": row["path"], "delivery": row["sha256"], "sha256": current})
            data = path.read_bytes()
            try:
                source = data.decode("utf-8")
            except UnicodeDecodeError:
                encoding_failures.append(row["path"])
                continue
            if data.startswith(b"\xef\xbb\xbf"):
                encoding_failures.append(row["path"])
            if any(line.endswith((" ", "\t")) for line in source.splitlines()):
                whitespace_failures.append(row["path"])
            if root == TAKI and path.suffix == ".ts" and not path.name.endswith(".test.ts"):
                if not all(tag in source[:600] for tag in ("INPUT:", "OUTPUT:", "POS:")):
                    index_failures.append("header:" + row["path"])
                index = path.parent / "index.md"
                if not index.exists() or path.name not in index.read_text(encoding="utf-8"):
                    index_failures.append("index:" + row["path"])
    native_owned = {row["path"] for row in report["native"]}
    preserved = [path for path, expected in baseline.items() if (NATIVE / path).is_file() and digest(NATIVE / path) == expected]
    missing = [path for path in baseline if not (NATIVE / path).is_file()]
    changed = git(NATIVE, "diff", "HEAD", "--name-only", "-z")
    added = git(NATIVE, "ls-files", "--others", "--exclude-standard", "-z")
    assert changed.returncode == added.returncode == 0
    unexpected = [path for path in set(filter(None, (changed.stdout + added.stdout).split("\0")))
                  if path not in native_owned and (NATIVE / path).is_file() and digest(NATIVE / path) != baseline.get(path)]
    diffs = []
    for root in (TAKI, NATIVE):
        for args in (("diff", "--check"), ("diff", "--cached", "--check")):
            result = git(root, *args)
            diffs.append({"root": str(root), "args": args, "exitCode": result.returncode,
                          "output": result.stdout + result.stderr})
    stage = TAKI / ".trellis/.runtime/g1-codegen/97f9a4800627/python/hindsight_client_api"
    generated = NATIVE / "hindsight-clients/python/hindsight_client_api"
    stage_paths = sorted(stage.rglob("*.py"))
    stage_names = {path.relative_to(stage) for path in stage_paths}
    generated_mismatch = [str(path.relative_to(stage)) for path in stage_paths
                          if digest(path) != digest(generated / path.relative_to(stage))]
    generated_mismatch.extend(str(path.relative_to(generated)) for path in generated.rglob("*.py")
                              if path.relative_to(generated) not in stage_names)
    differences = {label: [row["path"] for row in report[label] if row["delivery"] != row["sha256"]]
                   for label in ("taki", "native")}
    report.update({"checkerDifferences": differences, "preservedNativeBaselineCount": len(preserved),
                   "preservedNativeBaseline": preserved, "missingNative": missing, "unexpectedNative": unexpected,
                   "encodingFailures": encoding_failures, "indexFailures": index_failures,
                   "whitespaceFailures": whitespace_failures, "diffChecks": diffs,
                   "generatedPython": {"canonicalRun": "97f9a4800627", "compared": len(stage_paths), "mismatches": generated_mismatch}})
    assert digest(manifest_path) == delivery_hash
    (RESEARCH / "w3-checker-source-hashes.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items()
                      if key not in {"taki", "native", "preservedNativeBaseline"}}, indent=2))
    print(f"Checked {len(report['taki'])} Taki and {len(report['native'])} native paths.")
    assert set(differences["taki"]) == REPAIRED_TAKI and differences["native"] == [NEW_NATIVE]
    assert len(preserved) == delivery["preservedNativeBaselineCount"] == 289
    assert not any((missing, unexpected, encoding_failures, index_failures, whitespace_failures, generated_mismatch))
    assert all(row["exitCode"] == 0 for row in diffs)


if __name__ == "__main__":
    main()
