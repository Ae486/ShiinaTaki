"""INPUT: fixed stdin packet in the pinned read-only cached image, as UID/GID 1000.
OUTPUT: bounded installed-module/cache inventory; no API or producer readiness.
POS: task-only C2b prerequisite; stdlib reads only, no target imports or subprocesses.
"""

import ast
import hashlib
import json
import os
import re
import signal
import stat
import sys
import sysconfig
import time
from importlib.machinery import PathFinder
from importlib.metadata import PackageNotFoundError, distribution
from pathlib import Path

BASE_IMAGE = "sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db"
SOURCE_BUILD = "taki-memory-hindsight-0.9.0-template-backup-v1"
PG0_HASH = "20c65441992d3f1d433c7d5d33a14aba0030c77913beed9c9571e3816ea7f8fb"
ROOT = Path("/app/api")
PURELIB = ROOT / ".venv/lib/python3.11/site-packages"
CACHE_DIRS = (
    Path("/tmp/data-gym-cache"),
    Path("/var/tmp/data-gym-cache"),
    Path("/usr/tmp/data-gym-cache"),
    Path("/home/hindsight/.pg0/data-gym-cache"),
)
PACKAGES = (
    "hindsight-api-slim",
    "tiktoken",
    "openai",
    "uvicorn",
    "fastapi",
    "asyncpg",
    "psycopg2-binary",
    "pg0-embedded",
    "python-dotenv",
)
MODULES = (
    "hindsight_api",
    "hindsight_api.server",
    "hindsight_api.engine.memory_engine",
    "hindsight_api.engine.token_encoding",
    "hindsight_api.engine.taki_compatibility",
    "hindsight_api.extensions.builtin.tenant",
    "hindsight_api.extensions.builtin.taki_memory",
    "hindsight_api.api.taki_template_lifecycle",
    "hindsight_api.engine.template_apply",
    "hindsight_api.engine.template_initialization",
    "hindsight_api.engine.template_snapshot",
    "hindsight_api.engine.template_mutations",
    "tiktoken.load",
    "tiktoken.registry",
    "tiktoken_ext.openai_public",
    "tiktoken._tiktoken",
    "openai",
    "uvicorn",
    "fastapi",
    "asyncpg",
    "psycopg2",
    "pg0",
    "dotenv",
)
SOURCE_MODULES = {
    "hindsight_api.engine.memory_engine",
    "hindsight_api.engine.token_encoding",
    "hindsight_api.engine.taki_compatibility",
    "tiktoken.load",
    "tiktoken_ext.openai_public",
}
STARTED = time.monotonic()
OUTPUT_LIMIT = 64 * 1024
read_bytes = 0
file_count = 0
sources = {}
result = {
    "schema": "c2b-cached-image-inventory-v1",
    "scope": "cached-base-static-inventory",
    "expected_image_input": BASE_IMAGE,
    "deploymentReady": False,
    "inventory_complete": False,
    "unresolved": [],
}


class InventoryStop(Exception):
    """Only fixed, non-secret codes cross the output boundary."""


def require(condition, code):
    if not condition:
        raise InventoryStop(code)


def alarm(_signal, _frame):
    raise InventoryStop("packet_deadline")


def file_facts(path, limit, keep_source=False):
    """Read fixed files only; no symlink leaf, directory scan or cache creation."""
    global read_bytes, file_count
    require(len(str(path)) <= 1024, "path_limit")
    resolved = path.resolve()
    require(
        resolved.is_relative_to(ROOT) or any(resolved.is_relative_to(p) for p in CACHE_DIRS),
        "path_outside_fixed_roots",
    )
    item = {"path": str(path), "resolved_path": str(resolved), "state": "missing"}
    try:
        info = path.lstat()
    except FileNotFoundError:
        return item, None
    file_count += 1
    require(file_count <= 64, "file_count_limit")
    item.update(
        bytes=info.st_size,
        mode=oct(stat.S_IMODE(info.st_mode)),
        uid=info.st_uid,
        gid=info.st_gid,
        readable=os.access(path, os.R_OK, effective_ids=True),
    )
    if not stat.S_ISREG(info.st_mode) or not item["readable"]:
        item["state"] = "nonregular_or_unreadable"
        return item, None
    require(info.st_size <= limit, "file_size_limit")
    digest = hashlib.sha256()
    body = bytearray() if keep_source else None
    with path.open("rb") as stream:
        while chunk := stream.read(256 * 1024):
            read_bytes += len(chunk)
            require(read_bytes <= 96 * 1024 * 1024, "total_read_limit")
            digest.update(chunk)
            if body is not None:
                body.extend(chunk)
    item.update(state="read", sha256=digest.hexdigest())
    return item, bytes(body) if body is not None else None


def package_facts(name):
    """Reuse the earlier probe's fixed distribution inventory, without importing it."""
    try:
        installed = distribution(name)
    except PackageNotFoundError:
        result["unresolved"].append("distribution_missing:" + name)
        return {"name": name, "state": "missing"}
    files = installed.files or []
    require(len(files) <= 8192, "distribution_file_count_limit")
    require(sum(len(str(p)) for p in files) <= 512 * 1024, "distribution_path_limit")
    require(len(installed.version) <= 128, "version_limit")
    root = Path(installed.locate_file("")).resolve()
    require(root.is_relative_to(ROOT), "distribution_outside_fixed_root")
    metadata = []
    for entry in files:
        if entry.name in {"METADATA", "WHEEL"} and entry.parent.name.endswith(".dist-info"):
            item, _ = file_facts(Path(installed.locate_file(entry)), 512 * 1024)
            metadata.append(item)
    if not metadata or any(p["state"] != "read" for p in metadata):
        result["unresolved"].append("distribution_metadata_unconfirmed:" + name)
    return {"name": name, "version": installed.version, "root": str(root), "metadata": metadata}


def module_facts(name):
    # PathFinder does not execute loaders or import dotted parents. util.find_spec
    # would import hindsight_api while resolving its children and is forbidden here.
    search = list(sys.path)
    spec = None
    for part in name.split("."):
        # The explicit parent search roots preserve resolution. A basename avoids
        # namespace-path recalculation looking up an unimported dotted parent.
        spec = PathFinder.find_spec(part, search)
        if spec is None:
            break
        search = list(spec.submodule_search_locations or [])
        require(len(search) <= 4, "module_search_limit")
        for entry in search:
            require(Path(entry).resolve().is_relative_to(ROOT), "module_search_outside_root")
    if spec is None or not spec.origin:
        result["unresolved"].append("module_missing:" + name)
        return {"name": name, "state": "missing"}
    item, body = file_facts(
        Path(spec.origin),
        16 * 1024 * 1024 if name == "tiktoken._tiktoken" else 2 * 1024 * 1024,
        name in SOURCE_MODULES,
    )
    if item["state"] != "read":
        result["unresolved"].append("module_unreadable:" + name)
    if body is not None:
        sources[name] = body.decode("utf-8")
    return {"name": name, **item}


def assignment_matches(tree, target, expression):
    expected = ast.dump(ast.parse(expression, mode="eval").body)
    return any(
        isinstance(node, ast.Assign)
        and any(isinstance(part, ast.Name) and part.id == target for part in node.targets)
        and ast.dump(node.value) == expected
        for node in ast.walk(tree)
    )


def tokenizer_facts():
    reader = sources.get("tiktoken.load")
    definitions = sources.get("tiktoken_ext.openai_public")
    if reader is None or definitions is None:
        result["unresolved"].append("tokenizer_source_unavailable")
        return
    functions = {n.name: n for n in ast.parse(reader).body if isinstance(n, ast.FunctionDef)}
    require(
        all(name in functions for name in ("read_file_cached", "check_hash", "load_tiktoken_bpe")),
        "unsupported_tokenizer_reader",
    )
    cached = functions["read_file_cached"]
    bindings = {
        "explicit_cache_directory": assignment_matches(
            cached, "cache_dir", 'os.environ["TIKTOKEN_CACHE_DIR"]'
        ),
        "url_sha1_key": assignment_matches(
            cached, "cache_key", "hashlib.sha1(blobpath.encode()).hexdigest()"
        ),
        "cache_path_join": assignment_matches(
            cached, "cache_path", "os.path.join(cache_dir, cache_key)"
        ),
        "content_sha256": assignment_matches(
            functions["check_hash"], "actual_hash", "hashlib.sha256(data).hexdigest()"
        ),
        "encoding_uses_reader": assignment_matches(
            functions["load_tiktoken_bpe"],
            "contents",
            "read_file_cached(tiktoken_bpe_file, expected_hash)",
        ),
    }
    encoding = next(
        (
            n
            for n in ast.parse(definitions).body
            if isinstance(n, ast.FunctionDef) and n.name == "cl100k_base"
        ),
        None,
    )
    calls = (
        []
        if encoding is None
        else [
            n
            for n in ast.walk(encoding)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == "load_tiktoken_bpe"
        ]
    )
    require(len(calls) == 1 and len(calls[0].args) == 1, "unsupported_encoding_definition")
    url = ast.literal_eval(calls[0].args[0])
    hashes = [ast.literal_eval(k.value) for k in calls[0].keywords if k.arg == "expected_hash"]
    require(
        url == "https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken"
        and len(hashes) == 1
        and isinstance(hashes[0], str)
        and re.fullmatch("[0-9a-f]{64}", hashes[0]),
        "unsupported_encoding_url_or_hash",
    )
    cache_key = hashlib.sha1(url.encode("utf-8")).hexdigest()
    caches = []
    for directory in CACHE_DIRS:
        item, _ = file_facts(directory / cache_key, 4 * 1024 * 1024)
        item["matches_encoding_hash"] = item.get("sha256") == hashes[0]
        caches.append(item)
    verified = [str(Path(p["path"]).parent) for p in caches if p["matches_encoding_hash"]]
    if not all(bindings.values()):
        result["unresolved"].append("tokenizer_reader_binding_unconfirmed")
    if not verified:
        result["unresolved"].append("readable_cl100k_cache_missing_or_wrong_hash")
    result["tokenizer"] = {
        "reader_ast_bindings": bindings,
        "definition_line": calls[0].lineno,
        "url": url,
        "expected_sha256": hashes[0],
        "url_derived_cache_key": cache_key,
        "cache_files": caches,
        "verified_pin_candidates": verified,
        "ambient_cache_variables_present": {
            name: name in os.environ for name in ("TIKTOKEN_CACHE_DIR", "DATA_GYM_CACHE_DIR")
        },
        "managed_home": "/home/hindsight/.pg0",
        "ambient_temp_directory_evaluated": False,
        "encoding_load_executed": False,
        "interpretation": "Explicit cache pin required; ambient lookup was not evaluated.",
    }


def native_facts():
    text = sources.get("hindsight_api.engine.taki_compatibility")
    constants = {}
    if text is not None:
        for node in ast.parse(text).body:
            if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Constant):
                continue
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in {
                    "TAKI_MEMORY_COMPATIBILITY_VERSION",
                    "TAKI_MEMORY_CONTRACT_VERSION",
                    "TAKI_MEMORY_UPSTREAM_COMMIT",
                    "TAKI_MEMORY_COMPATIBILITY_BUILD",
                }:
                    value = node.value.value
                    require(
                        isinstance(value, str) and re.fullmatch("[A-Za-z0-9_.-]{1,128}", value),
                        "unsupported_build_literal",
                    )
                    constants[target.id] = value
    if constants.get("TAKI_MEMORY_COMPATIBILITY_BUILD") != SOURCE_BUILD:
        result["unresolved"].append("cached_build_differs_or_is_unconfirmed")
    calls = []
    for name in ("hindsight_api.engine.memory_engine", "hindsight_api.engine.token_encoding"):
        for node in ast.walk(ast.parse(sources.get(name, ""))):
            if not isinstance(node, ast.Call):
                continue
            fn = (
                node.func.attr
                if isinstance(node.func, ast.Attribute)
                else getattr(node.func, "id", "")
            )
            if fn == "get_token_encoding" or (
                fn == "get_encoding"
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and node.args[0].value == "cl100k_base"
            ):
                calls.append({"module": name, "line": node.lineno, "call": fn})
    require(len(calls) <= 32, "consumer_call_count_limit")
    if not calls:
        result["unresolved"].append("native_tokenizer_consumption_unconfirmed")
    result["native"] = {
        "observed_source_constants": constants,
        "reviewed_source_build_target": SOURCE_BUILD,
        "tokenizer_call_sites": calls,
        "module_presence_is_not_runtime_validation": True,
    }


def inspect():
    require(
        sys.argv == ["-"] and sys.flags.isolated and sys.flags.dont_write_bytecode,
        "fixed_stdin_entrypoint_required",
    )
    require(os.geteuid() == os.getegid() == 1000, "uid_gid_required")
    require(
        sys.version_info[:2] == (3, 11)
        and sys.executable == "/app/api/.venv/bin/python"
        and Path(sysconfig.get_path("purelib")) == PURELIB,
        "fixed_interpreter_required",
    )
    require(len(sys.path) <= 16 and all(len(p) <= 1024 for p in sys.path), "import_path_limit")
    require(
        all(
            Path(p).is_relative_to(ROOT)
            or p == "/usr/local/lib/python311.zip"
            or Path(p).is_relative_to("/usr/local/lib/python3.11")
            for p in sys.path
        ),
        "import_path_outside_fixed_roots",
    )
    result["runtime"] = {
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "resolved_executable": str(Path(sys.executable).resolve()),
        "uid": os.geteuid(),
        "gid": os.getegid(),
        "purelib": str(PURELIB),
        "import_search_paths": sys.path,
        "resolution": "PathFinder only; no loader execution",
    }
    result["packages"] = [package_facts(name) for name in PACKAGES]
    result["modules"] = [module_facts(name) for name in MODULES]
    tokenizer_facts()
    native_facts()
    pg0, _ = file_facts(PURELIB / "pg0/bin/pg0", 64 * 1024 * 1024)
    pg0["matches_prior_cached_probe_hash"] = pg0.get("sha256") == PG0_HASH
    if not pg0["matches_prior_cached_probe_hash"]:
        result["unresolved"].append("bundled_pg0_missing_or_changed")
    result["database_prerequisite"] = {
        "bundled_pg0": pg0,
        "raw_tools_and_extensions": "Not inspected or executed by this packet.",
        "boundary": "Bundled CLI hash is not raw PG/extension availability.",
    }
    require(
        not any(
            name.split(".")[0]
            in {
                "hindsight_api",
                "tiktoken",
                "tiktoken_ext",
                "openai",
                "uvicorn",
                "fastapi",
                "pg0",
                "psycopg2",
            }
            for name in sys.modules
        ),
        "forbidden_target_import",
    )
    result["inventory_complete"] = True


if __name__ == "__main__":
    try:
        require(sys.platform == "linux", "linux_required")
        signal.signal(signal.SIGALRM, alarm)
        signal.alarm(30)
        inspect()
    except InventoryStop as error:
        result["unresolved"].append(str(error))
    except Exception as error:
        result["unresolved"].append("inventory_incomplete:" + type(error).__name__)
    finally:
        if sys.platform == "linux":
            signal.alarm(0)
    result.update(
        elapsed_seconds=round(time.monotonic() - STARTED, 3),
        read_bytes=read_bytes,
        files_observed=file_count,
    )
    result["status"] = "prerequisite_unresolved" if result["unresolved"] else "inventory_complete"
    encoded = json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode("ascii")
    if len(encoded) + 1 > OUTPUT_LIMIT:
        encoded = (
            b'{"schema":"c2b-cached-image-inventory-v1","status":"prerequisite_unresolved",'
            b'"inventory_complete":false,"deploymentReady":false,"unresolved":["output_limit"]}'
        )
        result["status"] = "prerequisite_unresolved"
    sys.stdout.buffer.write(encoded + b"\n")
    raise SystemExit(0 if result["status"] == "inventory_complete" else 2)
