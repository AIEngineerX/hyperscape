/**
 * Manages mob death, respawn, and position locking.
 * Flow: die() → animation (4.5s) → hide mesh → respawn (15s).
 */

import * as THREE from "../../extras/three/three";
import type { Position3D } from "../../types";

export interface DeathStateConfig {
  respawnTime: number;
  deathAnimationDuration: number;
  spawnPoint: Position3D;
}

export class DeathStateManager {
  private isDead = false;
  private deathTime: number | null = null;
  private deathPosition: THREE.Vector3 | null = null;
  private sentDeathStateToClient = false;
  private config: DeathStateConfig;
  private onRespawnCallback?: () => void;
  private onMeshVisibilityCallback?: (visible: boolean) => void;

  constructor(config: DeathStateConfig) {
    this.config = {
      ...config,
      deathAnimationDuration: config.deathAnimationDuration || 4500,
      respawnTime: config.respawnTime || 15000,
    };
  }

  die(currentPosition: Position3D, currentTime: number): void {
    if (this.isDead) {
      console.warn("[DeathStateManager] die() called but already dead");
      return;
    }

    this.deathPosition = new THREE.Vector3(
      currentPosition.x,
      currentPosition.y,
      currentPosition.z,
    );
    this.deathTime = currentTime;
    this.isDead = true;
    this.sentDeathStateToClient = false;
  }

  /** Respawn handled by RespawnManager - this just hides mesh after animation */
  update(_deltaTime: number, currentTime: number): void {
    if (!this.isDead || !this.deathTime) return;

    const timeSinceDeath = currentTime - this.deathTime;
    if (timeSinceDeath >= this.config.deathAnimationDuration) {
      if (this.onMeshVisibilityCallback) {
        this.onMeshVisibilityCallback(false);
      }
    }
  }

  /** Only called by RespawnManager */
  private respawn(): void {
    if (!this.isDead) return;

    this.isDead = false;
    this.deathTime = null;
    this.deathPosition = null;
    this.sentDeathStateToClient = false;

    if (this.onMeshVisibilityCallback) {
      this.onMeshVisibilityCallback(true);
    }
    if (this.onRespawnCallback) {
      this.onRespawnCallback();
    }
  }

  getDeathPosition(): THREE.Vector3 | null {
    return this.deathPosition;
  }

  shouldLockPosition(): boolean {
    return this.isDead && this.deathPosition !== null;
  }

  getLockedPosition(): THREE.Vector3 | null {
    return this.shouldLockPosition() ? this.deathPosition : null;
  }

  isCurrentlyDead(): boolean {
    return this.isDead;
  }

  getDeathTime(): number | null {
    return this.deathTime;
  }

  setDeathTime(time: number | null): void {
    this.deathTime = time;
  }

  markDeathStateSent(): void {
    this.sentDeathStateToClient = true;
  }

  hasSentDeathState(): boolean {
    return this.sentDeathStateToClient;
  }

  forceRespawn(): void {
    this.respawn();
  }

  onRespawn(callback: () => void): void {
    this.onRespawnCallback = callback;
  }

  onMeshVisibilityChange(callback: (visible: boolean) => void): void {
    this.onMeshVisibilityCallback = callback;
  }

  applyDeathPositionFromServer(position: THREE.Vector3): void {
    if (!this.isDead) {
      console.warn("[DeathStateManager] Received death position but not dead");
      this.isDead = true;
    }
    this.deathPosition = position.clone();
  }

  reset(): void {
    this.isDead = false;
    this.deathTime = null;
    this.deathPosition = null;
    this.sentDeathStateToClient = false;
  }
}
