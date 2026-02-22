/**
 * CycleStateMachine — Formalizes streaming duel cycle phase transitions.
 *
 * Defines the legal transition table and provides guarded transition methods
 * that throw on illegal state changes. Each transition can optionally run
 * entry/exit actions.
 */

import type { StreamingPhase } from "../types.js";

/** Valid transitions: from → allowed targets */
const TRANSITION_TABLE: Record<StreamingPhase, readonly StreamingPhase[]> = {
  IDLE: ["ANNOUNCEMENT"],
  ANNOUNCEMENT: ["COUNTDOWN", "IDLE"],
  COUNTDOWN: ["FIGHTING", "IDLE"],
  FIGHTING: ["RESOLUTION", "IDLE"],
  RESOLUTION: ["IDLE"],
} as const;

export type PhaseChangeListener = (
  from: StreamingPhase,
  to: StreamingPhase,
) => void;

export class CycleStateMachine {
  private _phase: StreamingPhase = "IDLE";
  private _phaseStartTime = 0;
  private listeners: PhaseChangeListener[] = [];

  get phase(): StreamingPhase {
    return this._phase;
  }

  get phaseStartTime(): number {
    return this._phaseStartTime;
  }

  /**
   * Attempt a phase transition. Throws if the transition is illegal.
   * Returns true if the transition was applied.
   */
  transition(to: StreamingPhase): void {
    const from = this._phase;
    if (from === to) return;

    const allowed = TRANSITION_TABLE[from];
    if (!allowed.includes(to)) {
      throw new Error(
        `[CycleStateMachine] Illegal transition: ${from} → ${to}. ` +
          `Allowed from ${from}: [${allowed.join(", ")}]`,
      );
    }

    this._phase = to;
    this._phaseStartTime = Date.now();

    for (const listener of this.listeners) {
      listener(from, to);
    }
  }

  /**
   * Force reset to IDLE regardless of current state.
   * Used for abort/error recovery paths.
   */
  forceIdle(): void {
    const from = this._phase;
    if (from === "IDLE") return;

    this._phase = "IDLE";
    this._phaseStartTime = Date.now();

    for (const listener of this.listeners) {
      listener(from, "IDLE");
    }
  }

  /** Check if a transition from current state to target is legal */
  canTransition(to: StreamingPhase): boolean {
    if (this._phase === to) return false;
    return TRANSITION_TABLE[this._phase].includes(to);
  }

  /** Register a listener for phase changes */
  onPhaseChange(listener: PhaseChangeListener): void {
    this.listeners.push(listener);
  }

  /** Remove all listeners */
  removeAllListeners(): void {
    this.listeners = [];
  }

  /** Time elapsed in the current phase (ms) */
  phaseElapsed(): number {
    return this._phaseStartTime > 0 ? Date.now() - this._phaseStartTime : 0;
  }

  /** Check if current phase matches expected */
  isIn(phase: StreamingPhase): boolean {
    return this._phase === phase;
  }
}
