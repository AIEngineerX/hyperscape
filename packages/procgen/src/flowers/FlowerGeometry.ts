/**
 * Flower Geometry Generation
 *
 * Creates flower geometry and instance data for GPU rendering.
 * Flowers use billboard sprites for efficient rendering.
 *
 * @module FlowerGeometry
 */

import * as THREE from "three";
import type { FlowerAppearanceConfig } from "./types.js";
import { DEFAULT_FLOWER_CONFIG, DEFAULT_FLOWER_APPEARANCE } from "./types.js";

/**
 * Create a flower billboard geometry
 *
 * Creates a simple plane that will be billboarded in the shader.
 *
 * @param width - Sprite width
 * @param height - Sprite height
 * @returns PlaneGeometry for flower sprites
 */
export function createFlowerGeometry(
  width = DEFAULT_FLOWER_APPEARANCE.width,
  height = DEFAULT_FLOWER_APPEARANCE.height,
): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(width, height);
  return geometry;
}

/**
 * Instance data for a flower
 */
export interface FlowerInstanceData {
  /** World position X offset */
  x: number;
  /** World position Z offset */
  z: number;
  /** Ground height */
  y: number;
  /** Scale factor */
  scale: number;
  /** Color variation (0-1) */
  colorIndex: number;
  /** Wind phase offset */
  phaseOffset: number;
}

/**
 * Result of flower patch generation
 */
export interface FlowerPatchResult {
  /** Number of flower instances */
  count: number;
  /** Instance position buffer (vec4: x, z, scale, colorIndex) */
  positionBuffer: Float32Array;
  /** Instance variation buffer (vec4: phaseOffset, reserved...) */
  variationBuffer: Float32Array;
}

/**
 * Options for flower patch generation
 */
export interface FlowerPatchOptions {
  /** Number of flowers */
  count?: number;
  /** Tile size */
  tileSize?: number;
  /** Flowers per side (for grid) */
  flowersPerSide?: number;
  /** Appearance config */
  appearance?: Partial<FlowerAppearanceConfig>;
  /** Random seed */
  seed?: number;
}

/**
 * Simple seeded random number generator
 */
function createSeededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Generate flower instance data for a tile
 *
 * Creates a grid of flowers with random jitter and variation.
 *
 * @param options - Generation options
 * @returns Instance data buffers
 */
export function generateFlowerPatch(
  options: FlowerPatchOptions = {},
): FlowerPatchResult {
  const tileSize = options.tileSize ?? DEFAULT_FLOWER_CONFIG.tileSize;
  const flowersPerSide =
    options.flowersPerSide ?? DEFAULT_FLOWER_CONFIG.flowersPerSide;
  const appearance = { ...DEFAULT_FLOWER_APPEARANCE, ...options.appearance };
  const seed = options.seed ?? 12345;

  const count = flowersPerSide * flowersPerSide;
  const spacing = tileSize / flowersPerSide;
  const halfSize = tileSize / 2;

  const random = createSeededRandom(seed);

  const positionBuffer = new Float32Array(count * 4);
  const variationBuffer = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / flowersPerSide);
    const col = i % flowersPerSide;

    // Grid position with jitter
    const jitterX = (random() - 0.5) * spacing * 0.5;
    const jitterZ = (random() - 0.5) * spacing * 0.5;

    const x = col * spacing - halfSize + jitterX;
    const z = row * spacing - halfSize + jitterZ;

    // Scale variation
    const scale =
      appearance.minScale +
      random() * (appearance.maxScale - appearance.minScale);

    // Color index (0-3 for 4 colors)
    const colorIndex = random();

    // Phase offset for wind
    const phaseOffset = random() * Math.PI * 2;

    // Pack data
    const pi = i * 4;
    positionBuffer[pi + 0] = x;
    positionBuffer[pi + 1] = z;
    positionBuffer[pi + 2] = scale;
    positionBuffer[pi + 3] = colorIndex;

    variationBuffer[pi + 0] = phaseOffset;
    variationBuffer[pi + 1] = random(); // Additional random for wind variation
    variationBuffer[pi + 2] = random(); // Height variation
    variationBuffer[pi + 3] = 0; // Reserved
  }

  return {
    count,
    positionBuffer,
    variationBuffer,
  };
}

/**
 * Create instanced buffer attributes from patch data
 *
 * @param geometry - Base flower geometry
 * @param patchData - Generated patch data
 * @returns Geometry with instance attributes
 */
export function attachFlowerInstanceAttributes(
  geometry: THREE.BufferGeometry,
  patchData: FlowerPatchResult,
): THREE.BufferGeometry {
  const cloned = geometry.clone();

  const instanceData = new THREE.InstancedBufferAttribute(
    patchData.positionBuffer,
    4,
  );
  const instanceVariation = new THREE.InstancedBufferAttribute(
    patchData.variationBuffer,
    4,
  );

  cloned.setAttribute("instanceData", instanceData);
  cloned.setAttribute("instanceVariation", instanceVariation);

  return cloned;
}

/**
 * Generate a procedural petal texture
 *
 * Creates a simple circular petal pattern as a DataTexture.
 * Can be used when no flower atlas is available.
 *
 * @param size - Texture size (power of 2)
 * @returns DataTexture with petal pattern
 */
export function createProceduralPetalTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);

  const center = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Distance from center
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Petal shape (soft circle)
      const alpha = dist < 0.8 ? Math.pow(1 - dist / 0.8, 0.5) : 0;

      // White flower with alpha
      data[i + 0] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.floor(alpha * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;

  return texture;
}

/**
 * Generate a multi-petal flower texture
 *
 * Creates a more complex flower pattern with multiple petals.
 *
 * @param size - Texture size
 * @param petalCount - Number of petals
 * @returns DataTexture with flower pattern
 */
export function createMultiPetalTexture(
  size = 128,
  petalCount = 5,
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);

  const center = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Polar coordinates
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      // Petal pattern
      const petalAngle = Math.abs(Math.sin((angle * petalCount) / 2));
      const petalDist = 0.3 + petalAngle * 0.5;

      // Inside flower shape
      const inFlower = dist < petalDist;

      // Center dot
      const inCenter = dist < 0.15;

      // Alpha with soft edges
      let alpha = 0;
      if (inFlower) {
        const edgeDist = petalDist - dist;
        alpha = Math.min(1, edgeDist * 10);
      }

      // Color
      if (inCenter) {
        // Yellow center
        data[i + 0] = 255;
        data[i + 1] = 200;
        data[i + 2] = 50;
        data[i + 3] = 255;
      } else if (inFlower) {
        // White petals
        data[i + 0] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.floor(alpha * 255);
      } else {
        data[i + 0] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      }
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;

  return texture;
}
