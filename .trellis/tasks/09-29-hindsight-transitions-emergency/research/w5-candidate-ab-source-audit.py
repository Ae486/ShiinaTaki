"""Audit only the approved A+B source delta and optionally seal new evidence."""

from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


RESEARCH = Path(__file__).resolve().parent
TAKI = RESEARCH.parents[3]
NATIVE = Path("H:/hindsight/hindsight-api-slim")
PREIMAGES = RESEARCH / "w5-candidate-ab-preimages"
RUNTIME = TAKI / ".trellis/.runtime"
OUTPUT = RESEARCH / "w5-candidate-ab-source-manifest.json"
OLD_NAME = "_TransitionBaselineReader"
NEW_NAME = "_TransitionValidationReader"
READER = "hindsight_api/engine/transition_baseline_reads.py"
SNAPSHOT = "hindsight_api/engine/transition_snapshot.py"
ROWS = "hindsight_api/engine/transfer/transition_delta_rows.py"
APPLICATION = "hindsight_api/engine/transfer/transition_delta_application.py"
BASELINE_TEST = "tests/native_results/test_transition_baseline_reads.py"
SPEC = TAKI / ".trellis/spec/backend/memory-transition-healthy-drivers.md"
ANCHORS = {
    "w5-reentry-candidate-diagnostic-manifest.json": "637cc0fbcbe4b971bf7ecf09926967ff1495993c22fbab30e2a20c27c39361dc",
    "w5-candidate-baseline-source-manifest.json": "766ff65824c15aaf081be13c4becfc8ffe83d960e3dd7b5e0e15e2b326a12a5b",
    "w5-candidate-residual-source-manifest.json": "dd30d7557ded6bf5d3b373078ed036b1f12900a0f8650830facc2bb688fd5d68",
    "w5-candidate-ab-proposal-source-manifest.json": "bcdda5e12398598a8f7c95f47eb8ec277b9db0381c7426d2beae80bafcd9c86a",
}
FIXTURES = ("368012967232", "f17520ab13d0", "f8099a36ea55", "de6d45cc7968", "6b40464afe0a")
TYPE_ROOT = RUNTIME / "w5-candidate-ab-types-d80d09f9f4d44b9dbb459e62a1815877"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parsed(path: Path, *, rename: bool = False) -> ast.Module:
    source = path.read_text(encoding="utf-8")
    return ast.parse(source.replace(NEW_NAME, OLD_NAME) if rename else source)


def dumped(node: ast.AST) -> str:
    return ast.dump(node, include_attributes=False)


def named(tree: ast.Module, name: str) -> ast.AsyncFunctionDef:
    return next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == name)


class OrdinaryStore(ast.NodeTransformer):
    def visit_Name(self, node: ast.Name) -> ast.Name:
        return ast.copy_location(ast.Name(id="store", ctx=node.ctx), node) if node.id == "reader" else node


def unwrap_reader(function: ast.AsyncFunctionDef) -> int:
    """Remove only the approved reader lifecycle shell for exact validation AST comparison."""
    unwrapped = []
    count = 0
    for statement in function.body:
        if isinstance(statement, ast.Assign) and dumped(statement.targets[0]) == "Name(id='reader', ctx=Store())":
            assert isinstance(statement.value, ast.Call) and isinstance(statement.value.func, ast.Name)
            assert statement.value.func.id == NEW_NAME
            expected = ast.parse(
                "reader = _TransitionValidationReader(store.conn, store.fq_table, store.bank_id, store.namespace)"
            ).body[0]
            assert dumped(statement) == dumped(expected)
            continue
        if isinstance(statement, ast.Try):
            assert not statement.handlers and not statement.orelse
            assert len(statement.finalbody) == 1
            assert dumped(statement.finalbody[0]) == dumped(ast.parse("reader.close()").body[0])
            unwrapped.extend(OrdinaryStore().visit(copy.deepcopy(part)) for part in statement.body)
            count += 1
        else:
            unwrapped.append(statement)
    function.body = unwrapped
    return count


def audit_ast() -> dict[str, bool]:
    # Module prose and the private class name are the only reader changes.
    before, after = parsed(PREIMAGES / READER), parsed(NATIVE / READER, rename=True)
    assert isinstance(before.body[0], ast.Expr) and isinstance(after.body[0], ast.Expr)
    before.body.pop(0)
    after.body.pop(0)
    assert dumped(before) == dumped(after), "reader algorithm or budgets changed"
    assert (NATIVE / SNAPSHOT).read_bytes().replace(NEW_NAME.encode(), OLD_NAME.encode()) == (
        PREIMAGES / SNAPSHOT
    ).read_bytes()

    before, after = parsed(PREIMAGES / ROWS), parsed(NATIVE / ROWS)
    assert dumped(named(before, "write_transition_native_delta")) == dumped(
        named(after, "write_transition_native_delta")
    )
    old_rows, new_rows = named(before, "preserve_transition_units"), named(after, "preserve_transition_units")
    old_loop = next(node for node in old_rows.body if isinstance(node, ast.For))
    new_loop = next(node for node in new_rows.body if isinstance(node, ast.For))
    old_branch = next(
        node
        for node in old_loop.body
        if isinstance(node, ast.If) and dumped(node.test) == "Name(id='exists', ctx=Load())"
    )
    new_branch = next(
        node
        for node in new_loop.body
        if isinstance(node, ast.If) and dumped(node.test) == "Name(id='exists', ctx=Load())"
    )
    old_delete = old_branch.body.pop()
    assert (
        "memory_links" in dumped(old_delete) and "temporal" in dumped(old_delete) and "semantic" in dumped(old_delete)
    )
    new_append = new_branch.body.pop()
    assert dumped(new_append) == dumped(ast.parse("derived_targets.append(uuid.UUID(target))").body[0])
    assert dumped(old_loop) == dumped(new_loop), "per-row restore/update/revision/cleanup changed"
    new_rows.body = [
        node
        for node in new_rows.body
        if not (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == "derived_targets"
        )
    ]
    batch = new_rows.body.pop()
    assert isinstance(batch, ast.For) and isinstance(batch.target, ast.Name) and batch.target.id == "offset"
    assert dumped(batch.iter) == dumped(ast.parse("range(0, len(derived_targets), 128)", mode="eval").body)
    assert dumped(before) == dumped(after), "row module has another change"

    before, after = parsed(PREIMAGES / APPLICATION), parsed(NATIVE / APPLICATION)
    assert dumped(named(before, "_body_and_command")) == dumped(named(after, "_body_and_command"))
    after.body = [
        node
        for node in after.body
        if not (isinstance(node, ast.ImportFrom) and node.module == "transition_baseline_reads")
    ]
    assert unwrap_reader(named(after, "_predecessors")) == 1
    assert unwrap_reader(named(after, "write_transition_application_delta")) == 1
    assert dumped(before) == dumped(after), "application validation/order/writer/publication changed"
    return {
        "readerAlgorithmAndBudgetsUnchangedExceptPrivateNameAndProse": True,
        "snapshotByteIdenticalAfterPrivateNameNormalization": True,
        "nativeWriterAndPerRowRestoreUpdateRevisionCleanupUnchanged": True,
        "applicationAstIdenticalAfterRemovingTwoReaderShells": True,
        "bodyAndCommandUnchanged": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--seal", action="store_true", help="Create the manifest once, after all verification completes."
    )
    args = parser.parse_args()
    manifests = {}
    for filename, expected in ANCHORS.items():
        path = RESEARCH / filename
        assert sha256(path) == expected, filename
        manifests[filename] = json.loads(path.read_text(encoding="utf-8"))
    baseline = manifests["w5-candidate-baseline-source-manifest.json"]
    diagnostic = manifests["w5-reentry-candidate-diagnostic-manifest.json"]
    before = json.loads((PREIMAGES / "manifest.json").read_text(encoding="utf-8"))
    assert {row["path"] for row in before["files"]} == {READER, SNAPSHOT, ROWS, APPLICATION}
    old_entries = {row["path"]: row for row in [*diagnostic["files"], *baseline["files"]]}
    for row in before["files"]:
        assert sha256(PREIMAGES / row["path"]) == row["sha256"]
        assert row["sha256"] == old_entries[(NATIVE / row["path"]).as_posix()]["sha256"]
    allowed = {(NATIVE / path).as_posix() for path in (READER, SNAPSHOT, BASELINE_TEST)} | {SPEC.as_posix()}
    differences = {row["path"] for row in baseline["files"] if sha256(Path(row["path"])) != row["sha256"]}
    assert differences == allowed, sorted(differences ^ allowed)
    normalized_test = (NATIVE / BASELINE_TEST).read_bytes().replace(NEW_NAME.encode(), OLD_NAME.encode())
    assert hashlib.sha256(normalized_test).hexdigest() == old_entries[(NATIVE / BASELINE_TEST).as_posix()]["sha256"]
    diagnostic_allowed = {
        (NATIVE / path).as_posix()
        for path in (
            SNAPSHOT,
            ROWS,
            APPLICATION,
            "hindsight_api/engine/application_state/store.py",
            "hindsight_api/engine/transfer/transition_delta.py",
        )
    }
    diagnostic_differences = {row["path"] for row in diagnostic["files"] if sha256(Path(row["path"])) != row["sha256"]}
    assert diagnostic_differences == diagnostic_allowed, sorted(diagnostic_differences ^ diagnostic_allowed)
    for name in ("w5-candidate-residual-source-manifest.json", "w5-candidate-ab-proposal-source-manifest.json"):
        for row in manifests[name]["files"]:
            assert sha256(Path(row["path"])) == row["sha256"], row["path"]
    checks = audit_ast()
    checks["baselineTestByteIdenticalAfterPrivateNameNormalization"] = True
    checks["allEarlierManifestsReportsAndProfilersUnchanged"] = True
    if not args.seal:
        print(json.dumps({"sourceAudit": checks, "baselineAllowedChanges": sorted(differences)}))
        return

    paths = [NATIVE / row["path"] for row in before["files"]]
    paths.extend(
        NATIVE / path
        for path in (
            BASELINE_TEST,
            "tests/native_results/test_transition_derived_link_batches.py",
            "tests/native_results/test_transition_artifact_reads.py",
        )
    )
    paths.extend(
        (
            SPEC,
            RESEARCH / "w5-candidate-ab-implementation.md",
            Path(__file__),
            RESEARCH / "w5-candidate-ab-type-compare.py",
            PREIMAGES / "manifest.json",
        )
    )
    paths.extend(PREIMAGES / row["path"] for row in before["files"])
    paths.extend(RESEARCH / name for name in ANCHORS)
    paths.extend(Path(row["path"]) for row in diagnostic["files"])
    cleanup = []
    for fixture in FIXTURES:
        root = RUNTIME / "g1-validation" / f"taki-hindsight-g1-{fixture}"
        ownership = json.loads((root / "ownership.json").read_text(encoding="utf-8"))
        assert ownership["stopped"] and not (root / "data").exists() and not Path(ownership["registry"]).exists()
        cleanup.append(fixture)
        paths.extend((root / "pytest.log", root / "ownership.json"))
    paths.extend(TYPE_ROOT / name for name in ("result.json", "baseline.stdout.json", "current.stdout.json"))
    entries = []
    for path in dict.fromkeys(paths):
        data = path.read_bytes()
        if path.suffix in {".py", ".md", ".json"}:
            data.decode("utf-8")
            assert not data.startswith(b"\xef\xbb\xbf"), path
        entries.append({"path": path.as_posix(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    report = {
        "version": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "meaning": "Immutable approved A+B implementation and correctness evidence. No A+B real-corpus timing or independent review is claimed; both remain parent-owned gates.",
        "approvedProductionPaths": sorted((NATIVE / row["path"]).as_posix() for row in before["files"]),
        "priorManifestSha256": ANCHORS,
        "sourceAudit": checks,
        "ownedFixturesCleaned": cleanup,
        "files": entries,
    }
    with OUTPUT.open("x", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(report, indent=2) + "\n")
    assert all(
        sha256(Path(row["path"])) == row["sha256"] for row in json.loads(OUTPUT.read_text(encoding="utf-8"))["files"]
    )
    print(
        json.dumps(
            {"manifest": OUTPUT.as_posix(), "entries": len(entries), "sha256": sha256(OUTPUT), "sourceAudit": checks}
        )
    )


if __name__ == "__main__":
    main()
