"""Exact, additive postpatch inventory; no I/O occurs until explicitly verified."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

import w5_actual_embedding_control as control

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "w5-native-view-checked-source-manifest.json"
DELIVERED_MANIFEST = HERE / "w5-native-view-postpatch-source-manifest.json"
DELIVERED_SHA = "0e7bfeae8c3531b1782acc81f25db9f39ef34ed1b0a8df3969575a7934cf7f33"
CHECKER_CHANGES = tuple(
    HERE / name
    for name in (
        "w5_native_view_inventory.py",
        "w5-native-view-postpatch.py",
        "test_w5_native_view_postpatch.py",
    )
)
INHERITED = {
    "w5-candidate-actual-embedding-telemetry-source-manifest.json": "c44bbda14a8a0d142d407e47345ea417a001b63dfb828f196bf536efaaf3cd97",
    "w5-baseline-readonly-profile-source-manifest.json": "2109f69f40d49085cb0087444c66cc836622fca94c4ef6da267b09bf9e5dda8f",
    "w5-candidate-actual-embedding-v2-source-manifest.json": "9d327ad5a2b2dd9f551f6c7398d0192aa7f3375a6d3badc508c898e05d618e6f",
    "w5-candidate-actual-embedding-source-manifest.json": "877d8e4b0a0e59920f7b06a61a9dd4921638d5dca31aca1d12b703905ec56c49",
    "w5-candidate-combined-source-manifest.json": "5e0d006be9ddb2aece8e5b26df3002b2832c27f43dbeb4a9e999b162815bcbe0",
    "w5-trigger-uuid-source-manifest.json": "9340f11464caffa680a83503def0e16404df3068ba5743ba78e4a2210a5d2b07",
    "w5-candidate-reader-queue-source-manifest.json": "b38a102c5e6b9737afc62c6f4063f7dc9b7ecda6e39039e7026aab6555bda47f",
}
AUTHORIZED_CHANGES = (
    Path("H:/hindsight/hindsight-api-slim/hindsight_api/engine/transition_snapshot.py"),
    Path(
        "H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/snapshot.py"
    ),
    Path(
        "H:/hindsight/hindsight-api-slim/tests/native_results/test_transition_baseline_reads.py"
    ),
    Path("H:/hindsight/TAKI_PATCHES.md"),
    HERE.parents[2] / "spec/backend/memory-transitions.md",
    HERE.parents[2] / "spec/backend/memory-transition-healthy-drivers.md",
)
ADDITIONS = (
    DELIVERED_MANIFEST,
    HERE / "w5-native-view-independent-check.md",
    HERE / "w5-native-view-independent-checks/quality.json",
    *(
        HERE / "w5-native-view-checker-preimages" / name
        for name in (
            "manifest.json",
            "w5_native_view_inventory.py",
            "w5-native-view-postpatch.py",
            "test_w5_native_view_postpatch.py",
        )
    ),
    *(
        HERE / name
        for name in (
            "w5_native_view_inventory.py",
            "w5-native-view-postpatch.py",
            "test_w5_native_view_postpatch.py",
            "w5-native-view-optimization-implementation.md",
            "w5-native-view-optimization-brief.md",
        )
    ),
    Path(
        "H:/hindsight/hindsight-api-slim/tests/native_results/test_transition_native_view.py"
    ),
    Path(
        "H:/hindsight/hindsight-api-slim/tests/native_results/test_transition_native_view_pg.py"
    ),
    *(
        HERE / "w5-native-view-preimages" / name
        for name in (
            "manifest.json",
            "0-transition_snapshot.py",
            "1-snapshot.py",
            "2-test_transition_baseline_reads.py",
            "3-TAKI_PATCHES.md",
            "4-memory-transitions.md",
            "5-memory-transition-healthy-drivers.md",
        )
    ),
    *(
        HERE / "w5-native-view-resume-preimages" / name
        for name in (
            "manifest.json",
            "0-transition_snapshot.py",
            "1-snapshot.py",
            "2-test_transition_baseline_reads.py",
            "3-TAKI_PATCHES.md",
            "4-memory-transitions.md",
            "5-memory-transition-healthy-drivers.md",
            "6-test_transition_native_view.py",
        )
    ),
)


class FilePin(BaseModel):
    # Historical manifests have descriptive category fields; only identity,
    # size and bytes participate in the executable source contract.
    path: str
    bytes: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class OldInventory(BaseModel):
    files: list[FilePin]


class Inventory(BaseModel):
    model_config = ConfigDict(extra="forbid")
    purpose: str
    inherited: list[FilePin]
    files: list[FilePin]


@dataclass(frozen=True)
class VerifiedInventory:
    sha256: str
    entries: int
    inherited_manifests: int
    verified: bool = True


def identity(path: str | Path) -> str:
    return str(Path(path).resolve()).casefold()


def index(rows: list[FilePin]) -> dict[str, FilePin]:
    result: dict[str, FilePin] = {}
    for row in rows:
        key = identity(row.path)
        assert key not in result, "DUPLICATE_INVENTORY_PATH"
        result[key] = row
    return result


def check_file(row: FilePin) -> None:
    path = Path(row.path)
    assert path.stat().st_size == row.bytes and control.digest(path) == row.sha256, (
        "POSTPATCH_SOURCE_DRIFT"
    )


def same_bytes(left: FilePin, right: FilePin) -> bool:
    return left.bytes == right.bytes and left.sha256 == right.sha256


def verify_inventory(expected_sha: str | None = None) -> VerifiedInventory:
    digest = control.digest(MANIFEST)
    if expected_sha is not None:
        assert digest == expected_sha, "POSTPATCH_MANIFEST_CHANGED"
    manifest = Inventory.model_validate(control.read_json(MANIFEST))
    files, inherited = index(manifest.files), index(manifest.inherited)
    # The delivered inventory stays sealed. Independent review may replace only
    # these three helper/test entries; even the six original Native/spec owners
    # must remain at their exact delivered bytes during this checker repair.
    assert control.digest(DELIVERED_MANIFEST) == DELIVERED_SHA, (
        "DELIVERED_MANIFEST_CHANGED"
    )
    delivered = Inventory.model_validate(control.read_json(DELIVERED_MANIFEST))
    checker_changes = {identity(path) for path in CHECKER_CHANGES}
    for key, row in index(delivered.files).items():
        assert key in files, "DELIVERED_ENTRY_OMITTED"
        if key not in checker_changes:
            assert same_bytes(row, files[key]), "UNAUTHORIZED_CHECKER_REPLACEMENT"
    expected = {identity(HERE / name): sha for name, sha in INHERITED.items()}
    assert inherited.keys() == expected.keys(), "INHERITED_MANIFEST_SET_CHANGED"
    authorized = {identity(path) for path in AUTHORIZED_CHANGES}
    required = set(inherited) | {identity(path) for path in ADDITIONS}
    for key, row in inherited.items():
        assert row.sha256 == expected[key], "INHERITED_MANIFEST_CHANGED"
        check_file(row)
        assert key in files and same_bytes(row, files[key]), (
            "INHERITED_MANIFEST_NOT_IN_COMPLETE_INVENTORY"
        )
        previous = index(
            OldInventory.model_validate(control.read_json(Path(row.path))).files
        )
        required.update(previous)
        for old_key, old in previous.items():
            assert old_key in files, "INHERITED_ENTRY_OMITTED"
            if old_key not in authorized:
                assert same_bytes(old, files[old_key]), (
                    "UNAUTHORIZED_INHERITED_REPLACEMENT"
                )
    assert files.keys() == required, "POSTPATCH_INVENTORY_SET_CHANGED"
    for row in files.values():
        check_file(row)
    assert control.digest(MANIFEST) == digest, (
        "POSTPATCH_MANIFEST_CHANGED_DURING_VERIFY"
    )
    return VerifiedInventory(digest, len(files), len(inherited))
