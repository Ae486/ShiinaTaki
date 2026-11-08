"""Freeze the fixed current source snapshot, or verify it without source/runtime mutation."""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from artifact_io import TOKEN, Refused, build_gate, encoded, file_fact, plain_path, require, sha, tree

HERE = Path(__file__).resolve().parent
SOURCE = Path("H:/hindsight")
STAGE = Path("G:/TakiAgent-c2b-native-api") / f"application-{TOKEN}"
CONTEXT = STAGE / "context"
TREES = {
    "hindsight_api": SOURCE / "hindsight-api-slim/hindsight_api",
    "managed_bootstrap": SOURCE / "docker/standalone/managed_bootstrap",
}
METADATA = {
    "root-pyproject.toml": SOURCE / "pyproject.toml",
    "package-pyproject.toml": SOURCE / "hindsight-api-slim/pyproject.toml",
    "uv.lock": SOURCE / "uv.lock",
}
CODE = ("artifact_io.py", "install-artifact.py", "artifact-check.py", "base-facts.json")


def save(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    plain_path(path.parent)
    with path.open("xb") as stream:
        stream.write(raw)
        stream.flush()
        import os

        os.fsync(stream.fileno())
    require(path.read_bytes() == raw, "snapshot_readback")


def observe() -> dict:
    result = {"trees": {}, "metadata": {}}
    for name, root in TREES.items():
        result["trees"][name] = tree(root, caches=True)
    for name, path in METADATA.items():
        plain_path(path)
        result["metadata"][name] = file_fact(path, 2 * 1024**2)
    require(
        result["metadata"]["package-pyproject.toml"]["sha256"]
        == "6a1735ecb0d5e5f86662cb2138af8c616f36ec1ce071067f190887b4864f59b5",
        "dependency_source_drift",
    )
    build_gate(TREES["hindsight_api"] / "engine/taki_compatibility.py")
    return result


def copy_checked(source: Path, target: Path, fact: dict) -> None:
    plain_path(source)
    require(file_fact(source) == fact, "source_changed_before_copy")
    raw = source.read_bytes()
    require({"bytes": len(raw), "sha256": sha(raw)} == fact, "source_changed_during_copy")
    save(target, raw)


def freeze() -> dict:
    require(not STAGE.exists(), "stage_collision")
    plain_path(STAGE.parent)
    before = observe()
    STAGE.mkdir()
    save(STAGE / ".c2b-application-owner", TOKEN.encode())
    save(STAGE / "freeze-intent.json", encoded({"token": TOKEN, "scope": "source snapshot only", "before": before}))
    for name, root in TREES.items():
        target = CONTEXT / "payload" / name
        target.mkdir(parents=True)
        for relative, fact in before["trees"][name]["entries"].items():
            if fact.get("directory"):
                (target / relative).mkdir(exist_ok=True)
            else:
                copy_checked(root / relative, target / relative, fact)
    for name, path in METADATA.items():
        copy_checked(path, CONTEXT / "payload/source-metadata" / name, before["metadata"][name])
    for name in CODE:
        copy_checked(HERE / name, CONTEXT / "payload" / name, file_fact(HERE / name))
    copy_checked(HERE / "Dockerfile", CONTEXT / "Dockerfile", file_fact(HERE / "Dockerfile"))
    save(CONTEXT / ".dockerignore", b"\n")
    save(CONTEXT / "payload/source-manifest.json", encoded(before))
    require(observe() == before, "source_changed_after_copy")
    for name in TREES:
        require(tree(CONTEXT / "payload" / name)["entries"] == before["trees"][name]["entries"], "copied_tree_mismatch")
    snapshot = {
        "schema": "c2b-application-snapshot-v1",
        "token": TOKEN,
        "deploymentReady": False,
        "source": before,
        "context": tree(CONTEXT),
        "completedAt": time.time(),
    }
    save(STAGE / "snapshot.json", encoded(snapshot))
    return snapshot


def verify() -> dict:
    plain_path(STAGE)
    require((STAGE / ".c2b-application-owner").read_text() == TOKEN, "stage_owner")
    value = json.loads((STAGE / "snapshot.json").read_bytes())
    require(value["token"] == TOKEN and value["source"] == observe(), "source_snapshot_drift")
    require(value["context"] == tree(CONTEXT), "context_changed")
    for name in CODE:
        require(file_fact(HERE / name) == file_fact(CONTEXT / "payload" / name), "packet_source_changed")
    require(file_fact(HERE / "Dockerfile") == file_fact(CONTEXT / "Dockerfile"), "recipe_changed")
    return value


if __name__ == "__main__":
    try:
        require(sys.flags.no_site == 1 and sys.flags.isolated == 1 and sys.dont_write_bytecode, "python_flags")
        require(sys.argv[1:] in (["--freeze"], ["--verify"]), "arguments")
        value = freeze() if sys.argv[1] == "--freeze" else verify()
        print(
            json.dumps(
                {
                    "snapshotComplete": True,
                    "deploymentReady": False,
                    "token": TOKEN,
                    "stage": str(STAGE),
                    "contextSha256": value["context"]["sha256"],
                    "contextBytes": value["context"]["bytes"],
                    "contextEntries": len(value["context"]["entries"]),
                }
            )
        )
    except Exception as error:
        print(
            json.dumps(
                {
                    "snapshotComplete": False,
                    "deploymentReady": False,
                    "failure": str(error) if isinstance(error, Refused) else type(error).__name__,
                }
            )
        )
        sys.exit(2)
