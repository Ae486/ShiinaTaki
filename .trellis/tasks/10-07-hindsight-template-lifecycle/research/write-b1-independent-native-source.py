"""Freeze independent B1 review source identity and unchanged generated evidence."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess


RESEARCH = Path(__file__).resolve().parent
TAKI = RESEARCH.parents[3]
NATIVE = Path("H:/hindsight")

TAKI_OWNED = [
    ".trellis/spec/backend/hindsight-template-lifecycle.md",
    "packages/shared/src/hindsight-template-definition-schema.ts",
    "packages/shared/src/hindsight-template-schema.ts",
    "packages/shared/src/hindsight-template-schema.test.ts",
    "packages/shared/src/hindsight-template-validation.test.ts",
    "packages/shared/src/fixtures/hindsight-template-validation-cases.json",
    "packages/shared/src/index.md",
]
NATIVE_OWNED = [
    "TAKI_PATCHES.md",
    "hindsight-api-slim/hindsight_api/engine/template_definitions.py",
    "hindsight-api-slim/hindsight_api/engine/template_provider_guard.py",
    "hindsight-api-slim/hindsight_api/engine/template_refresh.py",
    "hindsight-api-slim/hindsight_api/engine/memory_engine.py",
    "hindsight-api-slim/hindsight_api/engine/llm_wrapper.py",
    "hindsight-api-slim/hindsight_api/engine/reflect/agent.py",
    "hindsight-api-slim/hindsight_api/engine/retain/embedding_utils.py",
    "hindsight-api-slim/hindsight_api/engine/transition_snapshot.py",
    "hindsight-api-slim/hindsight_api/admin/cli.py",
    "hindsight-api-slim/tests/native_results/template_validation_cases.json",
    "hindsight-api-slim/tests/native_results/test_template_independent_wire.py",
    "hindsight-api-slim/tests/native_results/test_template_independent_refresh.py",
    "hindsight-api-slim/tests/native_results/test_template_independent_routes.py",
    "hindsight-api-slim/tests/native_results/test_template_independent_backup.py",
    "hindsight-api-slim/tests/native_results/test_template_independent_auxiliary.py",
    "hindsight-api-slim/tests/native_results/test_template_provider_guard.py",
    "hindsight-api-slim/tests/native_results/test_transition_backup.py",
    "hindsight-api-slim/tests/test_taki_extension_contract.py",
]


def identity(root: Path, relative: str) -> dict[str, str | int]:
    data = (root / relative).read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        raise ValueError(f"Unexpected UTF-8 BOM: {relative}")
    data.decode("utf-8")
    return {"path": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main() -> None:
    baseline = json.loads((RESEARCH / "b1-final-source.json").read_text(encoding="utf-8"))
    repositories = []
    for original, root, owned in zip(baseline["repositories"], (TAKI, NATIVE), (TAKI_OWNED, NATIVE_OWNED), strict=True):
        paths = sorted({row["path"] for row in original["files"]} | set(owned))
        files = [identity(root, path) for path in paths]
        now = {row["path"]: row for row in files}
        deltas = [row["path"] for row in original["files"] if row["sha256"] != now[row["path"]]["sha256"]]
        head = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
        if head != original["head"]:
            raise ValueError(f"Unexpected HEAD change: {root}")
        repositories.append({
            "root": str(root), "head": head, "files": files, "owned": owned,
            "baselineDeltaPaths": deltas,
            "note": "Core and leader-owned task/document deltas are concurrent; consult the separate Core manifest.",
        })
    generated = json.loads((RESEARCH / "b1-generated-after.json").read_text(encoding="utf-8"))
    # The canonical inventory gives Cargo's generated OUT_DIR file a stable virtual
    # key. Resolve it using the original inventory producer instead of treating that
    # key as a repository path or silently omitting the Rust generated artifact.
    rust_outputs = list((NATIVE / "hindsight-clients/rust/target/release/build").glob(
        "hindsight-client-*/out/hindsight_client_generated.rs"
    ))
    if len(rust_outputs) != 1:
        raise ValueError("Expected exactly one canonical Rust generated output")
    generated_paths = {
        key: rust_outputs[0] if key == "rust-build/hindsight_client_generated.rs" else NATIVE / key
        for key in generated
    }
    generated_deltas = [key for key, frozen in generated.items()
                        if hashlib.sha256(generated_paths[key].read_bytes()).hexdigest() != frozen["sha256"]]
    if generated_deltas:
        raise ValueError(f"Generated source changed; previous SDK evidence cannot be reused: {generated_deltas}")
    canonical = (NATIVE / "hindsight-docs/static/openapi.json").read_bytes()
    rederived = (RESEARCH / "b1-independent-native-openapi.json").read_bytes()
    if canonical != rederived:
        raise ValueError("Current Native OpenAPI differs from the canonical tested input")
    wire_taki = (TAKI / "packages/shared/src/fixtures/hindsight-template-validation-cases.json").read_bytes()
    wire_native = (NATIVE / "hindsight-api-slim/tests/native_results/template_validation_cases.json").read_bytes()
    if wire_taki != wire_native:
        raise ValueError("Cross-language structural case bytes differ")
    result = {
        "scope": "Independent B1 Native/Shared/compatibility review; whole B1 acceptance belongs to root",
        "repositories": repositories,
        "sourceTextUtf8NoBom": True,
        "generatedFilesMatched": len(generated),
        "canonicalOpenapiSha256": hashlib.sha256(canonical).hexdigest(),
        "rederivedOpenapiBytesEqual": True,
        "structuralCaseBytesEqual": True,
        "structuralCasesSha256": hashlib.sha256(wire_native).hexdigest(),
    }
    output = RESEARCH / "b1-independent-native-final-source.json"
    if output.exists():
        raise ValueError("Do not overwrite frozen review evidence")
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "sourceCounts": [len(row["files"]) for row in repositories],
                      "generatedFilesMatched": len(generated), "canonicalOpenapiSha256": result["canonicalOpenapiSha256"]}))


if __name__ == "__main__":
    main()
