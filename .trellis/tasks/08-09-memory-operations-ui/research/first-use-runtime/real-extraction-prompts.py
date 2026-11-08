"""Finite task-only comparison through real Native extraction; raw facts remain in owned G: evidence."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sys
import time
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit


async def main(root: Path) -> int:
    import httpx
    from hindsight_api.config import HindsightConfig
    from hindsight_api.engine.llm_wrapper import LLMProvider
    from hindsight_api.engine.retain.fact_extraction import extract_facts_from_text, _build_extraction_prompt_and_schema

    logging.basicConfig(level=logging.CRITICAL)
    inputs = json.loads((root / "input.private.json").read_text(encoding="utf-8"))
    base = HindsightConfig.from_env()
    provider = LLMProvider.from_env()
    expected = urlsplit(os.environ["HINDSIGHT_API_LLM_BASE_URL"])
    original_send = httpx.AsyncClient.send
    requests = []

    async def observed_send(client, request, *args, **kwargs):
        if request.url.scheme != "https" or request.url.host != expected.hostname or (request.url.port or 443) != (expected.port or 443):
            raise RuntimeError("EVAL_ENDPOINT_MISMATCH")
        started = time.monotonic()
        item = {"status": None, "seconds": None}
        requests.append(item)
        try:
            response = await original_send(client, request, *args, **kwargs)
            item["status"] = response.status_code
            return response
        except Exception as error:
            item["errorType"] = type(error).__name__
            raise
        finally:
            item["seconds"] = round(time.monotonic() - started, 3)

    httpx.AsyncClient.send = observed_send
    rows = []
    summary = {"status": "in_progress", "semanticStatus": "ungraded", "rows": rows, "requests": requests,
               "method": "hindsight_api.engine.retain.fact_extraction.extract_facts_from_text",
               "model": provider.model, "sourceHashes": inputs["sourceHashes"],
               "limits": ["One sample per case and mission; not reliability acceptance.",
                          "Same current label group for both missions; only retain_mission changes.",
                          "No service, database write, embedding or consolidation; final answers are a separate gate."]}
    private = []
    try:
        for case in inputs["cases"]:
            for revision in inputs["revisions"]:
                template = next(t for t in inputs["templates"] if t["revision"] == revision and t["scope"] == case["scope"])
                config = replace(base, retain_mission=template["config"]["retain_mission"], entity_labels=[template["labelGroup"]])
                prompt, _schema = _build_extraction_prompt_and_schema(config)
                row = {"case": case["id"], "revision": revision, "source": case["source"], "status": "running",
                       "missionSha256": hashlib.sha256(config.retain_mission.encode()).hexdigest(),
                       "systemSha256": hashlib.sha256(prompt.encode()).hexdigest(),
                       "extractionMode": config.retain_extraction_mode, "causalLinks": config.retain_extract_causal_links,
                       "temperature": config.llm_temperature_retain, "requestStartIndex": len(requests)}
                rows.append(row)
                started = time.monotonic()
                try:
                    facts, chunks, usage = await asyncio.wait_for(extract_facts_from_text(
                        text=case["content"], event_date=datetime.fromisoformat(case["eventDate"].replace("Z", "+00:00")),
                        llm_config=provider, agent_name="Taki", config=config, context=case["context"], metadata={}), timeout=240)
                    row.update(status="evaluated", factCount=len(facts), chunks=len(chunks),
                               usage={key: getattr(usage, key, None) for key in ("input_tokens", "output_tokens", "total_tokens")})
                    private.append({"case": case["id"], "revision": revision, "facts": [fact.model_dump(mode="json") for fact in facts]})
                except Exception as error:
                    row.update(status="failed", errorType=type(error).__name__)
                finally:
                    row.update(seconds=round(time.monotonic() - started, 3), requestEndIndex=len(requests))
                    (root / "facts.private.json").write_text(json.dumps(private, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    (root / "result.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
                    print(f"[extraction-prompts] {case['id']} {revision}: {row['status']}", flush=True)
                if row["status"] == "failed":
                    summary["status"] = "failed"
                    return 1
        summary["status"] = "evaluated"
        return 0
    finally:
        await provider.cleanup()
        httpx.AsyncClient.send = original_send
        (root / "result.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main(Path(sys.argv[1]).resolve())))
    except Exception as error:
        print(f"[extraction-prompts] failed: {type(error).__name__}; no semantic acceptance", flush=True)
        sys.exit(1)
