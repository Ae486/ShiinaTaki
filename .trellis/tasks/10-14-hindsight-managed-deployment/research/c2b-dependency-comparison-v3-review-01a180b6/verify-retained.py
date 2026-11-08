"""Verify retained V2 bytes and V3 source only; never execute a container or comparator."""

import difflib
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TOKEN = "e309a1b4-7047-44bb-a4af-cdd65b1a994a"
ARCHIVE = ROOT / ("c2b-dependencies-run-" + TOKEN)
PACKET = ROOT / "dependency-comparison-v3"
V2 = ROOT / "docker-dependency-inventory-v2"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def lines(raw):
    return [json.loads(line) for line in raw.splitlines() if line]


def stamp(raw):
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


release = read(PACKET / "release.json")
assert sha((PACKET / "release.json").read_bytes()) == "af2026e941ee0515b7fed41a5dce8c66c4409b6d15e65ea1bf1902bf75b8ebc8"
assert set(path.name for path in PACKET.iterdir()) == {"README.md", "release.json", "compare.py", "source-pyproject.toml"}
assert all(sha((PACKET / name).read_bytes()) == digest for name, digest in release["files"].items())
assert (PACKET / "source-pyproject.toml").read_bytes() == (V2 / "source-pyproject.toml").read_bytes()
assert (PACKET / "source-pyproject.toml").read_bytes() == Path("H:/hindsight/hindsight-api-slim/pyproject.toml").read_bytes()
assert sha(Path(release["hostPython"]["path"]).read_bytes()) == release["hostPython"]["sha256"]
parser = Path(release["packaging"]["path"])
assert {p.relative_to(parser).as_posix() for p in parser.rglob("*.py")} == set(release["packaging"]["files"])
assert all(sha((parser / name).read_bytes()) == digest for name, digest in release["packaging"]["files"].items())
diff = "".join(difflib.unified_diff((V2 / "compare.py").read_text().splitlines(True),
                                    (PACKET / "compare.py").read_text().splitlines(True),
                                    fromfile="v2/compare.py", tofile="v3/compare.py"))
(HERE / "comparison-delta.diff").write_text(diff, encoding="utf-8")

r = read(ARCHIVE / "result.json")
c = read(ARCHIVE / "commands.json")
d = read(ARCHIVE / "disposition.json")
hashes = {path.name: sha(path.read_bytes()) for path in ARCHIVE.iterdir()}
assert set(hashes) == set(d["hashes"]) | {"disposition.json"}
assert all(hashes[name] == digest for name, digest in d["hashes"].items())
assert hashes["result.json"] == release["inventoryResultSha256"] == "51afb014ed47b811813880d0b0c6f8e16beaae9cb8db0aa9cee0cec5dc6bf71e"
assert hashes["release.json"] == "09cecd8d80419224d6b562c179ffee6044551c6ae00523b961bf16b435b1e789"
assert r["release"] == read(V2 / "release.json")
assert all(sha((V2 / name).read_bytes()) == digest == hashes[name] for name, digest in r["release"]["files"].items())
assert r["inputs"] == {"release.json": hashes["release.json"], **r["release"]["files"]}
assert (ARCHIVE / ".c2b-dependencies-owner").read_bytes() == TOKEN.encode()
assert sum((ARCHIVE / name).stat().st_size for name in d["hashes"]) == d["stageBytes"] == 476936
assert not Path(d["stage"]).exists()
assert r["token"] == d["token"] == TOKEN and r["failure"] is None
assert r["inventoryComplete"] and r["inventory"]["complete"] and r["inventory"]["failure"] is None
assert not r["deploymentReady"] and not d["deploymentReady"]

assert len(c) == 13 and [item["index"] for item in c] == list(range(13))
assert [item["phase"] for item in c] == ["runtime"] * 8 + ["cleanup"] * 5
assert [item["argv"][5] for item in c] == ["info", "image", "container", "create", "container", "start", "info",
                                         "container", "info", "container", "rm", "container", "container"]
cid = r["containerId"]
name = "taki-c2b-dependencies-" + TOKEN
prefix = [r["release"]["docker"]["path"], "--host", r["release"]["engine"]["endpoint"],
          "--config", str(Path(d["stage"]) / "client-config")]
command_rows = []
for index, item in enumerate(c):
    assert item["argv"][:5] == prefix and item["stdoutEncoding"] == "utf8"
    for field in ["stdout", "stderr"]:
        raw = item[field].encode()
        assert len(raw) == item[field + "Bytes"] and sha(raw) == item[field + "Sha256"]
    assert item["code"] == (1 if index in [2, 11, 12] else 0) and item["closeObserved"]
    assert not any(item[key] for key in ["signal", "kills", "timedOut", "overflow", "spawnError", "persistenceError", "streamErrors"])
    assert stamp(item["completedAt"]) >= stamp(item["dispatchedAt"])
    if index:
        assert stamp(item["dispatchedAt"]) >= stamp(c[index - 1]["completedAt"])
    command_rows.append({"index": index, "kind": item["argv"][5], "pid": item["childPid"], "exit": item["code"],
                         "durationMs": (stamp(item["completedAt"]) - stamp(item["dispatchedAt"])).total_seconds() * 1000,
                         "stdoutBytes": item["stdoutBytes"], "stderrBytes": item["stderrBytes"]})
assert c[3]["stdout"].strip() == cid
expected_create = ["create", "--name", name, "--label", "taki.c2b.dependencies=" + TOKEN, "--label", "taki.c2b.role=dependency-inventory",
                   "--pull", "never", "--network", "none", "--read-only", "--user", "1000:1000", "--interactive", "--log-driver", "none",
                   "--memory", "256m", "--cpus", "1", "--pids-limit", "16", "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true",
                   "--entrypoint", "/app/api/.venv/bin/python", r["image"]["id"], "-I", "-B", "-S", "-"]
assert c[3]["argv"][5:] == expected_create
assert c[5]["argv"][5:] == ["start", "--attach", "--interactive", cid]
assert c[5]["stdinBytes"] == (ARCHIVE / "collect.py").stat().st_size == 7458
assert c[5]["stdinSha256"] == hashes["collect.py"] and c[5]["stderr"] == ""
assert json.loads(c[5]["stdout"]) == r["inventory"] and r["collectorCommandIndex"] == 5
assert c[10]["argv"][5:] == ["rm", cid] and c[10]["stdout"].strip() == cid
for index, ref in [(2, name), (11, cid), (12, name)]:
    assert c[index]["argv"][5:8] == ["container", "inspect", ref]
    assert c[index]["stdout"].strip() == "" and c[index]["stderr"].strip() == "Error response from daemon: No such container: " + ref
assert all(json.loads(c[index]["stdout"]) == r["engine"] for index in [0, 6, 8])
assert r["engine"] == {"id": r["release"]["engine"]["id"], "version": "29.0.1", "os": "linux"}
assert json.loads(c[1]["stdout"]) == r["image"]
assert r["image"] == {"id": "sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db",
                      "os": "linux", "architecture": "amd64", "volumes": None}
states = [json.loads(c[index]["stdout"]) for index in [4, 7, 9]]
assert states == r["inspections"] and [state["Status"] for state in states] == ["created", "exited", "exited"]
for state in states:
    assert state["Id"] == cid and state["Name"] == "/" + name and state["Image"] == r["image"]["id"]
    assert state["Path"] == "/app/api/.venv/bin/python" and state["Args"] == ["-I", "-B", "-S", "-"]
    assert state["User"] == "1000:1000" and not state["Tty"] and state["OpenStdin"] and state["ReadonlyRootfs"]
    assert state["NetworkMode"] == "none" and state["Mounts"] == [] and not state["PortBindings"] and not state["Ports"]
    assert state["Memory"] == 268435456 and state["NanoCpus"] == 1000000000 and state["PidsLimit"] == 16
    assert not state["Privileged"] and not state["CapAdd"] and state["CapDrop"] == ["ALL"]
    assert state["SecurityOpt"] == ["no-new-privileges=true"] and state["LogConfig"] == {"Config": {}, "Type": "none"}
    assert state["RestartPolicy"] == {"MaximumRetryCount": 0, "Name": "no"} and not state["OOMKilled"]
    assert state["Labels"] == {"taki.c2b.dependencies": TOKEN, "taki.c2b.role": "dependency-inventory"}
    assert set(state["Networks"]) <= {"none"} and not state["Running"]
    for net in state["Networks"].values():
        assert not any(net[key] for key in ["IPAddress", "GlobalIPv6Address", "Gateway", "IPv6Gateway"])
assert states[1]["StartedAt"] == states[2]["StartedAt"] == r["originalStart"]
assert states[1]["ExitCode"] == states[2]["ExitCode"] == 0

inventory = r["inventory"]
records = inventory["distributions"]
assert len(records) == len({item["file"] for item in records}) == 221
assert [item["file"] for item in records] == sorted(item["file"] for item in records)
assert all(re.fullmatch(r"[^/]+\.dist-info/METADATA", item["file"]) and re.fullmatch(r"[0-9a-f]{64}", item["sha256"])
           and 0 < item["bytes"] <= 512 * 1024 for item in records)
assert sum(item["bytes"] for item in records) == inventory["metadataBytes"] == 2433618
assert inventory["unsupportedMetadata"] == [{"file": "hindsight_api_slim-0.9.0.dist-info/METADATA", "metadataVersion": "2.5"}]
assert [{"file": item["file"], "metadataVersion": item["metadataVersion"]} for item in records if not item["metadataVersionSupported"]] == inventory["unsupportedMetadata"]
assert inventory["pythonExecutable"] == "/app/api/.venv/bin/python"
assert inventory["purelib"] == "/app/api/.venv/lib/python3.11/site-packages"
assert inventory["environment"]["python_full_version"] == "3.11.16" and inventory["environment"]["sys_platform"] == "linux"

pre = read(ROOT / "c2b-dependencies-v2-preflight-01a180b6.json")
post = read(ROOT / "c2b-dependencies-v2-root-readback-01a180b6.json")
execution = read(ROOT / "c2b-dependencies-v2-root-execution-01a180b6.json")
assert pre["commands"][3]["exitCode"] == post["rawPostInspect"]["exitCode"] == 0
assert pre["commands"][3]["stderr"] == post["rawPostInspect"]["stderr"] == ""
before = lines(pre["commands"][3]["stdout"])
after = lines(post["rawPostInspect"]["stdout"])
assert before == after == pre["containers"] and len(before) == 8
assert pre["commands"][2]["stdout"].splitlines() == [item["id"] for item in before]
assert pre["commands"][3]["args"][2:10] == post["rawPostInspect"]["args"][2:10] == [item["id"] for item in before]
assert all(item["id"] not in command["argv"] for item in before for command in c)
assert json.loads(execution["stdout"]) == d and execution["stderr"] == "" and execution["exitCode"] == 0
assert execution["releaseSha256"] == hashes["release.json"]
assert r["timing"]["workElapsedMs"] < 40000 and r["timing"]["beforeArchiveElapsedMs"] < d["overallElapsedMs"] < 60000
assert (stamp(c[-1]["completedAt"]) - stamp(r["timing"]["startedAt"])).total_seconds() * 1000 <= r["timing"]["beforeArchiveElapsedMs"]
assert d["overallElapsedMs"] == 4247.9329 and execution["outerElapsedMs"] == 4578 < 60000
original = read(ROOT / "c2b-dependencies-v2-comparison-original-01a180b6.json")
assert original["exitCode"] == 2 and json.loads(original["stdout"])["failure"] == "metadata_version_unsupported"
answer = {"verdict": "PASS_RETAINED_RAW_COLLECTION", "archiveHashes": hashes, "commandRows": command_rows,
          "containerId": cid, "distributionCount": len(records), "metadataBytes": inventory["metadataBytes"],
          "collectorStdoutBytes": c[5]["stdoutBytes"], "collectorElapsedMs": inventory["elapsedMs"],
          "unsupportedMetadata": inventory["unsupportedMetadata"], "stageBytes": d["stageBytes"],
          "unchangedWorkloads": len(before), "overallElapsedMs": d["overallElapsedMs"],
          "runtimeExecutedByReviewer": False, "v3SourcePinsVerified": True, "deploymentReady": False}
(HERE / "retained-verification.json").write_text(json.dumps(answer, indent=2) + "\n", encoding="utf-8")
print(json.dumps({key: value for key, value in answer.items() if key not in {"archiveHashes", "commandRows"}}))
