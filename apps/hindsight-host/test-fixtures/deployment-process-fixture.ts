/**
 * INPUT:  marked fake data, existing Python runtime and real resident requests
 * OUTPUT: finite substituted engine retaining a real Native owner/child across helper replacement
 * POS:    hindsight-host/tests — private IPC fixtures only; never contacts a Docker daemon
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";
import { DeploymentPlanV1Schema, BootstrapOwnerRequestV1Schema, NativeBootstrapStatusSchema,
  DeploymentResidentReplySchema, type DeploymentInvocation, type DeploymentStatusV1, type InjectionCheckpointV1,
  type InjectionCheckpointResult, type NativeBootstrapStatus, type DeploymentPlanV1 } from "@taki/shared/hindsight-deployment";
import { packet, resourceNames, resourceLabels, type OwnedInspection, type DeploymentDockerAdapter } from "../src/docker-adapter.ts";
import type { DeploymentFixture } from "../src/deployment-test-fixtures.ts";

/** A finite frame reader shared by the fixture's two private pipe boundaries. */
class Frames {
  private bytes = Buffer.alloc(0);
  private readonly values: Buffer[] = [];
  private waiter?: { resolve(value: Buffer): void; reject(error: Error): void };
  private failure?: Error;
  constructor(stream: Readable, limit = 32 * 1024) {
    stream.on("data", (chunk: Buffer) => {
      this.bytes = Buffer.concat([this.bytes, chunk]);
      while (this.bytes.length >= 4) {
        const size = this.bytes.readUInt32LE();
        if (size > limit || this.values.length >= 64) { this.fail(); return; }
        if (this.bytes.length < size + 4) break;
        const value = this.bytes.subarray(4, size + 4);
        this.bytes = this.bytes.subarray(size + 4);
        if (this.waiter) { this.waiter.resolve(value); this.waiter = undefined; }
        else this.values.push(value);
      }
    });
    stream.once("end", () => this.fail());
    stream.once("error", () => this.fail());
  }
  read(): Promise<Buffer> {
    const value = this.values.shift();
    if (value) return Promise.resolve(value);
    if (this.failure || this.waiter) return Promise.reject(this.failure ?? new Error("concurrent fixture read"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiter = undefined; reject(new Error("fixture read deadline")); }, 10_000);
      this.waiter = { resolve: (result) => { clearTimeout(timer); resolve(result); }, reject: (error) => { clearTimeout(timer); reject(error); } };
    });
  }
  private fail(): void {
    this.failure = new Error("fixture pipe closed");
    this.waiter?.reject(this.failure); this.waiter = undefined;
  }
}

class NativeProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<void>;
  readonly logs: string[] = [];
  private readonly frames: Frames;
  private constructor(root: string, digest: string) {
    const nativeRoot = process.env.TAKI_C2A_NATIVE_ROOT ?? "H:/hindsight";
    const python = process.env.TAKI_C2A_PYTHON ?? join(nativeRoot, ".venv", "Scripts", "python.exe");
    this.child = spawn(python, ["-I", "-B", join(nativeRoot, "docker", "standalone", "tests", "fixtures", "c2a_pipe_owner.py"), root, digest], {
      cwd: root, env: { SystemRoot: process.env.SystemRoot, PYTHON_DOTENV_DISABLED: "true" },
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    this.exited = new Promise((resolve) => this.child.once("close", () => resolve()));
    this.frames = new Frames(this.child.stdout!, 16 * 1024);
    this.child.stderr!.on("data", (value: Buffer) => this.logs.push(value.toString()));
  }
  static async start(root: string, digest: string): Promise<NativeProcess> {
    const process = new NativeProcess(root, digest);
    try { await process.status(); return process; }
    catch (error) { process.child.kill(); await process.exited; throw error; }
  }
  private async status(): Promise<NativeBootstrapStatus> {
    return NativeBootstrapStatusSchema.parse(JSON.parse((await this.frames.read()).toString("utf8")));
  }
  async exchange(kind: 1 | 2 | 3, bytes = Buffer.alloc(0)): Promise<NativeBootstrapStatus> {
    this.child.stdin!.write(packet(Buffer.concat([Buffer.from([kind]), bytes])));
    return this.status();
  }
  async close(): Promise<void> {
    if (this.child.exitCode === null) {
      try { await this.exchange(3); } finally { this.child.stdin!.end(); }
    }
    await this.exited;
  }
}

export type EngineMethod = keyof DeploymentDockerAdapter;
export type EngineBoundary = "createVolume" | "createContainer" | "startContainer" | "authorize" | "submit";
export class FakeDeploymentEngine {
  readonly fixture: DeploymentFixture;
  readonly counts = { createVolume: 0, createContainer: 0, startContainer: 0, authorize: 0, submit: 0, submitBytes: 0, status: 0 };
  readonly containerId = randomBytes(32).toString("hex");
  readonly pids: number[] = [];
  private native?: NativeProcess;
  private plan?: DeploymentPlanV1;
  private volume: OwnedInspection["volume"] = null;
  private container = false;
  constructor(fixture: DeploymentFixture) { this.fixture = fixture; }
  async handle(method: EngineMethod, args: unknown[]): Promise<unknown> {
    switch (method) {
      case "inspectEngine": case "inspectImage": return;
      case "inspectOwned": {
        const plan = DeploymentPlanV1Schema.parse(args[0]);
        if (this.plan && this.plan.deploymentId !== plan.deploymentId) throw new Error("fixture ownership conflict");
        return { volume: this.volume, container: this.container ? { id: this.containerId, running: !!this.native } : null };
      }
      case "createVolume": {
        if (this.volume) throw new Error("fixture duplicate volume");
        this.plan = DeploymentPlanV1Schema.parse(args[0]);
        this.volume = { name: resourceNames(this.plan).volume, driver: "local", labels: resourceLabels(this.plan, "data") };
        this.counts.createVolume++; return;
      }
      case "createContainer":
        if (!this.volume || this.container) throw new Error("fixture duplicate container");
        this.container = true; this.counts.createContainer++; return;
      case "startContainer":
        this.requireContainer(args[0]);
        if (this.native || !this.plan) throw new Error("fixture duplicate start");
        this.counts.startContainer++;
        this.native = await NativeProcess.start(join(this.fixture.root, "native"), this.plan.configurationDigest); return;
      case "control": {
        this.requireContainer(args[0]);
        const request = BootstrapOwnerRequestV1Schema.parse(args[1]);
        this.counts[request.action === "authorize" ? "authorize" : "status"]++;
        return this.requireNative().exchange(1, Buffer.from(JSON.stringify(request)));
      }
      case "submit": {
        this.requireContainer(args[0]);
        if (!(args[1] instanceof Uint8Array)) throw new Error("fixture private bytes required");
        this.counts.submit++; this.counts.submitBytes += args[1].length;
        const status = await this.requireNative().exchange(2, Buffer.from(args[1]));
        if (status.state === "running") this.pids.push(this.marker().pid);
        return status;
      }
    }
  }
  marker(): { pid: number; startupId: string; state: string } {
    return JSON.parse(readFileSync(join(this.fixture.root, "native", "c2a-child.json"), "utf8"));
  }
  async restartNative(): Promise<void> {
    await this.native?.close();
    if (!this.plan) throw new Error("fixture missing original plan");
    this.native = await NativeProcess.start(join(this.fixture.root, "native"), this.plan.configurationDigest);
  }
  async close(): Promise<void> { await this.native?.close(); this.native = undefined; }
  logs(): string[] { return this.native?.logs ?? []; }
  private requireContainer(value: unknown): void {
    if (!this.container || value !== this.containerId) throw new Error("fixture wrong container");
  }
  private requireNative(): NativeProcess { if (!this.native) throw new Error("fixture not started"); return this.native; }
}

export class DeploymentHelperProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<void>;
  readonly logs: string[] = [];
  readonly frames: Frames;
  crashAfter?: EngineBoundary;
  constructor(fixture: DeploymentFixture, engine: FakeDeploymentEngine) {
    this.child = spawn(process.execPath, [fileURLToPath(new URL("./deployment-child.ts", import.meta.url)), fixture.root], {
      cwd: fixture.root, env: { SystemRoot: process.env.SystemRoot, WS_NO_BUFFER_UTIL: "1", WS_NO_UTF_8_VALIDATE: "1" },
      stdio: ["pipe", "pipe", "pipe", "ipc"], serialization: "advanced", windowsHide: true,
    });
    this.frames = new Frames(this.child.stdout!);
    this.exited = new Promise((resolve) => this.child.once("close", () => resolve()));
    this.child.stderr!.on("data", (value: Buffer) => this.logs.push(value.toString()));
    this.child.on("message", (message: { id: number; method: EngineMethod; args: unknown[] }) => {
      void engine.handle(message.method, message.args).then((value) => {
        const boundary = message.method === "control" && (message.args[1] as { action?: string })?.action === "authorize" ? "authorize" : message.method;
        if (boundary === this.crashAfter) { this.crashAfter = undefined; this.child.kill(); return; }
        if (this.child.connected) this.child.send({ id: message.id, value });
      }, () => { if (this.child.connected) this.child.send({ id: message.id, failed: true }); });
    });
  }
  async invoke(request: DeploymentInvocation, checkpoint: (value: InjectionCheckpointV1) => Promise<InjectionCheckpointResult>): Promise<DeploymentStatusV1> {
    this.child.stdin!.write(packet(Buffer.from(JSON.stringify(request))));
    for (;;) {
      const reply = DeploymentResidentReplySchema.parse(JSON.parse((await this.frames.read()).toString("utf8")));
      if (reply.kind === "result") {
        if (reply.requestId !== request.requestId) throw new Error("fixture stale response");
        return reply.status;
      }
      const answer = await checkpoint(reply.checkpoint);
      this.child.stdin!.write(packet(Buffer.from(JSON.stringify(answer))));
    }
  }
  async stop(): Promise<void> { if (this.child.exitCode === null) this.child.kill(); await this.exited; }
}
