"""Compare scoped ty diagnostics against hash-verified pre-billing source copies."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import uuid


RESEARCH = Path(__file__).resolve().parent
NATIVE = Path("H:/hindsight")
OWNED = RESEARCH.parents[2] / ".runtime" / f"w5-billing-types-{uuid.uuid4().hex}"
PATHS = json.loads((RESEARCH / "w5-native-billing-prior-hashes.json").read_text(encoding="utf-8"))


def preimage(relative: str) -> bytes:
    text = (NATIVE / relative).read_text(encoding="utf-8")
    if relative.endswith("llm_interface.py"):
        text = text[: text.index("\n\nclass ProviderBillingError")].rstrip() + "\n"
    elif relative.endswith("openai_compatible_llm.py"):
        text = text.replace("    ProviderBillingError,\n", "", 1)
        text = text.replace(
            "                # A confirmed billing refusal cannot recover through backoff or a smaller prompt.\n"
            "                # Preserve its distinct type so consolidation also stops its outer retry/subdivision.\n"
            "                if e.status_code == 402:\n"
            "                    raise ProviderBillingError() from None\n"
            "                # Authentication failures retain their existing provider exception.\n",
            "                # Fast fail only on 401 (unauthorized) and 403 (forbidden)\n",
            1,
        )
        text = text.replace(
            "                if e.status_code == 402:\n                    raise ProviderBillingError() from None\n", "", 1
        )
    else:
        text = text.replace("from ..llm_interface import ProviderBillingError\n", "", 1)
        text = text.replace(
            "        except ProviderBillingError:\n"
            "            # Smaller batches cannot repair a factual billing refusal. Let the owning maintenance\n"
            "            # attempt preserve its committed actions and become incomplete, without a failed-plan retry.\n"
            "            raise\n", "", 1
        )
    expected = next(row["sha256"] for row in PATHS if row["path"] == relative)
    for newline in ("\n", "\r\n"):
        data = text.replace("\n", newline).encode("utf-8")
        if hashlib.sha256(data).hexdigest() == expected:
            return data
    raise AssertionError(f"Preimage hash mismatch: {relative}")


def check(root: Path, label: str) -> dict:
    command = [str(NATIVE / ".venv/Scripts/ty.exe"), "check", "--project", str(NATIVE),
               "--python", str(NATIVE / ".venv/Scripts/python.exe"),
               "--extra-search-path", str(root / "hindsight-api-slim"), "--output-format", "gitlab"]
    command.extend(str(root / row["path"]) for row in PATHS)
    result = subprocess.run(command, cwd=NATIVE, capture_output=True, text=True, encoding="utf-8", check=False)
    (OWNED / f"{label}.stdout.json").write_text(result.stdout, encoding="utf-8")
    (OWNED / f"{label}.stderr.txt").write_text(result.stderr, encoding="utf-8")
    findings = json.loads(result.stdout)
    normalized = []
    for finding in findings:
        path = Path(finding["location"]["path"])
        path = path if path.is_absolute() else NATIVE / path
        relative = path.relative_to(root).as_posix()
        position = finding["location"]["positions"]
        lines = path.read_text(encoding="utf-8").splitlines()
        # Match the exact highlighted source, columns and message, allowing only inserted-line offsets.
        source = "\n".join(lines[position["begin"]["line"] - 1:position["end"]["line"]])
        normalized.append((relative, finding["description"], finding["severity"],
                           position["begin"]["column"], position["end"]["column"], source))
    return {"exitCode": result.returncode, "count": len(findings), "normalized": sorted(normalized)}


def main() -> None:
    OWNED.mkdir(parents=True, exist_ok=False)
    baseline = OWNED / "baseline"
    shutil.copytree(NATIVE / "hindsight-api-slim/hindsight_api", baseline / "hindsight-api-slim/hindsight_api",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for row in PATHS:
        (baseline / row["path"]).write_bytes(preimage(row["path"]))
    before = check(baseline, "baseline")
    after = check(NATIVE, "current")
    equivalent = before["normalized"] == after["normalized"]
    report = {"ownedPath": str(OWNED), "preimageHashesVerified": PATHS,
              "baselineExit": before["exitCode"], "baselineDiagnostics": before["count"],
              "currentExit": after["exitCode"], "currentDiagnostics": after["count"],
              "sameDiagnosticsOnExactSource": equivalent, "realModelRequests": 0}
    (OWNED / "result.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))
    if not equivalent:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
