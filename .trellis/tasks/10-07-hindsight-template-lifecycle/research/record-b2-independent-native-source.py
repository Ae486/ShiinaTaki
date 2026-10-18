"""Capture independent Native/label review bytes and unchanged generated evidence."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

RESEARCH = Path(__file__).resolve().parent
TAKI = RESEARCH.parents[3]
NATIVE = Path("H:/hindsight")
ADDED_SCOPE = [
    "hindsight-api-slim/hindsight_api/engine/llm_wrapper.py",
    *[
        f"hindsight-api-slim/hindsight_api/engine/providers/{name}.py"
        for name in (
            "litellm_llm",
            "openai_compatible_llm",
            "openai_responses_llm",
            "anthropic_llm",
            "codex_llm",
            "claude_code_llm",
        )
    ],
    "hindsight-api-slim/tests/test_llm_wrapper.py",
]
PROVIDER_REGRESSIONS = [
    f"hindsight-api-slim/tests/{name}.py"
    for name in (
        "test_llm_wrapper",
        "test_litellm_json_repair",
        "test_openai_compatible_response_hardening",
        "test_openai_responses_provider",
        "test_anthropic_structured_tool_use",
        "test_codex_strict_schema",
        "test_llm_strict_schema",
        "test_claude_code_llm_error_result",
    )
]


def identity(root: Path, relative: str) -> dict[str, object]:
    target = (root / relative).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError(f"Source escaped its repository: {relative}")
    raw = target.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ValueError(f"Unexpected UTF-8 BOM: {relative}")
    raw.decode("utf-8")
    return {"path": relative, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def main() -> None:
    name = sys.argv[1]
    if not re.fullmatch(r"[a-z0-9_-]+", name):
        raise ValueError("A unique bounded snapshot name is required")
    released = json.loads((RESEARCH / "b2-native-source-final-01.json").read_text(encoding="utf-8"))
    labels = json.loads((RESEARCH / "b2-label-source.json").read_text(encoding="utf-8"))
    reviewed = json.loads((RESEARCH / "b1-reviewed-source.json").read_text(encoding="utf-8"))
    native_b1 = next(item for item in reviewed["repositories"] if Path(item["root"]).resolve() == NATIVE.resolve())
    native_files = [identity(NATIVE, path) for path in sorted({row["path"] for row in released["files"]} | set(ADDED_SCOPE))]
    label_files = [identity(TAKI, row["file"]) for row in labels["files"]]
    native_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=NATIVE, text=True).strip()
    taki_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=TAKI, text=True).strip()
    if native_head != released["nativeHead"] or taki_head != labels["repository"]["head"]:
        raise ValueError("A repository HEAD changed during independent review")
    label_before = {row["file"]: row["sha256"] for row in labels["files"]}
    if any(row["sha256"] != label_before[row["path"]] for row in label_files):
        raise ValueError("The frozen seven-file Core label scope changed")

    generated = json.loads((RESEARCH / "b2-generated-tested.json").read_text(encoding="utf-8"))
    rust_outputs = list((NATIVE / "hindsight-clients/rust/target/release/build").glob(
        "hindsight-client-*/out/hindsight_client_generated.rs"
    ))
    if len(rust_outputs) != 1:
        raise ValueError("Expected exactly one canonical Rust generated output")
    for key, frozen in generated.items():
        target = rust_outputs[0] if key == "rust-build/hindsight_client_generated.rs" else NATIVE / key
        raw = target.read_bytes()
        if len(raw) != frozen["bytes"] or hashlib.sha256(raw).hexdigest() != frozen["sha256"]:
            raise ValueError(f"Generated evidence changed: {key}")

    original = {row["path"]: row["sha256"] for row in released["files"]}
    b1 = {row["path"]: row["sha256"] for row in native_b1["files"]}
    core_type_path = RESEARCH / "b2-core-read-check-input-03.json"
    core_type_input = json.loads(core_type_path.read_text(encoding="utf-8"))
    core_type_changed = [
        row["file"] for row in core_type_input["typeInputs"]
        if identity(TAKI, row["file"])["sha256"] != row["sha256"]
    ]
    earlier_types = json.loads((RESEARCH / "b2-core-read-check-input-02.json").read_text(encoding="utf-8"))
    earlier_hashes = {row["file"]: row["sha256"] for row in earlier_types["typeInputs"]}
    shared_type_deltas = [
        row["file"] for row in core_type_input["typeInputs"]
        if not row["file"].startswith("packages/core/") and earlier_hashes.get(row["file"]) != row["sha256"]
    ]
    result = {
        "capturedAtUtc": datetime.now(UTC).isoformat(),
        "scope": "Independent B2 Native and seven-file trusted-label review; whole B2 remains root-owned",
        "nativeRoot": str(NATIVE),
        "nativeHead": native_head,
        "takiRoot": str(TAKI),
        "takiHead": taki_head,
        "nativeFiles": native_files,
        "changedSinceNativeRelease": [row["path"] for row in native_files if original.get(row["path"]) != row["sha256"]],
        "changedSinceAcceptedB1": [row["path"] for row in native_files if b1.get(row["path"]) != row["sha256"]],
        "coreLabelFiles": label_files,
        "coreLabelReleaseBytesMatched": True,
        "providerRegressionInputs": [identity(NATIVE, path) for path in PROVIDER_REGRESSIONS],
        "coreTypecheckInput": {
            "manifest": identity(TAKI, str(core_type_path.relative_to(TAKI))),
            "checkedFiles": len(core_type_input["typeInputs"]),
            "changed": core_type_changed,
            "sharedChangesBetweenInputs02And03": shared_type_deltas,
        },
        "lifecycleSpec": identity(TAKI, ".trellis/spec/backend/hindsight-template-lifecycle.md"),
        "generatedManifest": identity(TAKI, str((RESEARCH / "b2-generated-tested.json").relative_to(TAKI))),
        "generatedFilesMatched": len(generated),
        "rustGeneratedActualPath": str(rust_outputs[0]),
        "canonicalOpenapi": identity(NATIVE, "hindsight-docs/static/openapi.json"),
        "sourceTextUtf8NoBom": True,
    }
    output = RESEARCH / f"b2-independent-native-source-{name}.json"
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"manifest": str(output), "nativeFiles": len(native_files),
                      "coreLabelFiles": len(label_files), "generatedFilesMatched": len(generated),
                      "changedSinceNativeRelease": len(result["changedSinceNativeRelease"]),
                      "manifestSha256": hashlib.sha256(output.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
