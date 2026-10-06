"""Fixed-union HTTP successor inventory. Every predecessor byte is immutable."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import w5_actual_embedding_control as control
from w5_native_view_inventory import (
    FilePin,
    OldInventory,
    check_file,
    identity,
    index,
    same_bytes,
)

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "w5-http-checked-v3-source-manifest.json"
PREVIOUS = HERE / "w5-head-prefetch-source-manifest.json"
PREVIOUS_SHA = "ca275f841f3f5a66620be833a692b33117b9256b735f1cf10f4c17f6522647fb"
DEPENDENCIES = HERE / "w5-http-dependencies.json"
DEPENDENCIES_SHA = "15540ca2b6a078fc0e0a4de91c08643900abe7f536e47732186ba60b4863810d"
ADDITIONS = tuple(
    HERE / name
    for name in (
        "w5-head-prefetch-source-manifest.json",
        "w5-http-dependencies.json",
        "w5-http-diagnostic.py",
        "w5_http_composition.py",
        "w5-http-client.mjs",
        "w5_http_inventory.py",
        "test_w5_http_diagnostic.py",
        "test_w5_http_client.mjs",
        "w5-http-implementation.md",
        "w5-http-implementation-brief.md",
        "w5-head-prefetch-actual-and-http-proposal.md",
        "w5-head-prefetch-actual-audit.json",
        "w5-http-checks/python.json",
        "w5-http-checks/node.json",
        "w5-http-checks/owned-pg.json",
        "w5-http-checks/quality.json",
        "w5-http-checks/fixture-wiring.json",
    )
)


def verify_inventory(expected_sha: str | None = None) -> dict[str, Any]:
    digest = control.digest(MANIFEST)
    if expected_sha is not None:
        assert digest == expected_sha, "HTTP_MANIFEST_CHANGED"
    assert control.digest(PREVIOUS) == PREVIOUS_SHA, "HTTP_PREDECESSOR_CHANGED"
    assert control.digest(DEPENDENCIES) == DEPENDENCIES_SHA, "HTTP_DEPENDENCIES_CHANGED"
    previous = index(OldInventory.model_validate(control.read_json(PREVIOUS)).files)
    assert len(previous) == 404, "HTTP_PREDECESSOR_COUNT_CHANGED"
    dependency = control.read_json(DEPENDENCIES)
    dependencies = index(OldInventory.model_validate(dependency).files)
    raw = control.read_json(MANIFEST)
    files = index(OldInventory.model_validate(raw).files)
    additions = {identity(path) for path in ADDITIONS}
    assert len(additions) == len(ADDITIONS), "HTTP_DUPLICATE_ADDITION"
    assert (
        len(dependency["additions"]) == len(additions)
        and {identity(path) for path in dependency["additions"]} == additions
    ), "HTTP_DECLARED_ADDITIONS_CHANGED"
    assert (
        len(raw["additions"]) == len(additions)
        and {identity(path) for path in raw["additions"]} == additions
    )
    assert files.keys() == previous.keys() | dependencies.keys() | additions, (
        "HTTP_INVENTORY_SET_CHANGED"
    )
    for key, row in [*previous.items(), *dependencies.items()]:
        assert same_bytes(row, files[key]), "HTTP_PIN_REPLACED"
    for row in files.values():
        check_file(row)
    assert control.digest(MANIFEST) == digest, "HTTP_MANIFEST_CHANGED_DURING_VERIFY"
    return {"sha256": digest, "entries": len(files), "verified": True}


def pin(path: Path) -> FilePin:
    return FilePin(
        path=str(path.resolve()), bytes=path.stat().st_size, sha256=control.digest(path)
    )
