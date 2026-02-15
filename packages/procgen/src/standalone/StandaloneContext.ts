/**
 * Standalone Context
 *
 * Provides a minimal world-like context for running procgen systems
 * outside of the full game engine. Used by Asset Forge for previewing
 * grass, flowers, terrain, and other procedural systems.
 *
 * This allows Asset Forge to use the actual game systems instead of
 * duplicating code, while providing isolation from the full World class.
 *
 * @module StandaloneContext
 */

import * as THREE from "three";

// WebGPURenderer type is not exported from @types/three, so we use a loose type
type WebGPURendererType = THREE.WebGLRenderer & { isWebGPURenderer?: boolean };

/**
 * Minimal camera interface for standalone rendering
 */
export interface StandaloneCamera {
  position: THREE.Vector3;
  projectionMatrix: THREE.Matrix4;
  matrixWorldInverse: THREE.Matrix4;
  getWorldDirection(target: THREE.Vector3): THREE.Vector3;
  updateMatrixWorld(force?: boolean): void;
}

/**
 * Minimal stage interface
 */
export interface StandaloneStage {
  scene: THREE.Scene;
  camera: THREE.Camera;
}

/**
 * Configuration for standalone context
 */
export interface StandaloneContextConfig {
  /** WebGPU or WebGL renderer */
  renderer: THREE.WebGLRenderer | WebGPURendererType;
  /** Three.js scene */
  scene: THREE.Scene;
  /** Camera for rendering */
  camera: THREE.Camera;
  /** Optional: Initial player/camera position */
  initialPosition?: THREE.Vector3;
}

/**
 * Simple system interface for standalone use
 */
export interface StandaloneSystem {
  /** Called once when system starts */
  start?(): Promise<void> | void;
  /** Called every frame */
  update?(deltaTime: number): void;
  /** Called when system stops */
  stop?(): void;
  /** Get dependencies (optional) */
  getDependencies?(): { required: string[]; optional: string[] };
}

/**
 * StandaloneContext - A minimal World-like context for Asset Forge
 *
 * Provides just enough interface for procgen systems to run without
 * requiring the full game engine infrastructure.
 *
 * @example
 * ```ts
 * const context = new StandaloneContext({
 *   renderer,
 *   scene,
 *   camera,
 * });
 *
 * // Register systems
 * context.register("grass", GrassPreviewSystem);
 *
 * // Start systems
 * await context.start();
 *
 * // In animation loop
 * context.update(deltaTime);
 *
 * // Cleanup
 * context.stop();
 * ```
 */
export class StandaloneContext {
  /** Whether this is a client context (always true for standalone) */
  readonly isClient = true;

  /** Whether this is a server context (always false for standalone) */
  readonly isServer = false;

  /** The WebGPU/WebGL renderer */
  readonly renderer: THREE.WebGLRenderer | WebGPURendererType;

  /** The Three.js scene */
  readonly scene: THREE.Scene;

  /** The main camera */
  camera: THREE.Camera;

  /** Stage object (for system compatibility) */
  readonly stage: StandaloneStage;

  /** Registered systems */
  private systems = new Map<string, StandaloneSystem>();

  /** System instances */
  private systemInstances = new Map<string, StandaloneSystem>();

  /** Running state */
  private running = false;

  /** Current "player" position (typically camera position) */
  private playerPosition = new THREE.Vector3();

  /** Clock for time tracking */
  private clock = new THREE.Clock();

  constructor(config: StandaloneContextConfig) {
    this.renderer = config.renderer;
    this.scene = config.scene;
    this.camera = config.camera;

    if (config.initialPosition) {
      this.playerPosition.copy(config.initialPosition);
    } else {
      this.playerPosition.copy(this.camera.position);
    }

    this.stage = {
      scene: this.scene,
      camera: this.camera,
    };
  }

  /**
   * Register a system class
   *
   * @param name - System identifier
   * @param SystemClass - System class or instance
   */
  register<T extends StandaloneSystem>(
    name: string,
    SystemClass: new (context: StandaloneContext) => T,
  ): void;
  register(name: string, instance: StandaloneSystem): void;
  register(
    name: string,
    systemOrClass:
      | StandaloneSystem
      | (new (context: StandaloneContext) => StandaloneSystem),
  ): void {
    if (typeof systemOrClass === "function") {
      // It's a class, instantiate it
      const instance = new systemOrClass(this);
      this.systems.set(name, instance);
      this.systemInstances.set(name, instance);
    } else {
      // It's already an instance
      this.systems.set(name, systemOrClass);
      this.systemInstances.set(name, systemOrClass);
    }
  }

  /**
   * Get a registered system by name
   */
  getSystem<T extends StandaloneSystem>(name: string): T | null {
    return (this.systemInstances.get(name) as T) ?? null;
  }

  /**
   * Check if a system is registered
   */
  hasSystem(name: string): boolean {
    return this.systems.has(name);
  }

  /**
   * Start all registered systems
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.clock.start();

    for (const [name, system] of this.systemInstances) {
      try {
        if (system.start) {
          await system.start();
        }
        console.log(`[StandaloneContext] Started system: ${name}`);
      } catch (error) {
        console.error(
          `[StandaloneContext] Failed to start system ${name}:`,
          error,
        );
      }
    }

    this.running = true;
  }

  /**
   * Update all systems
   *
   * @param deltaTime - Time since last frame (seconds). If not provided, uses internal clock.
   */
  update(deltaTime?: number): void {
    if (!this.running) return;

    const dt = deltaTime ?? this.clock.getDelta();

    // Update player position from camera
    this.playerPosition.copy(this.camera.position);

    for (const system of this.systemInstances.values()) {
      if (system.update) {
        system.update(dt);
      }
    }
  }

  /**
   * Stop all systems and clean up
   */
  stop(): void {
    if (!this.running) return;

    for (const [name, system] of this.systemInstances) {
      try {
        if (system.stop) {
          system.stop();
        }
        console.log(`[StandaloneContext] Stopped system: ${name}`);
      } catch (error) {
        console.error(
          `[StandaloneContext] Failed to stop system ${name}:`,
          error,
        );
      }
    }

    this.systemInstances.clear();
    this.systems.clear();
    this.running = false;
    this.clock.stop();
  }

  /**
   * Get the current player/camera position
   */
  getPlayerPosition(): THREE.Vector3 {
    return this.playerPosition.clone();
  }

  /**
   * Set the player/camera position
   */
  setPlayerPosition(position: THREE.Vector3): void {
    this.playerPosition.copy(position);
  }

  /**
   * Get elapsed time since start
   */
  getElapsedTime(): number {
    return this.clock.getElapsedTime();
  }

  /**
   * Check if context is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.stop();
  }
}

/**
 * Create a minimal graphics system stub for systems that depend on it
 */
export function createGraphicsStub(
  renderer: THREE.WebGLRenderer | WebGPURendererType,
): { renderer: THREE.WebGLRenderer | WebGPURendererType } {
  return { renderer };
}

/**
 * Create a minimal terrain system stub for systems that depend on heightmap
 */
export function createTerrainStub(): {
  getHeightAt: (x: number, z: number) => number;
  getHeightmapData: () => Float32Array | null;
} {
  return {
    getHeightAt: () => 0,
    getHeightmapData: () => null,
  };
}
