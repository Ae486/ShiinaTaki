/**
 * INPUT:  process env (the bootstrap view: TAKI_DATA_DIR + whatever the operator set at launch)
 * OUTPUT: bootstrapCore(env) -> { logger, db, config: {source, repo, subscriptions, writer}, serverConfig,
 *         agentConfig, attachmentConfig, ambientConfig, contextConfig, model, env }
 * POS:    core/boot — the composition root's config+storage phase, lifted out of main.ts. THE place the settings
 *         store meets the loaders: the DB opens on the env-only data root, then every other loader parses the
 *         RESOLVED env (env > stored > default), which is what makes a knob's "restart to apply" badge true
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { type AgentConfig } from "../config/agent-config.ts";
import { type AmbientScreenshotConfig } from "../config/ambient-screenshot-config.ts";
import { type AttachmentConfig } from "../config/attachment-config.ts";
import { createConfigApplication, type ConfigApplicationTracker } from "../config/config-application.ts";
import { createConfigSource, type ConfigSource } from "../config/config-source.ts";
import { createConfigSubscriptions, type ConfigSubscriptions } from "../config/config-subscriptions.ts";
import { createConfigWriter, type ConfigWriter } from "../config/config-writer.ts";
import { type ContextConfig } from "../config/context-config.ts";
import { ProviderConfigSchema } from "../config/provider-config.ts";
import { createModels } from "../config/provider-factory.ts";
import { ServerConfigSchema, type ServerConfig } from "../config/server-config.ts";
import { createConfigRepo, type ConfigRepo } from "../db/config-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createLogger, type Logger } from "../logging/logger.ts";
import { loadFeatureConfiguration } from "./feature-configuration.ts";

export interface ConfigPlane {
  source: ConfigSource;
  repo: ConfigRepo;
  subscriptions: ConfigSubscriptions;
  writer: ConfigWriter;
  application: ConfigApplicationTracker;
}

export interface CoreBootstrap {
  /** The RESOLVED env every downstream loader must parse (subsystems that load their own config take this). */
  env: Record<string, string | undefined>;
  logger: Logger;
  db: Database;
  config: ConfigPlane;
  serverConfig: ServerConfig;
  agentConfig: AgentConfig;
  attachmentConfig: AttachmentConfig;
  ambientConfig: AmbientScreenshotConfig;
  contextConfig: ContextConfig;
  model?: LanguageModel;
}

/** The data root is read BEFORE the store exists, so it is the one knob env alone governs (registry: env-only). */
function openStore(env: Record<string, string | undefined>, onAfterCommitError: () => void): { db: Database; applied: number[]; dataDir: string } {
  const dataDir = ServerConfigSchema.shape.dataDir.parse(env.TAKI_DATA_DIR);
  // The composition root ensures the app data root exists before opening the db (first-boot);
  // the db layer itself stays fs-free (invariant). Mirrors the paired-device-store sanctioned site.
  mkdirSync(dataDir, { recursive: true });
  let applied: number[] = [];
  const db = openDatabase({
    path: join(dataDir, "taki.db"),
    migrations: MIGRATIONS,
    onAfterCommitError,
    // The logger's level is itself a knob, so it cannot exist yet — report the versions once it does.
    onMigrated: (versions) => {
      applied = versions;
    },
  });
  return { db, applied, dataDir };
}

export function bootstrapCore(processEnv: Record<string, string | undefined>, options: { onConfigChanged?(key: string): void } = {}): CoreBootstrap {
  let pendingCommitErrors = 0;
  let reportCommitError = () => { pendingCommitErrors += 1; };
  const { db, applied, dataDir } = openStore(processEnv, () => reportCommitError());
  const repo = createConfigRepo(db);
  const subscriptions = createConfigSubscriptions();
  const source = createConfigSource({ env: processEnv, repo, application: (key) => application.read(key) });
  const application = createConfigApplication({ source, changed: (key) => subscriptions.publish({ key, value: repo.get(key) }) });
  const env = source.env();
  let host: string;
  let port: number;
  try {
    host = ServerConfigSchema.shape.host.parse(env.TAKI_WS_HOST);
    port = ServerConfigSchema.shape.port.parse(env.TAKI_WS_PORT);
  } catch (error) { db.close(); throw error; }
  const features = loadFeatureConfiguration(env, application);
  const { contextConfig } = features;
  const serverConfig = { host, port, dataDir, logLevel: features.logLevel, promptDir: features.promptDir,
    trustLoopbackOperator: features.trustLoopbackOperator };
  const logger = createLogger(serverConfig.logLevel);
  reportCommitError = () => logger.warn({ code: "SQLITE_AFTER_COMMIT_FAILED" }, "Committed database callback failed");
  if (pendingCommitErrors > 0) logger.warn({ code: "SQLITE_AFTER_COMMIT_FAILED", count: pendingCommitErrors }, "Committed database callbacks failed during bootstrap");
  logger
    .child({ mod: "db" })
    .info({ applied }, applied.length > 0 ? "migrations applied" : "schema already up to date");

  // Native image input uses the primary model. Obsolete VLM settings do not affect startup.
  const provider = ProviderConfigSchema.safeParse(env);
  const model = provider.success ? createModels({ provider: provider.data, includeUsage: contextConfig.includeUsage }).model : undefined;

  return {
    env,
    logger,
    db,
    config: { source, repo, subscriptions, application, writer: createConfigWriter({ env: processEnv, repo,
      application: application.read, onChanged: (change) => {
      try { subscriptions.publish(change); }
      catch { logger.warn({ code: "CONFIG_NOTIFICATION_FAILED" }, "Config notification failed"); }
      // A committed setting must remain successful even when a local consumer fails.
      try { options.onConfigChanged?.(change.key); } catch { logger.warn({ code: "CONFIG_OBSERVER_FAILED" }, "Config observer failed"); }
    } }) },
    serverConfig,
    agentConfig: features.agentConfig,
    attachmentConfig: features.attachmentConfig,
    // Ambient capture remains opt-in; its native frame lifetime is owned by Perception.
    ambientConfig: features.ambientConfig,
    contextConfig,
    model,
  };
}
