/**
 * System Types
 * All ECS system configuration and system-specific interface definitions
 */

import type { SystemDependencies } from "../../systems/shared";

// ============== SYSTEM CONFIGURATION ==============

/**
 * SystemConfig - base configuration for all systems
 */
export interface SystemConfig {
  name: string;
  dependencies: SystemDependencies;
  autoCleanup: boolean;
}

// ============== SYSTEM-SPECIFIC INTERFACES ==============

/**
 * IPlayerSystemForPersistence - interface for PlayerSystem used by PersistenceSystem
 */
export interface IPlayerSystemForPersistence {
  saveAllPlayers(): Promise<number>;
  getPlayerCount(): number;
  getOnlinePlayerIds(): string[];
}

/**
 * EntitySpawnRequest - request to spawn an entity
 */
export interface EntitySpawnRequest {
  type: "item" | "mob" | "npc" | "resource" | "static";
  config: unknown; // EntityConfig - will need proper import
}
