"""Fixed derived-image file gate, generated refusal cases and offline tokenizer load; no API."""

import json
import os
import signal
import sys
import time
from pathlib import Path

sys.path.insert(0, "/opt/taki-c2b-application")
from artifact_io import (
    APP,
    ARTIFACT,
    CACHE_KEY,
    PURELIB,
    TOKEN,
    Refused,
    base_metadata,
    build_gate,
    cache_gate,
    file_fact,
    plain_path,
    protected_facts,
    require,
    tree,
)


def check_files() -> dict:
    require(
        sys.argv[1:] == [] and sys.flags.no_site == 1 and sys.flags.isolated == 1 and sys.dont_write_bytecode,
        "checker_arguments",
    )
    require(sys.platform == "linux" and sys.version_info[:3] == (3, 11, 16), "checker_python")
    require(os.getuid() == 1000 and os.getgid() == 1000, "checker_user")
    plain_path(ARTIFACT)
    source = json.loads((ARTIFACT / "source-manifest.json").read_bytes())
    base = json.loads((ARTIFACT / "base-facts.json").read_bytes())
    observed = {}
    for name, root in (("hindsight_api", APP), ("managed_bootstrap", ARTIFACT / "managed_bootstrap")):
        actual = tree(root)
        require(actual["entries"] == source["trees"][name]["entries"], "installed_tree_mismatch")
        observed[name] = {"entries": len(actual["entries"]), "bytes": actual["bytes"], "sha256": actual["sha256"]}
    require(not Path("/opt/taki-c2b-application-input").exists(), "build_inputs_remain")
    for name, fact in source["metadata"].items():
        require(file_fact(ARTIFACT / "source-metadata" / name) == fact, "source_metadata_mismatch")
    metadata = base_metadata(base["metadata"])
    protected = protected_facts()
    require(
        protected == json.loads((ARTIFACT / "protected-baseline.json").read_bytes()), "protected_environment_changed"
    )
    for fact in base["tools"]:
        path = Path(fact["path"])
        plain_path(path)
        require(file_fact(path) == {"bytes": fact["bytes"], "sha256": fact["sha256"]}, "base_tool_changed")
    build = build_gate(APP / "engine/taki_compatibility.py")
    cache_path = ARTIFACT / "tokenizer" / CACHE_KEY
    cache = cache_gate(cache_path)
    require(not os.access(cache_path, os.W_OK) and not os.access(cache_path.parent, os.W_OK), "cache_writable")
    return {"trees": observed, "metadata": metadata, "protected": protected, "build": build, "cache": cache}


def refusal_cases() -> list[dict]:
    """The same gates inspect immutable generated negatives, never production application state."""
    cases = [
        ("wrong_build", lambda: build_gate(ARTIFACT / "negative/wrong-build.py")),
        ("cache_missing", lambda: cache_gate(ARTIFACT / "negative/missing-cache")),
        ("cache_corrupt", lambda: cache_gate(ARTIFACT / "negative/corrupt-cache")),
    ]
    result = []
    for expected, action in cases:
        try:
            action()
        except Refused as error:
            require(str(error) == expected, "refusal_class_mismatch")
            result.append({"case": expected, "refused": True, "beforeThirdPartyImport": True})
        else:
            raise Refused("negative_case_admitted")
    return result


def tokenizer_load() -> dict:
    # With -S, no .pth/site startup ran. Permit the fixed package path only after every file gate.
    plugins = tree(PURELIB / "tiktoken_ext", caches=True)["entries"]
    require(set(plugins) == {"openai_public.py"}, "unexpected_tokenizer_plugin")
    cache_path = str(ARTIFACT / "tokenizer" / CACHE_KEY)
    observations = {"cacheReads": 0, "forbiddenEffects": 0}

    def audit(event: str, args: tuple) -> None:
        blocked = event.startswith(("socket.", "subprocess.", "os.exec", "os.spawn")) or event == "os.system"
        if event == "import":
            name = args[0]
            blocked |= name.split(".")[0] in {"hindsight_api", "requests", "blobfile", "asyncpg", "psycopg2", "pg0"}
        if blocked:
            observations["forbiddenEffects"] += 1
            raise Refused("forbidden_tokenizer_effect")
        if event == "open" and args[0] == cache_path:
            observations["cacheReads"] += 1

    os.environ.clear()
    os.environ["TIKTOKEN_CACHE_DIR"] = str(ARTIFACT / "tokenizer")
    os.environ["PYTHON_DOTENV_DISABLED"] = "true"
    sys.addaudithook(audit)
    sys.path.append(str(PURELIB))
    import tiktoken

    require(tiktoken.__version__ == "0.12.0", "tokenizer_version")
    encoding = tiktoken.get_encoding("cl100k_base")
    text = "C2b offline tokenizer fixture <|endoftext|>"
    tokens = encoding.encode(text, disallowed_special=())
    require(
        encoding.name == "cl100k_base" and encoding.decode(tokens) == text and 0 < len(tokens) < 128,
        "tokenizer_roundtrip",
    )
    require(observations["cacheReads"] == 1 and observations["forbiddenEffects"] == 0, "tokenizer_cache_path")
    load_observations = dict(observations)
    cache_gate(Path(cache_path))
    require(
        not any(name == "hindsight_api" or name.startswith("hindsight_api.") for name in sys.modules),
        "application_imported",
    )
    return {
        "loaded": True,
        "version": tiktoken.__version__,
        "encoding": encoding.name,
        "roundtrip": True,
        "tokenCount": len(tokens),
        "postLoadCacheRechecked": True,
        **load_observations,
    }


def main() -> dict:
    started = time.monotonic()
    result = {
        "schema": "c2b-application-artifact-check-v1",
        "token": TOKEN,
        "deploymentReady": False,
        "scope": "Application-source/cache prerequisite; no managed API producer or lifecycle acceptance",
        "fileGatePassed": False,
        "refusalCasesPassed": False,
        "tokenizerLoadPassed": False,
        "complete": False,
    }
    try:
        result["files"] = check_files()
        result["fileGatePassed"] = True
        result["negativeCases"] = refusal_cases()
        result["refusalCasesPassed"] = True
        result["tokenizer"] = tokenizer_load()
        result["tokenizerLoadPassed"] = True
        result["complete"] = True
    except Exception as error:
        result["failure"] = str(error) if isinstance(error, Refused) else type(error).__name__
    result["elapsedMs"] = round((time.monotonic() - started) * 1000)
    result["python"] = sys.version.split()[0]
    result["uid"] = os.getuid()
    result["gid"] = os.getgid()
    return result


if __name__ == "__main__":

    def deadline(_signum: int, _frame: object) -> None:
        raise Refused("checker_deadline")

    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(180)
    output = main()
    raw = (json.dumps(output, separators=(",", ":")) + "\n").encode()
    require(len(raw) <= 32768, "checker_output_bound")
    sys.stdout.buffer.write(raw)
    sys.exit(0 if output["complete"] else 2)
