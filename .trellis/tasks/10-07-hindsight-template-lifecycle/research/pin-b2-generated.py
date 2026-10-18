"""Pin B2 canonical/client bytes and maintained inputs without overwriting evidence."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path("H:/hindsight")
HERE = Path(__file__).resolve().parent
MAINTAINED = (
    "hindsight-clients/python/hindsight_client/hindsight_client.py",
    "hindsight-clients/python/README.md",
    "hindsight-clients/python/pyproject.toml",
    "hindsight-clients/python/openapi-generator-config.yaml",
    "hindsight-clients/typescript/src/index.ts",
    "hindsight-clients/typescript/package.json",
    "hindsight-clients/go/README.md",
    "hindsight-clients/go/hindsight_client.go",
    "hindsight-clients/go/go.mod",
    "hindsight-clients/go/go.sum",
    "hindsight-clients/rust/Cargo.toml",
    "hindsight-clients/rust/Cargo.lock",
)


def fingerprint(path: Path) -> dict[str, object]:
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main() -> None:
    suffix = sys.argv[1]
    if not re.fullmatch(r"[a-z0-9_-]+", suffix):
        raise ValueError("A unique bounded snapshot suffix is required")
    spec_path = ROOT / "hindsight-docs/static/openapi.json"
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    for operation in ("snapshot", "apply", "result", "refresh-result"):
        assert f"/ext/taki-memory/template/{operation}" in spec["paths"]
    if suffix != "pre-generation":
        assert "/ext/taki-memory/template/label-evidence" in spec["paths"]
    paths = {spec_path}
    for directory, pattern in (
        ("hindsight-clients/python/hindsight_client_api", "*.py"),
        ("hindsight-clients/python/hindsight_client", "*.py"),
        ("hindsight-clients/typescript/generated", "*.ts"),
        ("hindsight-clients/go", "*.go"),
    ):
        paths.update((ROOT / directory).rglob(pattern))
    paths.update(ROOT / relative for relative in MAINTAINED)
    paths.update(ROOT / relative for relative in (
        "hindsight-clients/go/api/openapi.yaml",
        "hindsight-clients/python/.openapi-generator/FILES",
    ))
    rows = {path.relative_to(ROOT).as_posix(): fingerprint(path) for path in sorted(paths)}
    rust = list((ROOT / "hindsight-clients/rust/target/release/build").glob(
        "hindsight-client-*/out/hindsight_client_generated.rs"
    ))
    assert len(rust) == 1, "Expected one actual generated Rust release source"
    rows["rust-build/hindsight_client_generated.rs"] = fingerprint(rust[0])
    destination = HERE / f"b2-generated-{suffix}.json"
    with destination.open("x", encoding="utf-8") as output:
        json.dump(rows, output, indent=2)
        output.write("\n")
    summary: dict[str, object] = {"snapshot": str(destination), "files": len(rows)}
    if suffix != "pre-generation":
        original = json.loads((HERE / "b2-generated-pre-generation.json").read_text(encoding="utf-8"))
        changed_maintained = [name for name in MAINTAINED if original[name] != rows[name]]
        summary["changedMaintainedFiles"] = changed_maintained
        assert not changed_maintained, "Canonical generation changed a maintained input"
    if len(sys.argv) > 2:
        before = json.loads((HERE / f"b2-generated-{sys.argv[2]}.json").read_text(encoding="utf-8"))
        changed = [key for key in sorted(before.keys() | rows.keys()) if before.get(key) != rows.get(key)]
        summary["byteChanges"] = changed
        print(json.dumps(summary))
        assert not changed, "Repeated current-schema generation changed byte identities"
    else:
        print(json.dumps(summary))


if __name__ == "__main__":
    main()
