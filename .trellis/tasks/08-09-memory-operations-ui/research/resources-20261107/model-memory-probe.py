"""Leader-only: what the local models cost Native, separate from the rest of the process.

Offline; reads the existing Hugging Face cache; starts no server and writes nothing outside this process's stdout.
"""
import ctypes
import json
import os
import sys
import time
from ctypes import wintypes

os.environ.update(
    HF_HUB_OFFLINE="1",
    TRANSFORMERS_OFFLINE="1",
    PYTHONDONTWRITEBYTECODE="1",
    PYTHON_DOTENV_DISABLED="1",
    LITELLM_LOCAL_MODEL_COST_MAP="True",
    HINDSIGHT_API_EMBEDDINGS_PROVIDER="tei",
    HINDSIGHT_API_EMBEDDINGS_TEI_URL="http://127.0.0.1:9",
    HINDSIGHT_API_RERANKER_PROVIDER="rrf",
    HINDSIGHT_API_LLM_PROVIDER="mock",
)


class Counters(ctypes.Structure):
    _fields_ = [(n, ctypes.c_size_t if n != "cb" and n != "PageFaultCount" else wintypes.DWORD) for n in (
        "cb", "PageFaultCount", "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
        "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]


kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.GetCurrentProcess.restype = wintypes.HANDLE
psapi = ctypes.WinDLL("psapi", use_last_error=True)
psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]


def memory():
    c = Counters()
    c.cb = ctypes.sizeof(c)
    assert psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(c), c.cb)
    return {"wsMB": c.WorkingSetSize >> 20, "peakWsMB": c.PeakWorkingSetSize >> 20, "privateMB": c.PrivateUsage >> 20}


def report(label, **extra):
    print(json.dumps({"at": label, **memory(), **extra}), flush=True)


report("interpreter")
started = time.perf_counter()
import hindsight_api.main  # noqa: E402,F401  (the same module graph the launcher imports; main() is not called)

report("native-modules-no-models", seconds=round(time.perf_counter() - started, 1),
       torch="torch" in sys.modules, transformers="transformers" in sys.modules,
       sentence_transformers="sentence_transformers" in sys.modules, onnxruntime="onnxruntime" in sys.modules)

started = time.perf_counter()
import torch  # noqa: E402
from sentence_transformers import CrossEncoder, SentenceTransformer  # noqa: E402

report("torch-and-sentence-transformers", seconds=round(time.perf_counter() - started, 1))
started = time.perf_counter()
embedder = SentenceTransformer("BAAI/bge-small-en-v1.5", device="cpu")
report("embedding-model-loaded", seconds=round(time.perf_counter() - started, 1))
started = time.perf_counter()
reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", device="cpu")
report("reranker-loaded", seconds=round(time.perf_counter() - started, 1))

QUERY = "What does the user keep in their isolated roundtrip and where did they mention it?"
BASE = ("The user said they keep a copper compass in the isolated roundtrip and mentioned it during a conversation about "
        "long walks, weather and the small routines that make a trip feel familiar. ")


def documents(count, length):
    return [(f"Note {i}. " + BASE * (length // len(BASE) + 1))[:length] for i in range(count)]


def rerank(count, length, repeat=3):
    pairs = [(QUERY, doc) for doc in documents(count, length)]
    times = []
    for _ in range(repeat):
        started = time.perf_counter()
        reranker.predict(pairs, batch_size=32, show_progress_bar=False)
        times.append(time.perf_counter() - started)
    return round(min(times), 3), round(sorted(times)[len(times) // 2], 3)


def embed(texts, repeat=5):
    times = []
    for _ in range(repeat):
        started = time.perf_counter()
        embedder.encode(texts, show_progress_bar=False, convert_to_numpy=True, normalize_embeddings=True)
        times.append(time.perf_counter() - started)
    return round(min(times), 3), round(sorted(times)[len(times) // 2], 3)


default_threads = torch.get_num_threads()
for threads in (default_threads, 4, 2, 1):
    torch.set_num_threads(threads)
    row = {"threads": threads,
           "queryEmbed_minMed": embed([QUERY]),
           "embed32docs_minMed": embed(documents(32, 300), repeat=3),
           "rerank22x300chars_minMed": rerank(22, 300),
           "rerank46x300chars_minMed": rerank(46, 300),
           "rerank46x1500chars_minMed": rerank(46, 1500)}
    report("timing", **row)
report("final")
