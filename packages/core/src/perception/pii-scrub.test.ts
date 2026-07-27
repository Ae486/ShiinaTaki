import { describe, expect, it } from "vitest";
import { scrubPii } from "./pii-scrub.ts";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0" +
  ".TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ";

const PRIVATE_KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEpAIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

describe("scrubPii — one class per case", () => {
  it("masks vendor-prefixed secrets, keeping only head/tail", () => {
    const out = scrubPii("openai sk-abcd1234EFGH5678ijkl and gh: ghp_ABCDEFGHIJKLMNOPQRST");
    expect(out).toBe("openai sk-a...ijkl and gh: ghp_...QRST");
  });

  it("masks an AWS access key id (fixed-length prefix class)", () => {
    expect(scrubPii("key AKIAIOSFODNN7EXAMPLE done")).toBe("key AKIA...MPLE done");
  });

  it("masks a JWT (header.payload.signature)", () => {
    const out = scrubPii(`token=${JWT}`);
    expect(out).toBe("token=eyJh...7HgQ");
    expect(out).not.toContain("eyJzdWIi");
  });

  it("replaces a whole PEM private-key block", () => {
    expect(scrubPii(`before\n${PRIVATE_KEY}\nafter`)).toBe("before\n[redacted:private-key]\nafter");
  });

  it("masks the password of a DB/URL credential without losing the endpoint", () => {
    const out = scrubPii("DSN postgres://svc_user:hunter2long@db.internal:5432/app");
    expect(out).toBe("DSN postgres://svc_user:***@db.internal:5432/app");
  });

  it("masks a bare credential in URL userinfo", () => {
    const out = scrubPii("git remote https://averylongopaquetoken@example.com/x.git");
    expect(out).toBe("git remote https://***@example.com/x.git");
  });

  it("replaces an email address", () => {
    expect(scrubPii("mail alice.smith+tag@example.co.uk now")).toBe("mail [redacted:email] now");
  });

  it("leaves a user@host target alone — an ssh login is not an address", () => {
    expect(scrubPii("ssh user@10.0.0.5 - Windows Terminal")).toBe("ssh user@10.0.0.5 - Windows Terminal");
  });

  it("masks an E.164 phone number, keeping the country code and last 4", () => {
    expect(scrubPii("call +8613800138000 today")).toBe("call +861****8000 today");
  });

  it("replaces a credit-card number that passes Luhn, in both printed shapes", () => {
    expect(scrubPii("card 4111 1111 1111 1111 ok")).toBe("card [redacted:card] ok");
    expect(scrubPii("card 4242424242424242 ok")).toBe("card [redacted:card] ok");
  });

  it("leaves a Luhn-INVALID number verbatim — order ids and timestamps must survive", () => {
    expect(scrubPii("ref 4111 1111 1111 1112 ok")).toBe("ref 4111 1111 1111 1112 ok");
    expect(scrubPii("build 1234567890123 ok")).toBe("build 1234567890123 ok");
  });

  it("replaces an IBAN that passes mod-97, contiguous or grouped", () => {
    expect(scrubPii("iban GB82WEST12345698765432 ok")).toBe("iban [redacted:iban] ok");
    expect(scrubPii("iban GB82 WEST 1234 5698 7654 32 ok")).toBe("iban [redacted:iban] ok");
  });

  it("leaves an IBAN-shaped token that fails mod-97 verbatim", () => {
    expect(scrubPii("sku GB82WEST12345698765433 ok")).toBe("sku GB82WEST12345698765433 ok");
  });

  it("scrubs every class in one pass over a realistic sensed line", () => {
    const out = scrubPii("Mail to bob@corp.io about card 4111111111111111 — key sk-abcd1234EFGH5678ijkl");
    expect(out).toBe("Mail to [redacted:email] about card [redacted:card] — key sk-a...ijkl");
  });
});

describe("scrubPii — non-PII text", () => {
  it("passes ordinary window titles through byte-identical", () => {
    for (const title of [
      "main.ts — TakiAgent - Visual Studio Code",
      "工资表.xlsx - Excel",
      "Inbox (12) - Thunderbird",
      "docs/index.md at main · taki/agent — Chrome",
      "build 42 passed in 3m 12s",
    ]) {
      expect(scrubPii(title)).toBe(title);
    }
  });

  it("returns the empty string untouched", () => {
    expect(scrubPii("")).toBe("");
  });
});

describe("scrubPii — pathological input", () => {
  it("completes fast on a long adversarial string (bounded patterns, no catastrophic backtracking)", () => {
    const adversarial = [
      "sk-".repeat(2000),
      "eyJ".repeat(2000),
      "-----BEGIN RSA PRIVATE KEY-----".repeat(200), // never terminated
      "1".repeat(20_000),
      "a@".repeat(5000),
      "https://".repeat(2000),
      "GB82".repeat(2000),
      `${"4".repeat(19)} `.repeat(1000),
    ].join(" ");
    const started = performance.now();
    scrubPii(adversarial);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
