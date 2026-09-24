# Research index — 09-19-active-bank-lifecycle (Stage 2c, A27 / A31 / A16)

- [`stage2c-seams.md`](./stage2c-seams.md) — current behaviour with exact failures (new Character after activation,
  live config/secret drift, unused `verifiedReconnect`), reusable primitives, gaps G1..G14, failure matrix, proposed
  `bank.provision` / `connection.revalidate` kinds in a fourth exclusive family `hindsight-lifecycle`, the
  `memory.authority.status.hindsight` section, D86/D87/D88 disposition, wave split A/B/C and two owner questions (Q1, Q2).
  Baseline `main` `f1acf9e`, 2026-09-24.
- [`isolated-process-check.mjs`](./isolated-process-check.mjs) — wave B isolated Core boot (temp dir, free non-default
  port, fetch blocked): head 050, authority status on Legacy and Local, both lifecycle kinds refused on Local, clean exit.
