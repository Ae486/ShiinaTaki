import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Scaffold Hello World that also proves the frontend↔Rust IPC link: clicking
 * the button invokes the Rust `ping` command and shows its reply. Replaced by
 * the real Pet UI in M4.
 */
export function App() {
  const [reply, setReply] = useState<string>("");

  async function checkIpc() {
    const result = await invoke<string>("ping", { nonce: "hello" });
    setReply(result);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">TakiAgent</h1>
      <button
        type="button"
        onClick={checkIpc}
        className="rounded bg-slate-800 px-4 py-2 text-white"
      >
        Check IPC
      </button>
      {reply && <p className="text-green-600">{reply}</p>}
    </main>
  );
}
