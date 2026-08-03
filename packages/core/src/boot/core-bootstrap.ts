/**
 * INPUT:  process env (the bootstrap view: TAKI_DATA_DIR + whatever the operator set at launch)
 * OUTPUT: bootstrapCore(env) -> { logger, db, config: {source, repo, subscriptions, writer}, serverConfig,
 *         agentConfig, attachmentConfig, ambientConfig, contextConfig, model, visionModel, env }
 * POS:    core/boot — the composition root's config+storage phase, lifted out of main.ts. THE place the settings
 *         store meets the loaders: the DB opens on the env-only data root, then every other loader parses the
 *         RESOLVED env (env > stored > default), which is what makes a knob's "restart to apply" badge true
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { loadAgentConfig, type AgentConfig } from "../config/agent-config.ts";
import { loadAmbientScreenshotConfig, type AmbientScreenshotConfig } from "../config/ambient-screenshot-config.ts";
import { loadAttachmentConfig, type AttachmentConfig } from "../config/attachment-config.ts";
import { createConfigSource, type ConfigSource } from "../config/config-source.ts";
import { createConfigSubscriptions, type ConfigSubscriptions } from "../config/config-subscriptions.ts";
import { createConfigWriter, type ConfigWriter } from "../config/config-writer.ts";
import { loadContextConfig, type ContextConfig } from "../config/context-config.ts";
import { loadProviderConfig } from "../config/provider-config.ts";
import { createModels } from "../config/provider-factory.ts";
import { loadServerConfig, type ServerConfig } from "../config/server-config.ts";
import { loadVisionConfig } from "../config/vision-config.ts";
import { createConfigRepo, type ConfigRepo } from "../db/config-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createLogger, type Logger } from "../logging/logger.ts";

export interface ConfigPlane {
  source: ConfigSource;
  repo: ConfigRepo;
  subscriptions: ConfigSubscriptions;
  writer: ConfigWriter;
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
  model: LanguageModel;
  visionModel: LanguageModel | undefined;
}

/** The data root is read BEFORE the store exists, so it is the one knob env alone governs (registry: env-only). */
function openStore(env: Record<string, string | undefined>): { db: Database; applied: number[]; dataDir: string } {
  const { dataDir } = loadServerConfig(env);
  // The composition root ensures the app data root exists before opening the db (first-boot);
  // the db layer itself stays fs-free (invariant). Mirrors the paired-device-store sanctioned site.
  mkdirSync(dataDir, { recursive: true });
  let applied: number[] = [];
  const db = openDatabase({
    path: join(dataDir, "taki.db"),
    migrations: MIGRATIONS,
    // The logger's level is itself a knob, so it cannot exist yet — report the versions once it does.
    onMigrated: (versions) => {
      applied = versions;
    },
  });
  return { db, applied, dataDir };
}

export function bootstrapCore(processEnv: Record<string, string | undefined>): CoreBootstrap {
  const { db, applied, dataDir } = openStore(processEnv);
  const repo = createConfigRepo(db);
  const source = createConfigSource({ env: processEnv, repo });
  const subscriptions = createConfigSubscriptions();
  const env = source.env();

  // Config parse stays fatal-fast at boot; the values now come from env > store > default instead of env alone.
  const serverConfig = { ...loadServerConfig(env), dataDir };
  const contextConfig = loadContextConfig(env);
  const logger = createLogger(serverConfig.logLevel);
  logger
    .child({ mod: "db" })
    .info({ applied }, applied.length > 0 ? "migrations applied" : "schema already up to date");

  // Two user-adjustable model slots (#17 decision 5): the required text slot + an OPTIONAL vision slot. Both are
  // fatal-fast — a partial TAKI_VLM_* set fails the boot, never silently degrades. The third slot (TAKI_UTILITY_*,
  // background work) is parsed inside the memory subsystem's boot wiring, on the same fail-fast terms.
  const { model, visionModel } = createModels({
    provider: loadProviderConfig(env),
    vision: loadVisionConfig(env),
    includeUsage: contextConfig.includeUsage,
  });

  return {
    env,
    logger,
    db,
    config: { source, repo, subscriptions, writer: createConfigWriter({ env: processEnv, repo, onChanged: (change) => subscriptions.publish(change) }) },
    serverConfig,
    agentConfig: loadAgentConfig(env),
    attachmentConfig: loadAttachmentConfig(env),
    // Ambient screen sampling (#20 T3b): OFF unless explicitly enabled, raw frames dropped right after describe.
    ambientConfig: loadAmbientScreenshotConfig(env),
    contextConfig,
    model,
    visionModel,
  };
}
