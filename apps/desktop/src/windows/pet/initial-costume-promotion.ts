/**
 * INPUT:  authenticated pet clients, the live scene, costume metadata, and an injected D61 attempt factory.
 * OUTPUT: a scene-lifetime initial-promotion controller: interrupted work retries, attached work stays committed.
 * POS:    ui/windows/pet - framework-free state owner behind useInitialCostume; ordinary reconnect never reloads a commit.
 */

import type { CharacterCostumesResult } from "@taki/shared";
import type { CostumeAttemptHandle, CostumeCommit } from "@/lib/costume-switch-attempt.js";
import type { WsClient } from "@/lib/ws-client.js";
import type { PetScene } from "@/renderer/pet-scene.js";

export type InitialPromotionPhase = "idle" | "running" | "committed";

type PromotionClient = Pick<WsClient, "characterCostumes" | "costumeResolution" | "reportAvatar" | "currentTimingPolicy">;
type PromotionScene = Pick<PetScene, "switchCostume" | "abortSwitch">;

export interface InitialPromotionAttemptInput {
  client: PromotionClient;
  scene: PromotionScene;
  costumes: CharacterCostumesResult;
  costume: string;
  onCommit: (commit: CostumeCommit) => void;
}

export interface InitialPromotionControllerDeps {
  characterId: string;
  pickCostume: (costumes: CharacterCostumesResult) => string;
  startAttempt: (input: InitialPromotionAttemptInput) => CostumeAttemptHandle;
  onCommit: (commit: CostumeCommit) => void;
  onDiagnostic: (message: string, cause: unknown) => void;
}

export interface InitialPromotionController {
  phase(): InitialPromotionPhase;
  start(client: PromotionClient, scene: PromotionScene): Promise<void>;
  interrupt(): void;
  markCommitted(): void;
}

class PromotionController implements InitialPromotionController {
  private phaseValue: InitialPromotionPhase = "idle";
  private generation = 0;
  private active: CostumeAttemptHandle | null = null;
  private readonly deps: InitialPromotionControllerDeps;

  constructor(deps: InitialPromotionControllerDeps) {
    this.deps = deps;
  }

  phase(): InitialPromotionPhase {
    return this.phaseValue;
  }

  async start(client: PromotionClient, scene: PromotionScene): Promise<void> {
    if (this.phaseValue !== "idle") return;
    this.phaseValue = "running";
    const generation = ++this.generation;
    try {
      const costumes = await client.characterCostumes(this.deps.characterId);
      if (!this.isRunning(generation)) return;
      const costume = this.deps.pickCostume(costumes);
      if (await this.switchOnce({ client, scene, costumes, costume, generation })) return;
      if (!this.isRunning(generation) || costume === costumes.defaultCostume) return;
      await this.switchOnce({ client, scene, costumes, costume: costumes.defaultCostume, generation });
    } catch {
      // Absence is the normal "not imported" path and has no typed distinction from a transient read failure today.
      // Leave the controller idle so a replacement generation may retry, without warning on an ordinary dev fallback.
    } finally {
      if (this.isRunning(generation)) this.phaseValue = "idle";
    }
  }

  interrupt(): void {
    if (this.phaseValue === "committed") return;
    this.generation += 1;
    this.active?.cancel("superseded");
    this.active = null;
    this.phaseValue = "idle";
  }

  markCommitted(): void {
    this.phaseValue = "committed";
    this.active = null;
  }

  private async switchOnce(input: {
    client: PromotionClient;
    scene: PromotionScene;
    costumes: CharacterCostumesResult;
    costume: string;
    generation: number;
  }): Promise<boolean> {
    let committed = false;
    let attempt: CostumeAttemptHandle;
    try {
      attempt = this.deps.startAttempt({
        client: input.client,
        scene: input.scene,
        costumes: input.costumes,
        costume: input.costume,
        onCommit: (commit) => this.commit(input.generation, commit, () => (committed = true)),
      });
    } catch (cause) {
      this.deps.onDiagnostic(`costume ${input.costume} could not start`, cause);
      return false;
    }
    this.active = attempt;
    try {
      await attempt.result;
      return committed;
    } catch (cause) {
      if (this.isRunning(input.generation)) {
        this.deps.onDiagnostic(`costume ${input.costume} did not attach`, cause);
      }
      return false;
    } finally {
      if (this.active === attempt) this.active = null;
    }
  }

  private isRunning(generation: number): boolean {
    return this.generation === generation && this.phaseValue === "running";
  }

  private commit(generation: number, commit: CostumeCommit, markCommitted: () => void): void {
    if (!this.isRunning(generation)) return;
    markCommitted();
    this.phaseValue = "committed";
    this.active = null;
    this.deps.onCommit(commit);
  }
}

export function createInitialPromotionController(
  deps: InitialPromotionControllerDeps,
): InitialPromotionController {
  return new PromotionController(deps);
}
