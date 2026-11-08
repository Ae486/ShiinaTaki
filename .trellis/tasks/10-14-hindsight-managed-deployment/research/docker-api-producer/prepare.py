"""One task-only full-bootstrap freeze and read-only verification; no Docker commands."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from artifact_io import encoded, file_fact, plain_path, require, sha, tree

HERE = Path(__file__).resolve().parent
TOKEN = "5c7480e7-4501-447a-a3bf-2e02f28a9fda"
STAGE = Path("G:/TakiAgent-c2b-native-api") / ("producer-" + TOKEN)
SOURCE = Path("H:/hindsight/docker/standalone/managed_bootstrap")
NATIVE_RELEASE = HERE.parent / "c2b-api-producer-source-01a180b6-validation/source-manifest.json"
FIXTURE = ("artifact_io.py", "fixture_support.py", "fixture.py", "install-producer.py")


def save(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    plain_path(path.parent)
    with path.open("xb") as stream:
        stream.write(raw)
        stream.flush()
        import os

        os.fsync(stream.fileno())
    require(path.read_bytes() == raw, "copy_readback")


def observed() -> dict:
    native = NATIVE_RELEASE.read_bytes()
    require(sha(native) == "2312c406be9e6d35742da5f8dcf5703b821bc6c9f0adbd82470626eef6feba09", "native_release_changed")
    released = json.loads(native)
    bootstrap = tree(SOURCE, caches=True)
    for name, fact in released["files"].items():
        require(bootstrap["entries"].get(name) == fact, "native_source_changed")
    return {"schema": "c2b-producer-input-v1", "token": TOKEN, "deploymentReady": False,
            "baseId": "sha256:c57385ec5ad1243659db1e1159f65218c1a48dd0481e94f468cbc0ada376b11e",
            "nativeReleaseSha256": sha(native), "bootstrap": bootstrap,
            "fixtureFiles": {name: file_fact(HERE / name) for name in FIXTURE}}


def freeze() -> dict:
    require(not STAGE.exists(), "stage_collision")
    plain_path(STAGE.parent)
    before = observed()
    STAGE.mkdir()
    save(STAGE / ".c2b-api-producer-owner", TOKEN.encode())
    save(STAGE / "freeze-intent.json", encoded(before))
    payload = STAGE / "context/payload"
    (payload / "managed_bootstrap").mkdir(parents=True)
    for name, fact in before["bootstrap"]["entries"].items():
        target = payload / "managed_bootstrap" / name
        if fact.get("directory"):
            target.mkdir(exist_ok=True)
            continue
        source = SOURCE / name
        plain_path(source)
        raw = source.read_bytes()
        require({"bytes": len(raw), "sha256": sha(raw)} == fact, "source_changed_during_freeze")
        save(target, raw)
    for name, fact in before["fixtureFiles"].items():
        raw = (HERE / name).read_bytes()
        require({"bytes": len(raw), "sha256": sha(raw)} == fact, "fixture_changed_during_freeze")
        save(payload / name, raw)
    save(payload / "producer-manifest.json", encoded(before))
    save(STAGE / "context/Dockerfile", (HERE / "Dockerfile").read_bytes())
    save(STAGE / "context/.dockerignore", b"\n")
    require(observed() == before, "source_changed_after_freeze")
    require(tree(payload / "managed_bootstrap")["entries"] == before["bootstrap"]["entries"], "bootstrap_copy")
    snapshot = {"token": TOKEN, "source": before, "context": tree(STAGE / "context")}
    save(STAGE / "snapshot.json", encoded(snapshot))
    return snapshot


def verify() -> dict:
    plain_path(STAGE)
    require((STAGE / ".c2b-api-producer-owner").read_bytes() == TOKEN.encode(), "stage_owner")
    snapshot = json.loads((STAGE / "snapshot.json").read_bytes())
    require(snapshot["token"] == TOKEN and snapshot["source"] == observed(), "source_drift")
    require(snapshot["context"] == tree(STAGE / "context"), "context_drift")
    require(file_fact(HERE / "Dockerfile") == file_fact(STAGE / "context/Dockerfile"), "recipe_drift")
    return snapshot


if __name__ == "__main__":
    try:
        require(sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode, "python_flags")
        require(sys.argv[1:] in (["--freeze"], ["--verify"]), "arguments")
        result = freeze() if sys.argv[1] == "--freeze" else verify()
        print(json.dumps({"complete": True, "deploymentReady": False, "token": TOKEN, "stage": str(STAGE),
                          "contextSha256": result["context"]["sha256"], "contextBytes": result["context"]["bytes"],
                          "bootstrapFiles": sum("bytes" in value for value in result["source"]["bootstrap"]["entries"].values())}))
    except Exception as error:
        print(json.dumps({"complete": False, "deploymentReady": False, "failure": type(error).__name__}))
        raise SystemExit(2) from None
