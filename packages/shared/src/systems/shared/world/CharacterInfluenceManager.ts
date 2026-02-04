/**
 * CharacterInfluenceManager - Multi-character grass bending system
 *
 * Tracks all characters (players, NPCs, mobs) that should affect grass bending.
 * Uploads character positions and velocities to GPU via DataTexture for shader access.
 *
 * **Features:**
 * - Multi-character support (not just player)
 * - Velocity-based directional bending (grass bends away from movement)
 * - Size-based influence radius (larger characters affect more grass)
 * - Recovery over time (grass springs back after character passes)
 *
 * **Architecture:**
 * - Maintains list of active influences (position, velocity, radius)
 * - Packs character data into DataTexture (each row = one character)
 * - GPU samples texture for per-blade bending calculations
 *
 * @module CharacterInfluenceManager
 */

import * as THREE from "three";
import { texture, uniform, Fn, vec3 } from "three/tsl";
import type { World } from "../../../core/World";
import { setCharacterBendingTexture } from "./ProceduralGrass";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration for character grass influence.
 */
const INFLUENCE_CONFIG = {
  /** Maximum number of characters to track */
  MAX_CHARACTERS: 64,
  /** Maximum distance from camera to track characters */
  MAX_TRACK_DISTANCE: 100,
  /** Default influence radius for player (meters) - 0.35m = 0.7m diameter */
  PLAYER_RADIUS: 0.35,
  /** Default influence radius for NPCs (meters) */
  NPC_RADIUS: 0.3,
  /** Default influence radius for mobs (meters) */
  MOB_RADIUS: 0.25,
  /** How fast grass bends when stepped on (0-1, higher = faster) */
  BEND_SPEED: 0.8,
  /** How fast grass recovers after being bent (0-1, higher = faster) */
  RECOVERY_SPEED: 0.1,
  /** Maximum bend amount (0-1) */
  MAX_BEND: 0.9,
  /** Minimum height scale when fully bent */
  MIN_HEIGHT_SCALE: 0.1,
} as const;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Character influence data for GPU upload.
 * Packed as vec4: (x, y, z, radius) + vec4: (vx, vy, vz, speed)
 */
interface CharacterInfluence {
  /** Unique identifier for this character */
  id: string;
  /** World position */
  position: THREE.Vector3;
  /** Movement velocity (for directional bending) */
  velocity: THREE.Vector3;
  /** Influence radius (meters) */
  radius: number;
  /** Movement speed (for bend intensity) */
  speed: number;
  /** Character type for radius defaults */
  type: "player" | "npc" | "mob" | "pet";
  /** Whether character is grounded (only affect grass when on ground) */
  grounded: boolean;
}

/**
 * Internal tracked character with additional state.
 */
interface TrackedCharacter extends CharacterInfluence {
  /** Last known position (for velocity calculation) */
  lastPosition: THREE.Vector3;
  /** Time since last update */
  lastUpdateTime: number;
}

// ============================================================================
// CHARACTER INFLUENCE MANAGER CLASS
// ============================================================================

/**
 * Manages character influences on grass bending.
 * Uses a DataTexture to store character data for GPU access.
 *
 * Texture format: 64x2 RGBA Float
 * - Row 0: position (x, y, z) + radius (w)
 * - Row 1: velocity (x, y, z) + speed (w)
 */
export class CharacterInfluenceManager {
  private world: World;
  private initialized = false;

  // Tracked characters
  private characters: Map<string, TrackedCharacter> = new Map();

  // Character data texture (64x2 RGBA Float)
  // Each column = one character, Row 0 = pos+radius, Row 1 = vel+speed
  private characterTexture: THREE.DataTexture | null = null;
  private characterTextureNode: ReturnType<typeof texture> | null = null;
  private textureData: Float32Array | null = null;

  // Uniforms
  private uCharacterCount = uniform(0);

  // Bending parameters as uniforms
  private bendSpeedUniform = uniform(INFLUENCE_CONFIG.BEND_SPEED);
  private recoverySpeedUniform = uniform(INFLUENCE_CONFIG.RECOVERY_SPEED);
  private maxBendUniform = uniform(INFLUENCE_CONFIG.MAX_BEND);
  private minHeightScaleUniform = uniform(INFLUENCE_CONFIG.MIN_HEIGHT_SCALE);

  // Temporary vectors for calculations
  private _tempVec3 = new THREE.Vector3();

  constructor(world: World) {
    this.world = world;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Initialize GPU texture.
   */
  initialize(): void {
    if (this.initialized) return;

    const width = INFLUENCE_CONFIG.MAX_CHARACTERS; // 64 characters
    const height = 2; // Row 0 = pos+radius, Row 1 = vel+speed

    // Create texture data (RGBA Float)
    this.textureData = new Float32Array(width * height * 4);

    // Create THREE.js DataTexture
    this.characterTexture = new THREE.DataTexture(
      this.textureData,
      width,
      height,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.characterTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.characterTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.characterTexture.minFilter = THREE.NearestFilter;
    this.characterTexture.magFilter = THREE.NearestFilter;
    this.characterTexture.needsUpdate = true;

    // Create TSL texture node
    this.characterTextureNode = texture(this.characterTexture);

    this.initialized = true;
    console.log(
      `[CharacterInfluenceManager] Initialized ${width}x${height} texture for ${width} characters`,
    );
  }

  /**
   * Register a character for grass influence tracking.
   */
  registerCharacter(
    id: string,
    type: CharacterInfluence["type"],
    position: THREE.Vector3,
    radius?: number,
  ): void {
    // Determine radius based on type if not specified
    const actualRadius =
      radius ??
      (type === "player"
        ? INFLUENCE_CONFIG.PLAYER_RADIUS
        : type === "npc"
          ? INFLUENCE_CONFIG.NPC_RADIUS
          : INFLUENCE_CONFIG.MOB_RADIUS);

    const character: TrackedCharacter = {
      id,
      type,
      position: position.clone(),
      velocity: new THREE.Vector3(),
      radius: actualRadius,
      speed: 0,
      grounded: true,
      lastPosition: position.clone(),
      lastUpdateTime: performance.now(),
    };

    this.characters.set(id, character);
  }

  /**
   * Unregister a character from tracking.
   */
  unregisterCharacter(id: string): void {
    this.characters.delete(id);
  }

  /**
   * Update a character's position.
   * Automatically calculates velocity from position delta.
   */
  updateCharacter(
    id: string,
    position: THREE.Vector3,
    grounded = true,
    explicitVelocity?: THREE.Vector3,
  ): void {
    const character = this.characters.get(id);
    if (!character) return;

    const now = performance.now();
    const dt = Math.max(0.001, (now - character.lastUpdateTime) / 1000); // seconds

    // Calculate velocity if not explicitly provided
    if (explicitVelocity) {
      character.velocity.copy(explicitVelocity);
    } else {
      character.velocity
        .copy(position)
        .sub(character.lastPosition)
        .divideScalar(dt);
    }

    // Calculate speed (XZ only for grass bending)
    character.speed = Math.sqrt(
      character.velocity.x * character.velocity.x +
        character.velocity.z * character.velocity.z,
    );

    // Update position
    character.lastPosition.copy(character.position);
    character.position.copy(position);
    character.grounded = grounded;
    character.lastUpdateTime = now;
  }

  /**
   * Update all tracked characters from world entities.
   * Call once per frame before grass rendering.
   */
  updateFromWorld(cameraPosition: THREE.Vector3): void {
    // Type cast world to access methods that may not be in base World type
    const world = this.world as {
      getPlayers?: () => Array<{
        id?: string;
        position?: THREE.Vector3;
        node?: { position?: THREE.Vector3 };
      }>;
      entities?: {
        getLocalPlayer?: () => {
          id?: string;
          position?: THREE.Vector3;
          node?: { position?: THREE.Vector3 };
        } | null;
        getNPCs?: () => Array<{ id?: string; position?: THREE.Vector3 }>;
        getMobs?: () => Array<{ id?: string; position?: THREE.Vector3 }>;
      };
    };

    // CRITICAL: Update local player FIRST (this is the main character!)
    const localPlayer = world.entities?.getLocalPlayer?.();
    if (localPlayer) {
      const pos = localPlayer.node?.position ?? localPlayer.position;
      if (pos) {
        const localPlayerId = localPlayer.id || "local-player";
        if (!this.characters.has(localPlayerId)) {
          this.registerCharacter(
            localPlayerId,
            "player",
            pos,
            INFLUENCE_CONFIG.PLAYER_RADIUS, // 0.35m radius = 0.7m diameter
          );
        }
        this.updateCharacter(
          localPlayerId,
          pos,
          true, // TODO: Check actual grounded state
        );
      }
    }

    // Update remote players
    const players = world.getPlayers?.() ?? [];
    for (const player of players) {
      // Skip if this is the local player (already handled above)
      if (localPlayer && player.id === localPlayer.id) continue;

      // Try to get position from player.node.position (3D mesh) or player.position
      const pos = player.node?.position ?? player.position;
      if (!pos) continue;

      const playerId = player.id || `player-${players.indexOf(player)}`;
      if (!this.characters.has(playerId)) {
        this.registerCharacter(
          playerId,
          "player",
          pos,
          INFLUENCE_CONFIG.PLAYER_RADIUS,
        );
      }
      this.updateCharacter(
        playerId,
        pos,
        true, // Assume grounded for now
      );
    }

    // Update NPCs within range
    const npcs = world.entities?.getNPCs?.() ?? [];
    for (const npc of npcs) {
      if (!npc.position) continue;

      const distance = this._tempVec3
        .copy(npc.position)
        .sub(cameraPosition)
        .length();
      if (distance > INFLUENCE_CONFIG.MAX_TRACK_DISTANCE) continue;

      const npcId = npc.id || `npc-${npcs.indexOf(npc)}`;
      if (!this.characters.has(npcId)) {
        this.registerCharacter(
          npcId,
          "npc",
          npc.position,
          INFLUENCE_CONFIG.NPC_RADIUS,
        );
      }
      this.updateCharacter(npcId, npc.position);
    }

    // Update mobs within range
    const mobs = world.entities?.getMobs?.() ?? [];
    for (const mob of mobs) {
      if (!mob.position) continue;

      const distance = this._tempVec3
        .copy(mob.position)
        .sub(cameraPosition)
        .length();
      if (distance > INFLUENCE_CONFIG.MAX_TRACK_DISTANCE) continue;

      const mobId = mob.id || `mob-${mobs.indexOf(mob)}`;
      if (!this.characters.has(mobId)) {
        this.registerCharacter(
          mobId,
          "mob",
          mob.position,
          INFLUENCE_CONFIG.MOB_RADIUS,
        );
      }
      this.updateCharacter(mobId, mob.position);
    }

    // Remove characters that are too far away
    const toRemove: string[] = [];
    for (const [id, character] of this.characters) {
      if (id.startsWith("player-")) continue; // Never remove players

      const distance = this._tempVec3
        .copy(character.position)
        .sub(cameraPosition)
        .length();
      if (distance > INFLUENCE_CONFIG.MAX_TRACK_DISTANCE * 1.5) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.characters.delete(id);
    }

    // Upload to GPU
    this.uploadToGPU(cameraPosition);
  }

  /**
   * Get the character texture node for shader integration.
   */
  getTextureNode(): ReturnType<typeof texture> | null {
    return this.characterTextureNode;
  }

  /**
   * Get TSL uniforms for shader integration.
   */
  getUniforms(): {
    characterCount: ReturnType<typeof uniform>;
    bendSpeed: ReturnType<typeof uniform>;
    recoverySpeed: ReturnType<typeof uniform>;
    maxBend: ReturnType<typeof uniform>;
    minHeightScale: ReturnType<typeof uniform>;
  } {
    return {
      characterCount: this.uCharacterCount,
      bendSpeed: this.bendSpeedUniform,
      recoverySpeed: this.recoverySpeedUniform,
      maxBend: this.maxBendUniform,
      minHeightScale: this.minHeightScaleUniform,
    };
  }

  /**
   * Create TSL function to calculate grass bending from all characters.
   *
   * NOTE: This method is kept for API compatibility. The actual bending
   * is now handled directly in ProceduralGrass's compute shader via
   * setCharacterBendingTexture(). Use getTextureNode() + getUniforms() if
   * you need to integrate into a custom shader.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createBendingFn(): any {
    return Fn(() => vec3(0, 0, 1));
  }

  /**
   * Get statistics for debugging.
   */
  getStats(): {
    trackedCharacters: number;
    maxCharacters: number;
  } {
    return {
      trackedCharacters: this.characters.size,
      maxCharacters: INFLUENCE_CONFIG.MAX_CHARACTERS,
    };
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.characterTexture?.dispose();
    this.characterTexture = null;
    this.characterTextureNode = null;
    this.textureData = null;
    this.characters.clear();
    this.initialized = false;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Upload character data to GPU texture.
   * Texture format: 64x2 RGBA Float
   * - Row 0 (y=0): position (x, y, z) + radius (w)
   * - Row 1 (y=1): velocity (x, y, z) + speed (w)
   */
  private uploadToGPU(cameraPosition: THREE.Vector3): void {
    if (!this.textureData || !this.characterTexture) return;

    // Sort characters by distance to camera (closest first)
    const sortedCharacters = Array.from(this.characters.values())
      .filter((c) => c.grounded) // Only include grounded characters
      .map((c) => ({
        character: c,
        distSq:
          Math.pow(c.position.x - cameraPosition.x, 2) +
          Math.pow(c.position.z - cameraPosition.z, 2),
      }))
      .sort((a, b) => a.distSq - b.distSq)
      .slice(0, INFLUENCE_CONFIG.MAX_CHARACTERS);

    const width = INFLUENCE_CONFIG.MAX_CHARACTERS;
    const count = sortedCharacters.length;

    // Update uniform
    this.uCharacterCount.value = count;

    // Clear texture data (important for unused slots)
    this.textureData.fill(0);

    // Pack into texture
    for (let i = 0; i < count; i++) {
      const { character } = sortedCharacters[i];

      // Row 0: position + radius (y=0, each pixel is RGBA)
      const posIdx = i * 4; // Row 0
      this.textureData[posIdx + 0] = character.position.x;
      this.textureData[posIdx + 1] = character.position.y;
      this.textureData[posIdx + 2] = character.position.z;
      this.textureData[posIdx + 3] = character.radius;

      // Row 1: velocity + speed (y=1)
      const velIdx = width * 4 + i * 4; // Row 1 offset
      this.textureData[velIdx + 0] = character.velocity.x;
      this.textureData[velIdx + 1] = character.velocity.y;
      this.textureData[velIdx + 2] = character.velocity.z;
      this.textureData[velIdx + 3] = character.speed;
    }

    // Update THREE.js texture
    this.characterTexture.needsUpdate = true;

    // Update ProceduralGrass module-level shader data
    setCharacterBendingTexture(this.characterTextureNode, count);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let characterInfluenceManagerInstance: CharacterInfluenceManager | null = null;

/**
 * Get or create the character influence manager singleton.
 */
export function getCharacterInfluenceManager(
  world: World,
): CharacterInfluenceManager {
  if (!characterInfluenceManagerInstance) {
    characterInfluenceManagerInstance = new CharacterInfluenceManager(world);
  }
  return characterInfluenceManagerInstance;
}

/**
 * Dispose of the character influence manager singleton.
 */
export function disposeCharacterInfluenceManager(): void {
  if (characterInfluenceManagerInstance) {
    characterInfluenceManagerInstance.dispose();
    characterInfluenceManagerInstance = null;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { INFLUENCE_CONFIG as CHARACTER_INFLUENCE_CONFIG };
export type { CharacterInfluence, TrackedCharacter };
