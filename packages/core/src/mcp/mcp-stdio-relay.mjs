/**
 * INPUT:  portable MCP stdio command/args from mcp-stdio-launch plus inherited env/cwd/stdin
 * OUTPUT: transparent stdin/stdout relay to a cross-platform child process with bounded signal forwarding
 * POS:    Windows-only MCP spawn adapter; it emits no protocol data of its own
 */
import crossSpawn from "cross-spawn";
import process from "node:process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  process.stderr.write("MCP stdio relay requires a command\n");
  process.exit(1);
}

const child = crossSpawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"],
  windowsHide: true,
});

process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);

let forcedExit;
function forwardTermination() {
  if (!child.killed) child.kill("SIGTERM");
  forcedExit ??= globalThis.setTimeout(() => process.exit(1), 1_000);
}

process.once("SIGINT", forwardTermination);
process.once("SIGTERM", forwardTermination);
child.once("error", () => {
  process.stderr.write("MCP stdio child failed to start\n");
  process.exit(1);
});
child.once("close", (code) => {
  if (forcedExit) globalThis.clearTimeout(forcedExit);
  process.exit(code ?? 1);
});
