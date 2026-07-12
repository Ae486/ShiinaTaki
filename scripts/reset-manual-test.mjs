#!/usr/bin/env node
/**
 * INPUT:  interactive y/N answers; env TAKI_DATA_DIR (core state root) + APPDATA (Shell state root)
 * OUTPUT: selectively wipes core + Shell state so a manual test starts from a known-clean slate
 * POS:    scripts — DEV-ONLY manual-test reset helper; not shipped, never imported by app code.
 *         Run it with BOTH core and Shell stopped (taki.db is locked while core runs).
 */
import { connect } from "node:net";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CORE_DIR = process.env.TAKI_DATA_DIR ?? join(homedir(), ".takiagent");
const SHELL_DIR = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "cc.shiinataki.app");
const CORE_PORT = 8974; // DEFAULT_WS_PORT — probed only to warn that files are locked.

// Each step is one y/N question over a set of paths. `why` states what the wipe controls, so a tester
// knows which variable they are eliminating (context, memory, persisted grants, ...).
const STEPS = [
  {
    title: "对话数据 (taki.db + WAL)",
    why: "清空 continuous timeline 的全部对话历史 —— 排除“已有上下文”导致的偷懒/幻觉",
    paths: [join(CORE_DIR, "taki.db"), join(CORE_DIR, "taki.db-shm"), join(CORE_DIR, "taki.db-wal")],
  },
  {
    title: "长期记忆 (workspace/memory)",
    why: "清空 auto-memory 的 episodic/global 记忆 —— agent 可能靠它“想起”自己截过图",
    paths: [join(CORE_DIR, "workspace", "memory")],
  },
  {
    title: "截图落盘 (workspace/screenshots)",
    why: "清空旧截图 —— 便于确认本轮是否真的产出了新 PNG（而非幻觉）",
    paths: [join(CORE_DIR, "workspace", "screenshots")],
  },
  {
    title: "持久授权决定 (gate-decisions.json)",
    why: "清除 Always/Never 记忆，回到每次弹窗（当前多半不存在，会自动跳过）",
    paths: [join(SHELL_DIR, "gate-decisions.json")],
  },
  {
    title: "审计日志 (audit.jsonl)",
    why: "清空 gate 决定审计 —— 每轮从零观察哪次能力真的过了门",
    paths: [join(SHELL_DIR, "audit.jsonl")],
  },
  {
    title: "重置配对 [重] (core devices.json + cli-device.json)",
    why: "删除后 core 会忘记已配对设备，Shell/CLI 需重新配对；Shell 的 token 还在凭据管理器（见结尾提示）",
    paths: [join(CORE_DIR, "devices.json"), join(CORE_DIR, "cli-device.json")],
    pairing: true,
  },
];

function describe(path) {
  if (!existsSync(path)) return `${path}  — 不存在，跳过`;
  const stat = statSync(path);
  if (stat.isDirectory()) return `${path}\\  — 目录（${readdirSync(path).length} 项，将清空内容、保留目录）`;
  return `${path}  — 文件（${stat.size} 字节）`;
}

// Directories are emptied but kept (core assumes they exist on boot); files are removed outright.
function wipe(path) {
  if (!existsSync(path)) return "跳过（不存在）";
  if (statSync(path).isDirectory()) {
    const entries = readdirSync(path);
    for (const entry of entries) rmSync(join(path, entry), { recursive: true, force: true });
    return `已清空 ${entries.length} 项`;
  }
  rmSync(path, { force: true });
  return "已删除";
}

function probe(port) {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.setTimeout(400);
    socket.on("connect", () => (socket.destroy(), resolve(true)));
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => (socket.destroy(), resolve(false)));
  });
}

// A stdin line reader that resolves under BOTH a real TTY and a piped/redirected stdin (readline/promises'
// question() hangs on the latter after EOF). After EOF every further prompt resolves to null -> treated as "no".
const queue = [];
const waiters = [];
let closed = false;
let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += chunk;
  let nl;
  while ((nl = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, nl).replace(/\r$/, "");
    pending = pending.slice(nl + 1);
    if (waiters.length) waiters.shift()(line);
    else queue.push(line);
  }
});
process.stdin.on("end", () => {
  closed = true;
  while (waiters.length) waiters.shift()(null);
});
function readLine() {
  if (queue.length) return Promise.resolve(queue.shift());
  if (closed) return Promise.resolve(null);
  return new Promise((resolve) => waiters.push(resolve));
}
async function ask(question) {
  process.stdout.write(`${question} [y/N] `);
  const line = await readLine();
  return (line ?? "").trim().toLowerCase() === "y";
}

async function main() {
  console.log("=== TakiAgent 手测重置 ===");
  console.log(`core 状态根 : ${CORE_DIR}`);
  console.log(`Shell 状态根: ${SHELL_DIR}`);
  console.log("注意：session（This session）授权是内存态，结束 Shell 进程即清空，本脚本不涉及。\n");

  if (await probe(CORE_PORT)) {
    console.log(`⚠ 端口 ${CORE_PORT} 有响应 —— core 似乎在运行，taki.db 被占用会删除失败。`);
    if (!(await ask("仍然继续？"))) return;
    console.log("");
  }

  let done = 0;
  let resetPairing = false;
  for (const step of STEPS) {
    console.log(`— ${step.title}`);
    console.log(`  作用：${step.why}`);
    for (const path of step.paths) console.log(`  ${describe(path)}`);
    if (await ask("  执行？")) {
      if (step.pairing) resetPairing = true;
      for (const path of step.paths) {
        try {
          console.log(`  → ${path}: ${wipe(path)}`);
          done += 1;
        } catch (error) {
          console.log(`  → ${path}: 失败（${error.code ?? error.message}）——若是占用错误，请先关闭 core/Shell`);
        }
      }
    } else {
      console.log("  已跳过");
    }
    console.log("");
  }

  if (resetPairing) {
    console.log("重置了配对：Shell 的 device token 在 Windows 凭据管理器，需手动清：");
    console.log("  cmdkey /list | findstr /i taki      （查看条目）");
    console.log("  cmdkey /delete:<上面列出的目标名>   （逐条删除）\n");
  }

  console.log(`完成，共处理 ${done} 个目标。下一步：重启 core → 启 Shell → 开始手测。`);
}

main()
  .catch((error) => {
    console.error(`脚本出错：${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => process.stdin.pause());
