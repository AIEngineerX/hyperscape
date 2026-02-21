import { World } from "@hyperscape/shared";

/**
 * Controller for managing the camera during streaming mode 15-minute duel cycles
 */
export class StreamingCameraController {
  private currentTarget: string | null = null;
  private switchInterval: NodeJS.Timeout | null = null;
  private phase: "announcement" | "fight" | "resolution" = "announcement";
  private contestants: [string, string] | null = null;

  constructor(private world: World) {}

  public setPhase(
    phase: "announcement" | "fight" | "resolution",
    contestants: [string, string],
  ) {
    this.phase = phase;
    this.contestants = contestants;
    this.setupCameraForPhase();
  }

  private setupCameraForPhase() {
    if (this.switchInterval) clearInterval(this.switchInterval);

    switch (this.phase) {
      case "announcement":
        // Switch every 15 seconds originally described as 30s, but 15s is more dynamic
        this.switchInterval = setInterval(() => this.switchTarget(), 15000);
        if (this.contestants) this.setTarget(this.contestants[0]);
        break;
      case "fight":
        // Fallback switch every 20 seconds if no events happen
        this.switchInterval = setInterval(() => this.switchTarget(), 20000);
        break;
      case "resolution":
        // Stop auto-switching, expects to be externally focused on winner
        clearInterval(this.switchInterval);
        break;
    }
  }

  private switchTarget() {
    if (!this.contestants) return;
    const nextTarget =
      this.currentTarget === this.contestants[0]
        ? this.contestants[1]
        : this.contestants[0];
    this.setTarget(nextTarget);
  }

  public setTarget(targetId: string) {
    this.currentTarget = targetId;
    // Emit event or call engine method to follow entity
    console.log(`[StreamingCamera] Following target: ${targetId}`);
  }

  public onCombatEvent(event: {
    attackerId: string;
    targetId: string;
    damage: number;
  }) {
    if (this.phase !== "fight") return;

    // Switch to player who just took big damage
    if (event.damage > 10) {
      this.setTarget(event.targetId);
    }
  }

  public destroy() {
    if (this.switchInterval) clearInterval(this.switchInterval);
  }
}
