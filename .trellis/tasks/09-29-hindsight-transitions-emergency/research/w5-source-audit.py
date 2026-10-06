"""Read-only W5 ownership, encoding and original-corpus preservation audit."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path("H:/TakiAgent")
NATIVE = Path("H:/hindsight")
RESEARCH = Path(__file__).resolve().parent
BASELINE = json.loads((RESEARCH / "w5-prior-source-baseline.json").read_text(encoding="utf-8"))
NATIVE_PATHS = [row["path"] for row in json.loads((RESEARCH / "w5-native-billing-prior-hashes.json").read_text(encoding="utf-8"))]
NATIVE_PATHS += ["hindsight-api-slim/tests/test_provider_billing_refusal.py",
                 "hindsight-api-slim/tests/test_consolidation_retry_budget.py",
                 "hindsight-api-slim/tests/native_results/test_transition_billing_recovery.py"]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prior_source(relative: str, recorded: dict) -> dict:
    if relative in recorded:
        return {"priorSha256": recorded[relative], "priorSource": "immutable-pre-W5-manifest"}
    # The prior manifest captured dirty paths. A tracked file absent from it was unchanged at that snapshot.
    result = subprocess.run(["git", "show", f"HEAD:{relative}"], cwd=ROOT, capture_output=True, check=False)
    if result.returncode == 0:
        return {"priorSha256": hashlib.sha256(result.stdout).hexdigest(), "priorSource": "HEAD-clean-at-pre-W5"}
    return {"priorSha256": None, "priorSource": "absent-from-HEAD-and-pre-W5-manifest"}


def main() -> None:
    candidates = set()
    for command in (["git", "diff", "--name-only", "-z"], ["git", "ls-files", "--others", "--exclude-standard", "-z"]):
        candidates.update(subprocess.check_output(command, cwd=ROOT).decode("utf-8").strip("\0").split("\0"))
    prior = BASELINE["roots"]["H:/TakiAgent"]
    core = {}
    for relative in sorted(candidates):
        if not relative.startswith(("packages/", "apps/", ".trellis/spec/")):
            continue
        path = ROOT / relative
        if path.is_file() and digest(path) != prior.get(relative):
            core[relative] = {"sha256": digest(path), **prior_source(relative, prior)}
    native_prior = BASELINE["roots"]["H:/hindsight"]
    billing_prior = {row["path"]: row["sha256"] for name in ("w5-native-billing-prior-hashes.json", "w5-native-billing-test-prior-hashes.json")
                     for row in json.loads((RESEARCH / name).read_text(encoding="utf-8"))}
    native = {relative: {"sha256": digest(NATIVE / relative), "priorSha256": billing_prior.get(relative, native_prior.get(relative))}
              for relative in NATIVE_PATHS}
    unexpected = [relative for relative, checksum in native_prior.items()
                  if digest(NATIVE / relative) != checksum and relative not in NATIVE_PATHS]
    issues = []
    for base, entries in ((ROOT, core), (NATIVE, native)):
        for relative in entries:
            raw = (base / relative).read_bytes()
            if raw.startswith(b"\xef\xbb\xbf"):
                issues.append(f"BOM:{relative}")
            value = raw.decode("utf-8")
            if any(line.rstrip(" \t") != line for line in value.splitlines()):
                issues.append(f"trailing-whitespace:{relative}")
            if relative.endswith(".ts") and not relative.endswith(".test.ts") and "/**" not in value[:100]:
                issues.append(f"header:{relative}")
    corpus_root = ROOT / ".trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90"
    original = corpus_root / "application-ad325c12054d4d92b91a81ad2b18fee1"
    manifest_path = corpus_root / "w5-source-preflight-836b286e43414523a304cdbe8f25f84e.json"
    assert digest(manifest_path) == "d27ab04843cd82e1d574b06dda5512ad469bb85a541887414a8ce8707499ab1d"
    source = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in source["entries"]:
        path = original / entry["path"]
        before = path.stat()
        assert before.st_size == entry["bytes"] and digest(path) == entry["sha256"]
        after = path.stat()
        assert before.st_size == after.st_size and before.st_mtime_ns == after.st_mtime_ns
    actual = {path.relative_to(original).as_posix() for path in (original / "data").rglob("*") if path.is_file()}
    actual.update(path.relative_to(original).as_posix() for path in original.glob("application.sqlite*") if path.is_file())
    assert actual == {entry["path"] for entry in source["entries"]}
    counter = json.loads((corpus_root / "w5-healthy-a7ffc67a1666400b8cc7e890d837cb97/model-submissions.json").read_text(encoding="utf-8"))
    assert counter["submitted"] == 209
    result = {"meaning": "W5-only changes compared with immutable pre-W5 ownership; no predecessor manifest rewritten",
              "core": core, "native": native, "unexpectedNativeChanges": unexpected, "encodingAndHeaderIssues": issues,
              "originalPreserved": {"files": len(source["entries"]), "bytes": sum(entry["bytes"] for entry in source["entries"]),
                                    "allHashesMatch": True, "extraOrMissingFiles": False},
              "realSubmissions": counter["submitted"], "realSubmissionCap": 240}
    output = RESEARCH / "w5-source-ownership.json"
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"coreFiles": len(core), "nativeFiles": len(native), "unexpectedNativeChanges": unexpected,
                      "encodingAndHeaderIssues": issues, "originalPreserved": result["originalPreserved"],
                      "realSubmissions": counter["submitted"], "manifestSha256": digest(output)}))
    if issues or unexpected:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
