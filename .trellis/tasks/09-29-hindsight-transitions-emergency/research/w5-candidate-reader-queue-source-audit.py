"""Verify the exact three-pop reader repair and seal its independent evidence."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

RESEARCH = Path(__file__).resolve().parent
TAKI = RESEARCH.parents[3]
NATIVE = Path("H:/hindsight/hindsight-api-slim")
READER = "hindsight_api/engine/transition_baseline_reads.py"
PREIMAGES = RESEARCH / "w5-candidate-reader-queue-preimages"
PRIOR = RESEARCH / "w5-candidate-ab-source-manifest.json"
PRIOR_HASH = "51b86892546896ca275b8da2fb9972d3ffce0ee01ee1f12fad61e9a18d6b6a23"
OUTPUT = RESEARCH / "w5-candidate-reader-queue-source-manifest.json"
SPEC = TAKI / ".trellis/spec/backend/memory-transition-healthy-drivers.md"
NEW_TESTS = {
    "tests/native_results/test_transition_baseline_reads.py": "test_cached_hit_discards_only_its_queued_and_staged_rows_and_preserves_refusals",
    "tests/native_results/test_transition_artifact_reads.py": "test_final_bank_first_view_continues_prefetch_after_reenumerating_cached_bank",
}
SPEC_PARAGRAPH = """A complete-descriptor cache hit also consumes that body's pending identifier and staged metadata/parts. A later
artifact listing can requeue an already validated Bank; leaving its raw row staged after the hit would prevent the
next prefetch batch forever. Clear only that body's transport bookkeeping after scope/full-identity validation,
never other staged bodies or descriptor-alias checks. Actual final Bank-first tests must cross a batch boundary and
prove later bodies still use prefetch; also cover staged hits, conflicting aliases and fresh-reader corruption.

"""
TYPE_ROOT = TAKI / ".trellis/.runtime/w5-candidate-reader-queue-types-c2064dd72a7d400183363a9b4d89bc64"
FIXTURES = ("7752b51f0729", "7a0206ad1b48")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seal", action="store_true")
    args = parser.parse_args()
    assert digest(PRIOR.read_bytes()) == PRIOR_HASH
    prior = json.loads(PRIOR.read_text(encoding="utf-8"))
    old = {row["path"]: row for row in prior["files"]}
    allowed = {SPEC.as_posix(), (NATIVE / READER).as_posix(), *((NATIVE / name).as_posix() for name in NEW_TESTS)}
    changed = {path for path, row in old.items() if digest(Path(path).read_bytes()) != row["sha256"]}
    assert changed == allowed, sorted(changed ^ allowed)
    before = (PREIMAGES / READER).read_bytes()
    assert digest(before) == old[(NATIVE / READER).as_posix()]["sha256"]
    saved = json.loads((PREIMAGES / "manifest.json").read_text(encoding="utf-8"))["files"]
    assert len(saved) == 1 and saved[0]["path"] == READER and saved[0]["sha256"] == digest(before)
    previous, current = ast.parse(before), ast.parse((NATIVE / READER).read_bytes())
    cls = next(
        node for node in current.body if isinstance(node, ast.ClassDef) and node.name == "_TransitionValidationReader"
    )
    method = next(node for node in cls.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "body_bytes")
    hit = method.body[1]
    assert isinstance(hit, ast.If)
    expected = ast.parse(
        "\n".join(f"self.{field}.pop(descriptor.body_id, None)" for field in ("_pending", "_metadata", "_parts"))
    ).body
    assert [ast.dump(node) for node in hit.body[:3]] == [ast.dump(node) for node in expected]
    hit.body = hit.body[3:]
    assert ast.dump(previous) == ast.dump(current), "another production semantic change"
    for relative, test_name in NEW_TESTS.items():
        text = (NATIVE / relative).read_bytes().decode("utf-8")
        lines = text.splitlines(keepends=True)
        node = next(
            node for node in ast.parse(text).body if isinstance(node, ast.AsyncFunctionDef) and node.name == test_name
        )
        start = min(decorator.lineno for decorator in node.decorator_list) - 1
        end = node.end_lineno
        assert end is not None
        while end < len(lines) and not lines[end].strip():
            end += 1
        restored = "".join(lines[:start] + lines[end:]).encode("utf-8")
        assert digest(restored) == old[(NATIVE / relative).as_posix()]["sha256"], relative
    spec = SPEC.read_bytes()
    assert spec.count(SPEC_PARAGRAPH.encode()) == 1
    assert digest(spec.replace(SPEC_PARAGRAPH.encode(), b"")) == old[SPEC.as_posix()]["sha256"]
    checks = {
        "onlyThreePopsAfterCompleteIdentityAndScopeHit": True,
        "bothTestFilesOnlyAddOneRegressionEach": True,
        "specOnlyAddsTheApprovedQueueContract": True,
        "otherPriorSourceReportsAndManifestsUnchanged": True,
    }
    if not args.seal:
        print(json.dumps(checks))
        return
    paths = [Path(path) for path in sorted(allowed)]
    paths.extend(
        (
            PRIOR,
            PREIMAGES / READER,
            PREIMAGES / "manifest.json",
            Path(__file__),
            RESEARCH / "w5-candidate-reader-queue-type-compare.py",
            RESEARCH / "w5-candidate-reader-queue-implementation.md",
        )
    )
    for fixture in FIXTURES:
        root = TAKI / ".trellis/.runtime/g1-validation" / f"taki-hindsight-g1-{fixture}"
        ownership = json.loads((root / "ownership.json").read_text(encoding="utf-8"))
        assert ownership["stopped"] and not (root / "data").exists() and not Path(ownership["registry"]).exists()
        paths.extend((root / "pytest.log", root / "ownership.json"))
    paths.extend(TYPE_ROOT / name for name in ("result.json", "baseline.stdout.json", "current.stdout.json"))
    entries = []
    for path in paths:
        data = path.read_bytes()
        if path.suffix in {".md", ".py", ".json"}:
            data.decode("utf-8")
            assert not data.startswith(b"\xef\xbb\xbf")
        entries.append({"path": path.as_posix(), "bytes": len(data), "sha256": digest(data)})
    report = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "meaning": "Reader queue repair correctness only; no real-corpus performance acceptance or trigger repair.",
        "priorManifestSha256": PRIOR_HASH,
        "approvedProductionPaths": [(NATIVE / READER).as_posix()],
        "sourceAudit": checks,
        "files": entries,
    }
    with OUTPUT.open("x", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(report, indent=2) + "\n")
    assert all(
        digest(Path(row["path"]).read_bytes()) == row["sha256"]
        for row in json.loads(OUTPUT.read_text(encoding="utf-8"))["files"]
    )
    print(json.dumps({"path": OUTPUT.as_posix(), "sha256": digest(OUTPUT.read_bytes()), "entries": len(entries)}))


if __name__ == "__main__":
    main()
