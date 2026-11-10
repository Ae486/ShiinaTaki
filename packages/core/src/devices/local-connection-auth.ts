/**
 * INPUT: selected Core profile/endpoint, asynchronous native credential helper, and physical connect sockets.
 * OUTPUT: cached local bootstrap authority with socket-bound challenge/proof and non-secret endpoint discovery.
 * POS: core/devices — security bootstrap only; DeviceRegistry retains durable identity/role authority.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localAuthTranscript, type ConnectParams, type LocalAuthChallenge } from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import { localBootstrapKeySource, type LocalBootstrapKeySource } from "../secrets/local-bootstrap-key.ts";

const CHALLENGE_TTL_MS = 30_000;
const RETRY_KEY_MS = 1_000;
interface PendingChallenge { challenge: LocalAuthChallenge; identity: string }

export interface LocalConnectionAuth {
  begin(connection: object, params: ConnectParams): Promise<LocalAuthChallenge | null>;
  verify(connection: object, params: ConnectParams): boolean;
  publishEndpoint(endpoint: string): void;
  close(): void;
}

interface LocalAuthInput {
  env: Record<string, string | undefined>;
  dataDir: string;
  coreId: string;
  endpoint: string;
  logger: Logger;
  now?: () => number;
  keySource?: LocalBootstrapKeySource | null;
}

class LocalAuth implements LocalConnectionAuth {
  private readonly input: LocalAuthInput;
  private readonly instanceId = randomUUID();
  private readonly pending = new WeakMap<object, PendingChallenge>();
  private readonly now: () => number;
  private readonly source: LocalBootstrapKeySource | null;
  private readonly descriptorPath: string;
  private endpoint: string;
  private key: Uint8Array | null = null;
  private loading: Promise<Uint8Array | null> | null = null;
  private retryKeyAt = 0;
  private closed = false;

  constructor(input: LocalAuthInput) {
    this.input = input;
    this.now = input.now ?? Date.now;
    this.endpoint = input.endpoint;
    this.descriptorPath = join(input.dataDir, "local-core.json");
    this.source = input.keySource !== undefined ? input.keySource
      : localBootstrapKeySource(input.env.TAKI_SECRET_KEY_HELPER, `local-bootstrap-${input.coreId}`);
    void this.readKey();
  }

  private readKey(): Promise<Uint8Array | null> {
    if (this.loading) return this.loading;
    if (this.key || this.closed || !this.source || this.now() < this.retryKeyAt) return Promise.resolve(this.key);
    this.retryKeyAt = this.now() + RETRY_KEY_MS;
    this.loading = this.loadKey().finally(() => { this.loading = null; });
    return this.loading;
  }

  private async loadKey(): Promise<Uint8Array | null> {
    try {
      let key = await this.source?.read() ?? null;
      if (!key && this.source?.canCreate) {
        try { await this.source.create(randomBytes(32)); }
        catch { /* A create-only competitor may have won; accept only verified read-back. */ }
        key = await this.source.read();
      }
      if (!this.closed && key?.length === 32) this.key = key;
    } catch { this.input.logger.warn({ code: "LOCAL_AUTH_KEY_UNAVAILABLE" }, "Local connection identity is unavailable"); }
    return this.key;
  }

  async begin(connection: object, params: ConnectParams): Promise<LocalAuthChallenge | null> {
    const key = await this.readKey();
    if (!key || this.closed || params.localAuth?.kind !== "begin") return null;
    const unsigned = { version: 1 as const, coreId: this.input.coreId, instanceId: this.instanceId, endpoint: this.endpoint,
      nonce: randomBytes(32).toString("hex"), clientNonce: params.localAuth.clientNonce,
      deviceId: params.deviceId, role: params.role, expiresAt: this.now() + CHALLENGE_TTL_MS };
    const challenge = { ...unsigned, serverProof: localAuthMac(key, "server", unsigned) };
    this.pending.set(connection, { challenge, identity: identityOf(params) });
    return challenge;
  }

  verify(connection: object, params: ConnectParams): boolean {
    const candidate = this.pending.get(connection);
    this.pending.delete(connection);
    if (this.closed || !this.key || !candidate || params.localAuth?.kind !== "proof") return false;
    if (candidate.challenge.expiresAt <= this.now() || candidate.challenge.nonce !== params.localAuth.nonce
      || candidate.challenge.endpoint !== this.endpoint || candidate.identity !== identityOf(params)) return false;
    const expected = Buffer.from(localAuthMac(this.key, "client", candidate.challenge), "hex");
    const actual = Buffer.from(params.localAuth.proof, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  publishEndpoint(endpoint: string): void {
    if (this.closed) return;
    mkdirSync(this.input.dataDir, { recursive: true });
    const temporary = `${this.descriptorPath}.${this.instanceId}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, coreId: this.input.coreId, instanceId: this.instanceId, endpoint }));
      renameSync(temporary, this.descriptorPath);
      this.endpoint = endpoint;
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* Preserve the publication failure. */ }
      throw error;
    }
  }

  close(): void {
    this.closed = true;
    this.key = null;
    try {
      const descriptor: unknown = JSON.parse(readFileSync(this.descriptorPath, "utf8"));
      if (descriptor && typeof descriptor === "object" && "instanceId" in descriptor && descriptor.instanceId === this.instanceId) unlinkSync(this.descriptorPath);
    } catch { /* Never remove another running instance's discovery file. */ }
  }
}

export function createLocalConnectionAuth(input: LocalAuthInput): LocalConnectionAuth {
  const auth = new LocalAuth(input);
  return { begin: auth.begin.bind(auth), verify: auth.verify.bind(auth),
    publishEndpoint: auth.publishEndpoint.bind(auth), close: auth.close.bind(auth) };
}

/** Stable cross-language transcript: standard HMAC-SHA256 with distinct server/client domains. */
export function localAuthMac(key: Uint8Array, side: "server" | "client", challenge: Omit<LocalAuthChallenge, "serverProof">): string {
  return createHmac("sha256", key).update(localAuthTranscript(side, challenge)).digest("hex");
}

function identityOf(params: ConnectParams): string {
  return JSON.stringify([params.deviceId, params.deviceName, params.role, params.capabilities,
    params.host ?? null, params.approvalCommandDisclosureRevision ?? null]);
}
