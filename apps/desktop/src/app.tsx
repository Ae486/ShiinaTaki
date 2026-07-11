import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Minimal status + pairing panel (prd ruling 13): the Rust node emits `taki://status`; on
 * `pairing-required` the user enters the code shown in the core console, which is forwarded to
 * the WS handshake via the submit_pairing_code command. The real Pet UI arrives in M4.
 */
type Status = "connecting" | "pairing-required" | "connected" | "disconnected";

const LABELS: Record<Status, string> = {
  connecting: "Connecting to the agent core…",
  "pairing-required": "Pairing required",
  connected: "Connected",
  disconnected: "Disconnected — retrying…",
};

export function App() {
  const [status, setStatus] = useState<Status>("connecting");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ state: Status }>("taki://status", (event) => setStatus(event.payload.state)).then((dispose) => {
      unlisten = dispose;
      // Seed once the listener is live: the Rust node may have emitted `pairing-required` before we attached, and
      // Tauri does not buffer those events — without this the panel hangs on the default "connecting".
      void invoke<Status>("get_status").then(setStatus).catch(() => undefined);
    });
    return () => unlisten?.();
  }, []);

  async function submit() {
    try {
      await invoke("submit_pairing_code", { code });
      setCode("");
      setError("");
    } catch (cause) {
      setError(String(cause));
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">TakiAgent</h1>
      <p className={status === "connected" ? "text-green-600" : "text-slate-500"}>{LABELS[status]}</p>

      {status === "pairing-required" && (
        <div className="flex flex-col items-center gap-2">
          <input
            className="rounded border border-slate-300 px-3 py-2 text-center"
            placeholder="Pairing code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button
            type="button"
            onClick={submit}
            disabled={code.length === 0}
            className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
          >
            Pair
          </button>
          {error && <p className="text-red-600">{error}</p>}
        </div>
      )}
    </main>
  );
}
