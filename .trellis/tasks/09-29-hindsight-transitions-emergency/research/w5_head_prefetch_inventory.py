"""Exact successor inventory for the bounded head-prefetch repair; import is inert."""

from __future__ import annotations

from pathlib import Path

import w5_actual_embedding_control as control
from w5_native_view_inventory import (
    FilePin,
    Inventory,
    VerifiedInventory,
    check_file,
    identity,
    index,
    same_bytes,
)

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "w5-head-prefetch-source-manifest.json"
PREVIOUS = HERE / "w5-native-view-checked-source-manifest.json"
PREVIOUS_SHA = "e0ec8c9e8b10706411e1f1bc2c43d1d0022a2b010471ef3bc976e4bea8331f4c"
PREVIOUS_COUNT = 382
NATIVE = Path("H:/hindsight")
AUTHORIZED_CHANGES = (
    NATIVE / "hindsight-api-slim/hindsight_api/engine/application_state/store.py",
    NATIVE / "hindsight-api-slim/hindsight_api/engine/application_state/snapshot.py",
    NATIVE / "hindsight-api-slim/hindsight_api/engine/transition_baseline_reads.py",
    NATIVE / "hindsight-api-slim/tests/native_results/test_transition_native_view.py",
    NATIVE / "TAKI_PATCHES.md",
    HERE.parents[2] / "spec/backend/memory-transition-healthy-drivers.md",
)
ADDITIONS = (
    PREVIOUS,
    NATIVE / "hindsight-api-slim/tests/native_results/test_transition_head_prefetch.py",
    *(
        HERE / name
        for name in (
            "w5_head_prefetch_inventory.py",
            "w5-head-prefetch-postpatch.py",
            "test_w5_head_prefetch_postpatch.py",
            "w5-head-prefetch-implementation.md",
            "w5-head-prefetch-repair-brief.md",
            "w5-native-view-postpatch-analysis.md",
            "w5-native-view-postpatch-scheduling-probe.py",
            "w5-native-view-postpatch-analysis-evidence.json",
        )
    ),
    *(
        HERE / "w5-head-prefetch-preimages" / name
        for name in (
            "manifest.json",
            "0-store.py",
            "1-snapshot.py",
            "2-transition_baseline_reads.py",
            "3-test_transition_native_view.py",
            "4-TAKI_PATCHES.md",
            "5-memory-transition-healthy-drivers.md",
        )
    ),
    *(
        HERE / "w5-head-prefetch-checks" / name
        for name in (
            "red.json",
            "green-offline.json",
            "owned-pg.json",
            "helper-offline.json",
            "quality.json",
        )
    ),
)


def verify_inventory(expected_sha: str | None = None) -> VerifiedInventory:
    digest = control.digest(MANIFEST)
    if expected_sha is not None:
        assert digest == expected_sha, "POSTPATCH_MANIFEST_CHANGED"
    manifest = Inventory.model_validate(control.read_json(MANIFEST))
    files, inherited = index(manifest.files), index(manifest.inherited)
    # Authenticate the complete immediately preceding set before authorizing
    # any replacement. Old manifest/helper verifiers remain unchanged and
    # correctly reject the new production bytes when invoked independently.
    assert control.digest(PREVIOUS) == PREVIOUS_SHA, "PREVIOUS_MANIFEST_CHANGED"
    previous = Inventory.model_validate(control.read_json(PREVIOUS))
    previous_files = index(previous.files)
    assert len(previous_files) == PREVIOUS_COUNT, "PREVIOUS_INVENTORY_COUNT_CHANGED"
    previous_pin = FilePin(
        path=str(PREVIOUS), bytes=PREVIOUS.stat().st_size, sha256=PREVIOUS_SHA
    )
    expected_inherited = index([*previous.inherited, previous_pin])
    assert inherited.keys() == expected_inherited.keys(), (
        "INHERITED_MANIFEST_SET_CHANGED"
    )
    authorized = {identity(path) for path in AUTHORIZED_CHANGES}
    assert authorized <= previous_files.keys(), "UNKNOWN_REPLACEMENT_PATH"
    additions = {identity(path) for path in ADDITIONS}
    assert len(additions) == len(ADDITIONS), "DUPLICATE_DECLARED_ADDITION"
    assert not additions.intersection(previous_files), (
        "ADDITION_REPLACES_PREVIOUS_ENTRY"
    )
    assert files.keys() == previous_files.keys() | additions, (
        "POSTPATCH_INVENTORY_SET_CHANGED"
    )
    for key, row in previous_files.items():
        if key not in authorized:
            assert same_bytes(row, files[key]), "UNAUTHORIZED_PREVIOUS_REPLACEMENT"
    for key, row in inherited.items():
        assert same_bytes(row, expected_inherited[key]), "INHERITED_MANIFEST_CHANGED"
        assert key in files and same_bytes(row, files[key]), (
            "INHERITED_MANIFEST_NOT_IN_COMPLETE_INVENTORY"
        )
        check_file(row)
    for row in files.values():
        check_file(row)
    assert control.digest(PREVIOUS) == PREVIOUS_SHA, (
        "PREVIOUS_MANIFEST_CHANGED_DURING_VERIFY"
    )
    assert control.digest(MANIFEST) == digest, (
        "POSTPATCH_MANIFEST_CHANGED_DURING_VERIFY"
    )
    return VerifiedInventory(digest, len(files), len(inherited))
