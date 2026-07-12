import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// 07-12-shell-open-persist-fix — shell-open authorizes per (capability, targetClass); a persisted grant on one class
// (plus a stale pre-fix name-keyed "shell-open" grant) must never reach another. E2E boundary: "the browser/file
// actually opens" is manual check #10 — no request here may reach a real ShellExecute with an openable target, so the
// persisted-memory wiring is pinned with the DENY polarity (never → auto-denied, no dialog); the allow polarity of the
// same code path is pinned by the gate unit tests (shell_open_url_safe_always_* in gate.rs).
describe("shell-open authorizes per target class", () => {
  it("persisted url-safe memory answers without a dialog (never launches)", async () => {
    await withStack(
      {
        devTrigger: true,
        // An allow-everything approver: if a dialog were consulted the request would be ALLOWED and audited
        // allowed-*; auto-denied therefore proves the persisted class-keyed memory answered, not a dialog.
        autoApprove: "allow-always",
        gateDecisions: [
          { capability: "shell-open:url-safe", decision: "never" },
          // The pre-fix leak: a name-keyed Always. It must be inert under the class-keyed gate.
          { capability: "shell-open", decision: "always" },
        ],
      },
      async (stack) => {
        const url = await stack.l1("shell_open", { kind: "url", target: "http://127.0.0.1:9/taki-e2e" });
        expect(url).toMatchObject({ ok: false, code: "DENIED" });
        expect(stack.audit().map((line) => [line.capability, line.decision])).toEqual([
          ["shell-open:url-safe", "auto-denied"], // memory answered — no ask, no launch
        ]);
      },
    );
  });

  it("url-safe Always never authorizes local classes; blocked scheme auto-denies (A1)", async () => {
    await withStack(
      {
        devTrigger: true,
        autoApprove: "deny",
        gateDecisions: [
          // THE A1 setup: a persisted url-safe Always (plus the stale name-keyed grant) sits in memory. No url
          // request is made — it would really launch a browser — so the Always can only leak, never legitimately fire.
          { capability: "shell-open:url-safe", decision: "always" },
          { capability: "shell-open", decision: "always" },
        ],
      },
      async (stack) => {
        // THE A1 kill: with url-safe Always remembered, an executable open still consults the approver → denied.
        const exe = await stack.l1("shell_open", { kind: "path", target: "C:\\Windows\\System32\\cmd.exe" });
        expect(exe).toMatchObject({ ok: false, code: "DENIED" });

        // local-file is asked too (and denied by the script) — the Always never crosses classes.
        const pdf = await stack.l1("shell_open", { kind: "path", target: join(stack.nodeDataDir, "report.pdf") });
        expect(pdf).toMatchObject({ ok: false, code: "DENIED" });

        // blocked scheme: refused before any dialog.
        const js = await stack.l1("shell_open", { kind: "url", target: "javascript:alert(1)" });
        expect(js).toMatchObject({ ok: false, code: "DENIED" });

        expect(stack.audit().map((line) => [line.capability, line.decision])).toEqual([
          ["shell-open:local-exec", "denied"], // `denied` (not auto-denied) proves the gate ASKED despite the Always
          ["shell-open:local-file", "denied"],
          ["shell-open:blocked", "auto-denied"], // no ask at all
        ]);
      },
    );
  });

  it("local-file asks on every request — allowed once each time, never auto-allowed", async () => {
    await withStack(
      { devTrigger: true, autoApprove: "shell-open:local-file=allow-always" },
      async (stack) => {
        // A missing .pdf: the gate allows, the opener fails on the absent file — nothing actually opens. The
        // scripted answer is allow-ALWAYS, the strongest possible leak attempt: it must still not be remembered.
        const target = join(stack.nodeDataDir, "missing-report.pdf");
        for (let i = 0; i < 2; i += 1) {
          const result = await stack.l1("shell_open", { kind: "path", target });
          expect(result).toMatchObject({ ok: false, code: "EXEC_FAILED" }); // gate said yes; the launch failed
        }
        const decisions = stack
          .audit()
          .filter((line) => line.capability === "shell-open:local-file")
          .map((line) => line.decision);
        expect(decisions).toEqual(["allowed-once", "allowed-once"]); // asked BOTH times — the Always was dropped
      },
    );
  });
});
