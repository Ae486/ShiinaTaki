"""Record W3 source ownership against the retained final W2 dirty-tree baseline."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


TAKI = Path("H:/TakiAgent")
NATIVE = Path("H:/hindsight")
RESEARCH = TAKI / ".trellis/tasks/09-29-hindsight-transitions-emergency/research"


def read(name: str):
    return json.loads((RESEARCH / name).read_text(encoding="utf-8-sig"))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=False)


def changed(root: Path) -> list[str]:
    tracked = git(root, "diff", "HEAD", "--name-only", "-z")
    added = git(root, "ls-files", "--others", "--exclude-standard", "-z")
    assert tracked.returncode == added.returncode == 0
    return sorted(set(filter(None, (tracked.stdout + added.stdout).split("\0"))))


def entries(root: Path, paths: list[str], baseline: dict[str, str]) -> list[dict[str, str | None]]:
    return [
        {"path": path, "beforeW3": baseline.get(path), "sha256": digest(root / path)}
        for path in paths
        if (root / path).is_file() and digest(root / path) != baseline.get(path)
    ]


def main() -> None:
    final_w2 = read("w2-checker-source-hashes.json")
    native_baseline = {row["path"]: row["sha256"] for row in read("native-preimplementation-baseline.json")["files"]}
    native_baseline.update({row["path"]: row["sha256"] for row in read("w2-native-files.json")["files"]})
    native_baseline.update({row["path"]: row["after"] for row in final_w2["native"]})
    taki_baseline = read("w2-checker-baseline.json")["H:\\TakiAgent"]
    taki_baseline.update({row["path"]: row["sha256"] for row in final_w2["taki"]})
    native = entries(NATIVE, changed(NATIVE), native_baseline)
    expected_native = set(read("w3-native-owned-paths.json")) | {"TAKI_PATCHES.md"}
    unexpected_native = [row["path"] for row in native if row["path"] not in expected_native]
    native_missing = [path for path in native_baseline if not (NATIVE / path).is_file()]
    allowed_specs = {
        ".trellis/spec/backend/memory-transitions.md",
        ".trellis/spec/backend/canonical-local-memory-runtime.md",
        ".trellis/spec/backend/hindsight-application-runtime.md",
    }
    taki_paths = [path for path in changed(TAKI) if path.startswith("packages/") or path in allowed_specs]
    taki = entries(TAKI, taki_paths, taki_baseline)
    encoding_failures = []
    index_failures = []
    whitespace_failures = []
    for root, rows in ((TAKI, taki), (NATIVE, native)):
        for row in rows:
            path = root / row["path"]
            data = path.read_bytes()
            try:
                source = data.decode("utf-8")
            except UnicodeDecodeError:
                encoding_failures.append(str(path))
                continue
            if data.startswith(b"\xef\xbb\xbf"):
                encoding_failures.append(str(path))
            if any(line.endswith((" ", "\t")) for line in source.splitlines()):
                whitespace_failures.append(str(path))
            if root == TAKI and path.suffix == ".ts" and not path.name.endswith(".test.ts"):
                if not all(tag in source[:600] for tag in ("INPUT:", "OUTPUT:", "POS:")):
                    index_failures.append(f"header:{row['path']}")
                index = path.parent / "index.md"
                if not index.exists() or path.name not in index.read_text(encoding="utf-8"):
                    index_failures.append(f"index:{row['path']}")
    diff_results = []
    for root in (TAKI, NATIVE):
        for args in (("diff", "--check"), ("diff", "--cached", "--check")):
            result = git(root, *args)
            diff_results.append({"root": str(root), "args": args, "exitCode": result.returncode, "output": result.stdout})
    stage = TAKI / ".trellis/.runtime/g1-codegen/97f9a4800627/python/hindsight_client_api"
    generated = NATIVE / "hindsight-clients/python/hindsight_client_api"
    stage_paths = sorted(stage.rglob("*.py"))
    generated_mismatch = [str(path.relative_to(stage)) for path in stage_paths if digest(path) != digest(generated / path.relative_to(stage))]
    stage_names = {path.relative_to(stage) for path in stage_paths}
    generated_mismatch.extend(str(path.relative_to(generated)) for path in generated.rglob("*.py") if path.relative_to(generated) not in stage_names)
    untouched = [path for path, expected in native_baseline.items() if (NATIVE / path).is_file() and digest(NATIVE / path) == expected]
    report = {
        "task": str(RESEARCH.parent),
        "nativeRoot": str(NATIVE), "takiRoot": str(TAKI),
        "heads": {str(root): git(root, "rev-parse", "HEAD").stdout.strip() for root in (TAKI, NATIVE)},
        "native": native, "taki": taki,
        "preservedNativeBaselineCount": len(untouched), "nativeMissing": native_missing,
        "unexpectedNative": unexpected_native, "encodingFailures": encoding_failures,
        "indexFailures": index_failures, "whitespaceFailures": whitespace_failures,
        "diffChecks": diff_results,
        "generatedPython": {"canonicalRun": "97f9a4800627", "compared": len(stage_paths), "mismatches": generated_mismatch},
    }
    (RESEARCH / "w3-source-ownership.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in {"native", "taki"}}, indent=2))
    print(f"W3 native paths: {len(native)}; Taki source/spec paths: {len(taki)}")
    assert not any((native_missing, unexpected_native, encoding_failures, index_failures, whitespace_failures, generated_mismatch))
    assert all(item["exitCode"] == 0 for item in diff_results)


if __name__ == "__main__":
    main()
