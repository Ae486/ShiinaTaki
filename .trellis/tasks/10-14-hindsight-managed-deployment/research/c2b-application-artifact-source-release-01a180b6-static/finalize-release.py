"""Freeze reviewable Root argv and source/evidence pins; no runtime effect."""

import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKET = HERE.parent / "docker-application-artifact"
TOKEN = "ad8bf8b8-9577-4420-9fd9-212574bd4568"
STAGE = Path("G:/TakiAgent-c2b-native-api") / f"application-{TOKEN}"
DOCKER = "C:/Program Files/Docker/Docker/resources/bin/docker.exe"
ENDPOINT = "npipe:////./pipe/dockerDesktopLinuxEngine"
TAG = f"taki-c2b-application:{TOKEN}"
NAME = f"taki-c2b-application-check-{TOKEN}"
ENTRY = "/app/api/.venv/bin/python"
ARGS = ["-I", "-B", "-S", "/opt/taki-c2b-application/artifact-check.py"]


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def fact(path: Path) -> dict:
    raw = path.read_bytes()
    return {"bytes": len(raw), "sha256": digest(raw)}


def save(path: Path, value: object) -> None:
    raw = (json.dumps(value, indent=2) + "\n").encode()
    if path.exists():
        assert path.read_bytes() == raw
        return
    with path.open("xb") as stream:
        stream.write(raw)
    assert path.read_bytes() == raw


snapshot_raw = (STAGE / "snapshot.json").read_bytes()
snapshot = json.loads(snapshot_raw)
assert snapshot["token"] == TOKEN
if not (HERE / "source-snapshot.json").exists():
    with (HERE / "source-snapshot.json").open("xb") as stream:
        stream.write(snapshot_raw)
assert (HERE / "source-snapshot.json").read_bytes() == snapshot_raw
stage = STAGE.as_posix()
plan = {
    "schema": "c2b-application-execution-plan-v1", "token": TOKEN, "deploymentReady": False,
    "executor": "Root-owned separate execution wrapper; this file does not dispatch effects",
    "stage": stage, "context": stage + "/context", "tag": TAG, "containerName": NAME,
    "archive": str(HERE.parent / f"c2b-application-run-{TOKEN}"),
    "docker": DOCKER, "endpoint": ENDPOINT,
    "clearedEnvironment": {"SystemRoot": "C:/Windows", "TEMP": stage + "/temp", "TMP": stage + "/temp"},
    "buildConfig": {"path": stage + "/build-config/config.json",
                    "content": {"cliPluginsExtraDirs": ["C:/Program Files/Docker/Docker/resources/cli-plugins"]}},
    "emptyClientConfig": stage + "/client-config", "windowsHide": True, "shell": False,
    "build": {
        "maximumSeconds": 600, "stdoutBytes": 1048576, "stderrBytes": 1048576,
        "intentFence": stage + "/build.started", "iidfile": stage + "/image-id.txt",
        "argv": ["--host", ENDPOINT, "--config", stage + "/build-config", "buildx", "build",
                 "--builder", "default", "--pull=false", "--network=none", "--load", "--progress=plain",
                 "--label", f"taki.c2b.application={TOKEN}", "--label", "taki.c2b.role=application-source-cache-prerequisite",
                 "--iidfile", stage + "/image-id.txt", "--tag", TAG, "--file", stage + "/context/Dockerfile", stage + "/context"],
        "requireBefore": ["source/release/snapshot pins", "exact Docker/Buildx and Engine", "default Docker-driver builder and endpoint",
                          "local base reference exact ID", "tag and iidfile/fence absent"],
        "requireAfter": ["successful bounded process", "iidfile=result image ID=owned tag ID", "exact token/role labels",
                         "unchanged base reference", "exact original base RootFS layer prefix", "fixed image entrypoint/user/env; no volumes"],
        "unknown": "Retain fence/context/result streams and observe only. Never retry build or adopt/clean an uncertain image.",
    },
    "check": {
        "workSeconds": 180, "totalIncludingCleanupArchiveSeconds": 240, "cleanupReserveSeconds": 60,
        "stdoutBytes": 32768, "stderrBytes": 16384,
        "createArgvTemplate": ["--host", ENDPOINT, "--config", stage + "/client-config", "create", "--name", NAME,
                               "--label", f"taki.c2b.application={TOKEN}", "--label", "taki.c2b.role=application-source-cache-check",
                               "--pull", "never", "--restart", "no", "--network", "none", "--read-only", "--user", "1000:1000",
                               "--log-driver", "none", "--memory", "256m", "--cpus", "1", "--pids-limit", "16", "--cap-drop", "ALL",
                               "--security-opt", "no-new-privileges=true", "--entrypoint", ENTRY, "<verified-original-result-image-id>", *ARGS],
        "startArgvTemplate": ["--host", ENDPOINT, "--config", stage + "/client-config", "start", "--attach", "<verified-original-container-id>"],
        "expected": {"schema": "c2b-application-artifact-check-v1", "token": TOKEN, "complete": True,
                     "fileGatePassed": True, "refusalCasesPassed": True, "tokenizerLoadPassed": True, "deploymentReady": False,
                     "files.build": "taki-memory-hindsight-0.9.0-template-backup-v1", "files.metadata.count": 221,
                     "tokenizer.loaded": True, "tokenizer.roundtrip": True, "tokenizer.cacheReads": 1,
                     "tokenizer.forbiddenEffects": 0, "tokenizer.postLoadCacheRechecked": True,
                     "uid": 1000, "gid": 1000, "python": "3.11.16"},
        "identityBeforeStart": {"image": "verified original result ID", "user": "1000:1000", "entrypoint": ENTRY, "args": ARGS,
                                "network": "none", "readOnlyRootfs": True, "mounts": [], "publications": [], "tty": False,
                                "interactiveStdin": False, "memoryBytes": 268435456, "nanoCpus": 1000000000, "pidsLimit": 16,
                                "capAdd": [], "capDrop": ["ALL"], "securityOpt": ["no-new-privileges=true"], "privileged": False,
                                "logDriver": "none", "restart": "no", "status": "created", "running": False},
        "refusalCases": ["wrong_build", "cache_missing", "cache_corrupt"],
        "unknown": "Preserve original create/start dispatch. Name-only observation cannot authorize mutation, adoption or retry.",
    },
    "retention": {"success": "Keep exact derived image/tag and marked G: snapshot for later producer gate; archive bounded evidence first.",
                  "container": "Reprove original ID/settings; stop only if needed; remove only the stopped original CID; verify ID/name absence.",
                  "failedImage": "Only after exact iidfile/label/tag/no-consumer proof; image rm --no-prune owned-tag, no force or base cleanup.",
                  "stage": "Root-only later marked-stage removal after exact archive readback; keep on failure or ambiguous ownership."},
    "limits": {"sourceEntriesPerTree": 2048, "sourceTreeBytes": 33554432, "sourceFileBytes": 8388608,
               "protectedEntries": 150000, "protectedTreeBytes": 8589934592, "protectedFileBytes": 1073741824,
               "protectedTreeScanSeconds": 180, "metadataDistributions": 221},
}
save(PACKET / "execution-plan.json", plan)
tokenizer = []
base = json.loads((PACKET / "base-facts.json").read_bytes())
for relative in ("tiktoken/load.py", "tiktoken/registry.py", "tiktoken_ext/openai_public.py"):
    path = Path("H:/hindsight/.venv/Lib/site-packages") / relative
    raw = path.read_bytes()
    normalized = digest(raw.replace(b"\r\n", b"\n"))
    original = next(item for item in base["tools"] if item["path"].endswith("/" + relative))
    assert normalized == original["sha256"]
    tokenizer.append({"path": str(path), **fact(path), "lfSha256": normalized, "matchesInstalledSource": True})
save(HERE / "tokenizer-source-evidence.json", tokenizer)
names = sorted(path.name for path in PACKET.iterdir())
assert len(names) == 9 and all((PACKET / name).is_file() for name in names)
release = {
    "schema": "c2b-application-source-release-v1", "token": TOKEN, "deploymentReady": False,
    "status": "source-checks-and-snapshot-complete-root-execution-unperformed",
    "scope": "Application-source and offline-tokenizer-cache prerequisite only; no managed API/PG/Host/receipt readiness",
    "files": {name: fact(PACKET / name) for name in names},
    "snapshot": {"path": str(STAGE / "snapshot.json"), **fact(STAGE / "snapshot.json"),
                 "contextSha256": snapshot["context"]["sha256"], "contextBytes": snapshot["context"]["bytes"],
                 "contextEntries": len(snapshot["context"]["entries"])},
    "sourceCounts": {name: {"files": sum("bytes" in item for item in value["entries"].values()), "bytes": value["bytes"]}
                     for name, value in snapshot["source"]["trees"].items()},
    "tools": {"docker": {"path": DOCKER, "sha256": "0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d"},
              "buildx": {"path": "C:/Program Files/Docker/Docker/resources/cli-plugins/docker-buildx.exe",
                         "sha256": "c8d20cd80c940cf866717dd938eca50dbe588e06e0c0ced5a9d97b06b27bf8a7"},
              "hostPython": {"path": "G:/anaconda3/python.exe", "sha256": "6965927a96b81d1717c1d2186de7feb9b29ebf8775464020ebc2f25de6ef8ee0"}},
    "engine": {"endpoint": ENDPOINT, "id": "93e8319e-24b7-4a7d-88f1-60923ad681e0", "version": "29.0.1", "os": "linux"},
    "baseId": base["imageId"], "baseReference": "taki-hindsight-api:local",
    "dependencyV4ReleaseSha256": base["dependencyV4ReleaseSha256"],
    "originalInventoryResultSha256": base["inventoryResultSha256"],
    "evidence": {name: fact(HERE / name) for name in ("checks-initial.json", "checks-final.json", "freeze-execution.json",
                                                     "source-snapshot.json", "tokenizer-source-evidence.json")},
}
save(PACKET / "release.json", release)
save(HERE / "release-verification.json", {"release": fact(PACKET / "release.json"), "closedFiles": names + ["release.json"],
                                         "snapshot": release["snapshot"], "sourceCounts": release["sourceCounts"],
                                         "deploymentReady": False})
print(json.dumps({"release": fact(PACKET / "release.json"), "sourceCounts": release["sourceCounts"], "files": len(names)}))
