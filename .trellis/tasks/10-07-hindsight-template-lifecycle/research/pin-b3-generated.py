"""Pin B3 canonical/client bytes, their unchanged maintained inputs and wire-fixture parity."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path("H:/hindsight")
HERE = Path(__file__).resolve().parent
TAKI = HERE.parents[3]
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


def inspect_schema(spec: dict, *, require_backup: bool) -> None:
    operations = ["snapshot", "apply", "result", "refresh-result", "label-evidence"]
    if require_backup:
        operations.append("backup-observation")
    for operation in operations:
        assert f"/ext/taki-memory/template/{operation}" in spec["paths"]
    schemas = spec["components"]["schemas"]
    if require_backup:
        for name in (
            "TakiBackupRequestV2",
            "TakiBackupProofV2",
            "TakiBackupArchiveV2",
            "TakiBackupResponseV2",
            "TemplateBackupBankProofV2",
            "TemplateBackupObservationRequest",
            "TemplateBackupObservationResponse",
        ):
            assert name in schemas, name
        operation = spec["paths"]["/ext/taki-memory/template/backup-observation"]["post"]
        assert operation["operationId"] == "observe_taki_template_backup"
        assert operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith(
            "/TemplateBackupObservationRequest"
        )
        assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
            "/TemplateBackupObservationResponse"
        )

    def references(value: object) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "$ref" and isinstance(child, str) and child.startswith("#/components/schemas/"):
                    assert child.rsplit("/", 1)[1] in schemas, child
                else:
                    references(child)
        elif isinstance(value, list):
            for child in value:
                references(child)

    references(spec)


def main() -> None:
    suffix = sys.argv[1]
    if not re.fullmatch(r"[a-z0-9_-]+", suffix):
        raise ValueError("A unique bounded snapshot suffix is required")
    spec_path = ROOT / "hindsight-docs/static/openapi.json"
    inspect_schema(json.loads(spec_path.read_text(encoding="utf-8")), require_backup=suffix != "pre-generation")
    shared = TAKI / "packages/shared/src/fixtures/hindsight-template-backup-v2.json"
    local_fixture = ROOT / "hindsight-clients/template-backup-v2-fixture.json"
    assert local_fixture.read_bytes() == shared.read_bytes(), "SDK fixture drifted from the frozen Shared wire"
    assert fingerprint(shared)["sha256"] == "acc74518e6f7ff7da0de00842c0f5d642a38a0daab7bf195670b96c560694e43"
    paths = {spec_path, local_fixture}
    for directory, pattern in (
        ("hindsight-clients/python/hindsight_client_api", "*.py"),
        ("hindsight-clients/python/hindsight_client", "*.py"),
        ("hindsight-clients/typescript/generated", "*.ts"),
        ("hindsight-clients/go", "*.go"),
    ):
        paths.update((ROOT / directory).rglob(pattern))
    paths.update(ROOT / relative for relative in MAINTAINED)
    paths.update(
        ROOT / relative
        for relative in (
            "hindsight-clients/go/api/openapi.yaml",
            "hindsight-clients/python/.openapi-generator/FILES",
        )
    )
    rows = {path.relative_to(ROOT).as_posix(): fingerprint(path) for path in sorted(paths)}
    rust = list(
        (ROOT / "hindsight-clients/rust/target/release/build").glob(
            "hindsight-client-*/out/hindsight_client_generated.rs"
        )
    )
    assert len(rust) == 1, "Expected one actual generated Rust release source"
    rows["rust-build/hindsight_client_generated.rs"] = fingerprint(rust[0])
    destination = HERE / f"b3-generated-{suffix}.json"
    with destination.open("x", encoding="utf-8") as output:
        json.dump(rows, output, indent=2)
        output.write("\n")
    summary: dict[str, object] = {"snapshot": str(destination), "files": len(rows)}
    if suffix != "pre-generation":
        original = json.loads((HERE / "b3-generated-pre-generation.json").read_text(encoding="utf-8"))
        changed_maintained = [name for name in MAINTAINED if original[name] != rows[name]]
        summary["changedMaintainedFiles"] = changed_maintained
        assert not changed_maintained, "Canonical generation changed a maintained input"
    if len(sys.argv) > 2:
        before = json.loads((HERE / f"b3-generated-{sys.argv[2]}.json").read_text(encoding="utf-8"))
        changed = [key for key in sorted(before.keys() | rows.keys()) if before.get(key) != rows.get(key)]
        summary["byteChanges"] = changed
        print(json.dumps(summary))
        assert not changed, "Repeated current-schema generation changed byte identities"
    else:
        print(json.dumps(summary))


if __name__ == "__main__":
    main()
