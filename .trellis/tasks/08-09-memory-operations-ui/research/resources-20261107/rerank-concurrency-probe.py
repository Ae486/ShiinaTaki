"""Leader-only: does concurrent local reranking (Native allows 4 at once) raise memory in steps, as the journey samples suggest?"""
import ctypes
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from ctypes import wintypes

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", PYTHONDONTWRITEBYTECODE="1")


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


from sentence_transformers import CrossEncoder  # noqa: E402

reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", device="cpu")
print(json.dumps({"at": "loaded", **memory()}), flush=True)
BASE = ("The user said they keep a copper compass in the isolated roundtrip and mentioned it during a conversation about "
        "long walks, weather and the small routines that make a trip feel familiar. ")
length = int(sys.argv[1]) if len(sys.argv) > 1 else 1500
pairs = [("What does the user keep in their isolated roundtrip?", (f"Note {i}. " + BASE * (length // len(BASE) + 1))[:length]) for i in range(46)]
for workers in (1, 2, 3, 4):
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for round_number in range(3):
            started = time.perf_counter()
            list(pool.map(lambda _: reranker.predict(pairs, batch_size=32, show_progress_bar=False), range(workers)))
            print(json.dumps({"at": "concurrent", "workers": workers, "round": round_number,
                              "seconds": round(time.perf_counter() - started, 2), **memory()}), flush=True)
