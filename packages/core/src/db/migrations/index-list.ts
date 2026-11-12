/**
 * INPUT: immutable canonical main001-063 prefix and reviewed higher convergence migrations
 * OUTPUT: unique ordered fresh/upgrade registry; original historical receipts retain their meanings
 * POS: core/db/migrations — sole active registry; T4 colliding exports remain historical inputs only
 */
import type { Migration } from "../migration-runner.ts";
import { MAIN_HISTORICAL_MIGRATIONS } from "./historical-main.ts";
import { mainBaselineConvergenceMigration073 } from "./073-main-baseline-convergence.ts";
import { initiativeConvergenceMigration074 } from "./074-initiative-convergence.ts";
import { delegationConvergenceMigration075 } from "./075-delegation-convergence.ts";
import { memoryObservationConvergenceMigration076 } from "./076-memory-observation-convergence.ts";
import { modelConfigurationConvergenceMigration077 } from "./077-model-configuration-convergence.ts";

export const CONVERGENCE_MIGRATIONS: Migration[] = [mainBaselineConvergenceMigration073, initiativeConvergenceMigration074,
  delegationConvergenceMigration075, memoryObservationConvergenceMigration076, modelConfigurationConvergenceMigration077];
export const MIGRATIONS: Migration[] = [...MAIN_HISTORICAL_MIGRATIONS, ...CONVERGENCE_MIGRATIONS];
