"""Offline pure Native codec/row preparation timings; no PG, HTTP, engine or real model."""
from __future__ import annotations

import asyncio
from collections import Counter
import hashlib
import json
from pathlib import Path
import socket
import sqlite3
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[4]
INPUT = ROOT / ".trellis/.runtime/w5-reentry-candidate-timeout-500a3683cc5d45e8ab52f92beb7f2205"
NATIVE = Path("H:/hindsight/hindsight-api-slim")
sys.path.insert(0, str(NATIVE))
OUTPUT = ROOT / ".trellis/.runtime" / f"w5-candidate-native-codec-{uuid.uuid4().hex}"
OUTPUT.mkdir()
report = {"meaning": "Pure codec and row preparation only; synthetic embedding vectors, no Native DB or HTTP.",
          "input": str(INPUT), "networkAttempts": 0, "modelCalls": 0, "events": []}


def refuse_network(*args, **kwargs):
    report["networkAttempts"] += 1
    raise RuntimeError("OFFLINE_DIAGNOSTIC_NETWORK_REFUSED")


def checked_inputs() -> bool:
    manifest = json.loads((INPUT / "copy-manifest.json").read_bytes())
    for name, expected in manifest["files"].items():
        data = (INPUT / name).read_bytes()
        assert len(data) == expected["bytes"] and hashlib.sha256(data).hexdigest() == expected["sha256"]
    return True


async def main():
    # Windows creates a private socketpair when constructing the event loop. Install
    # the refusal only after that internal pipe exists; every diagnostic import/call
    # below is still prohibited from connecting to any external or local service.
    socket.socket.connect = refuse_network
    socket.create_connection = refuse_network
    from hindsight_api.engine.transfer.transition_delta_models import TakiTransitionDeltaRequest, transition_delta_hash
    from hindsight_api.engine.transfer.current_state_rows import prepare_current_state_rows
    from hindsight_api.engine.retain import embedding_processing

    async def synthetic_vectors(_model, texts):
        report.setdefault("syntheticEmbeddingBatches", []).append(len(texts))
        return [[1.0, 0.0, 0.0] for _text in texts]

    checked_inputs()
    conn = sqlite3.connect((INPUT / "application.sqlite").resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        row = conn.execute("SELECT body FROM memory_transition_preparations WHERE transition_id=?",
                           ("6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53",)).fetchone()
        preparation = json.loads(row[0])
    finally:
        conn.close()
    bank = preparation["scope"]["nativeBankId"]
    for ordinal in range(3):
        started = time.perf_counter()
        request = TakiTransitionDeltaRequest.model_validate(preparation["request"])
        parsed = time.perf_counter()
        assert transition_delta_hash(bank, request) == request.request_hash
        signed = time.perf_counter()
        embedding_processing.generate_embeddings_batch = synthetic_vectors
        prepared = await prepare_current_state_rows(request=request.rows, embeddings_model=None,
                                                   format_date_fn=lambda stamp: stamp.isoformat())
        finished = time.perf_counter()
        report["events"].append({"ordinal": ordinal, "parseMs": (parsed-started)*1000,
                                 "hashMs": (signed-parsed)*1000, "prepareWithSyntheticVectorsMs": (finished-signed)*1000,
                                 "facts": len(prepared.facts), "mentalModels": len(prepared.model_embeddings)})
    report["preparation"] = {"id": preparation["preparationId"], "requestHash": request.request_hash,
        "native": dict(Counter(item.disposition for item in request.native)),
        "application": dict(Counter(item.disposition for item in request.application)),
        "applicationBodies": dict(Counter(item.body.root.artifact_kind for item in request.application if item.body))}
    report["inputPreserved"] = checked_inputs()
    assert report["networkAttempts"] == 0


try:
    asyncio.run(main())
except Exception as error:
    report["error"] = type(error).__name__
    raise
finally:
    path = OUTPUT / "result.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"result": str(path), "events": report["events"], "error": report.get("error")}))
