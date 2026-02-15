/**
 * Biome System
 *
 * Handles biome placement and influence calculations for terrain generation.
 * Implements a grid-jitter placement system with Gaussian influence falloff
 * for smooth, natural biome transitions.
 */

import { NoiseGenerator, createSeededRNG } from "./NoiseGenerator";
import type {
  BiomeConfig,
  BiomeCenter,
  BiomeInfluence,
  BiomeDefinition,
} from "./types";

/** Numeric biome IDs for shader use */
export const BIOME_IDS: Record<string, number> = {
  plains: 0,
  forest: 1,
  valley: 2,
  mountains: 3,
  tundra: 4,
  desert: 5,
  lakes: 6,
  swamp: 7,
};

/** Default biome definitions (can be overridden) */
export const DEFAULT_BIOMES: Record<string, BiomeDefinition> = {
  plains: {
    id: "plains",
    name: "Plains",
    color: 0x7cba5f,
    terrainMultiplier: 1.0,
    difficultyLevel: 0,
    heightRange: [0.1, 0.5],
    resourceDensity: 1.0,
  },
  forest: {
    id: "forest",
    name: "Forest",
    color: 0x2f7d32,
    terrainMultiplier: 1.1,
    difficultyLevel: 1,
    heightRange: [0.2, 0.6],
    resourceDensity: 1.5,
  },
  valley: {
    id: "valley",
    name: "Valley",
    color: 0x6b8e23,
    terrainMultiplier: 0.8,
    difficultyLevel: 1,
    heightRange: [0.05, 0.3],
    resourceDensity: 1.2,
  },
  mountains: {
    id: "mountains",
    name: "Mountains",
    color: 0x808080,
    terrainMultiplier: 1.5,
    difficultyLevel: 3,
    heightRange: [0.5, 1.0],
    maxSlope: 0.9,
    resourceDensity: 0.7,
  },
  desert: {
    id: "desert",
    name: "Desert",
    color: 0xdaa520,
    terrainMultiplier: 0.9,
    difficultyLevel: 2,
    heightRange: [0.1, 0.4],
    resourceDensity: 0.3,
  },
  swamp: {
    id: "swamp",
    name: "Swamp",
    color: 0x556b2f,
    terrainMultiplier: 0.7,
    difficultyLevel: 2,
    heightRange: [0.0, 0.25],
    resourceDensity: 0.8,
  },
  tundra: {
    id: "tundra",
    name: "Tundra",
    color: 0xb0c4de,
    terrainMultiplier: 1.0,
    difficultyLevel: 3,
    heightRange: [0.3, 0.8],
    resourceDensity: 0.4,
  },
  lakes: {
    id: "lakes",
    name: "Lakes",
    color: 0x4682b4,
    terrainMultiplier: 0.5,
    difficultyLevel: 1,
    heightRange: [0.0, 0.15],
    resourceDensity: 0.5,
  },
};

/**
 * Default biome configuration
 */
export const DEFAULT_BIOME_CONFIG: BiomeConfig = {
  gridSize: 3,
  jitter: 0.35,
  minInfluence: 2000,
  maxInfluence: 3500,
  gaussianCoeff: 0.15,
  boundaryNoiseScale: 0.003,
  boundaryNoiseAmount: 0.15,
  mountainHeightThreshold: 0.4,
  mountainWeightBoost: 2.0,
  valleyHeightThreshold: 0.4,
  valleyWeightBoost: 1.5,
  mountainHeightBoost: 0.5,
};

/**
 * Weighted biome types for random selection
 * Plains is dominant with variety from other biomes
 */
const BIOME_TYPE_WEIGHTS = [
  "plains",
  "plains",
  "plains",
  "forest",
  "forest",
  "valley",
  "mountains",
  "mountains",
  "desert",
  "swamp",
  "tundra",
];

/**
 * BiomeSystem handles biome placement and influence calculations
 */
export class BiomeSystem {
  private readonly config: BiomeConfig;
  private readonly biomeDefinitions: Record<string, BiomeDefinition>;
  private readonly noise: NoiseGenerator;
  private readonly worldSize: number;
  private biomeCenters: BiomeCenter[] = [];

  constructor(
    seed: number,
    worldSizeMeters: number,
    config: Partial<BiomeConfig> = {},
    biomeDefinitions: Record<string, BiomeDefinition> = DEFAULT_BIOMES,
  ) {
    this.config = { ...DEFAULT_BIOME_CONFIG, ...config };
    this.biomeDefinitions = biomeDefinitions;
    this.noise = new NoiseGenerator(seed);
    this.worldSize = worldSizeMeters;

    this.initializeBiomeCenters(seed);
  }

  /**
   * Initialize biome centers using deterministic grid-jitter placement
   */
  private initializeBiomeCenters(seed: number): void {
    const { gridSize, jitter, minInfluence, maxInfluence } = this.config;
    const cellSize = this.worldSize / gridSize;

    // Use deterministic PRNG for reproducible biome placement
    const random = createSeededRNG(seed);

    this.biomeCenters = [];

    // Grid-jitter placement for even distribution
    for (let gx = 0; gx < gridSize; gx++) {
      for (let gz = 0; gz < gridSize; gz++) {
        // Base position at grid cell center
        const baseX = (gx + 0.5) * cellSize - this.worldSize / 2;
        const baseZ = (gz + 0.5) * cellSize - this.worldSize / 2;

        // Jitter within cell (controlled randomness)
        const jitterX = (random() - 0.5) * 2 * jitter * cellSize;
        const jitterZ = (random() - 0.5) * 2 * jitter * cellSize;

        const x = baseX + jitterX;
        const z = baseZ + jitterZ;

        // Random biome type and influence
        const typeIndex = Math.floor(random() * BIOME_TYPE_WEIGHTS.length);
        const influenceRange = maxInfluence - minInfluence;
        const influence = minInfluence + random() * influenceRange;

        this.biomeCenters.push({
          x,
          z,
          type: BIOME_TYPE_WEIGHTS[typeIndex],
          influence,
        });
      }
    }
  }

  /**
   * Get all biome centers
   */
  getBiomeCenters(): ReadonlyArray<BiomeCenter> {
    return this.biomeCenters;
  }

  /**
   * Get biome definition by ID
   */
  getBiomeDefinition(biomeId: string): BiomeDefinition {
    return this.biomeDefinitions[biomeId] ?? this.biomeDefinitions["plains"];
  }

  /**
   * Get all biome definitions
   */
  getAllBiomeDefinitions(): Record<string, BiomeDefinition> {
    return this.biomeDefinitions;
  }

  /**
   * Calculate biome influences at a world position
   * Returns all biomes with their normalized weights (sum to 1.0)
   *
   * @param worldX - World X coordinate
   * @param worldZ - World Z coordinate
   * @param baseHeight - Normalized base height (0-1) for height-biome coupling
   */
  getBiomeInfluencesAtPosition(
    worldX: number,
    worldZ: number,
    baseHeight: number,
  ): BiomeInfluence[] {
    const {
      gaussianCoeff,
      boundaryNoiseScale,
      boundaryNoiseAmount,
      mountainHeightThreshold,
      mountainWeightBoost,
      valleyHeightThreshold,
      valleyWeightBoost,
    } = this.config;

    // Add boundary noise for organic edges
    const boundaryNoise = this.noise.simplex2D(
      worldX * boundaryNoiseScale,
      worldZ * boundaryNoiseScale,
    );

    // Map to collect and merge same-type biomes
    const biomeWeightMap = new Map<string, number>();

    // Calculate influence from ALL biome centers (no hard cutoff)
    for (const center of this.biomeCenters) {
      const dx = worldX - center.x;
      const dz = worldZ - center.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      // Add subtle noise to distance for organic boundaries
      const noisyDistance =
        distance * (1 + boundaryNoise * boundaryNoiseAmount);

      // Pure Gaussian falloff - NO hard distance cutoff
      // The gaussian naturally approaches 0 at large distances
      const normalizedDistance = noisyDistance / center.influence;
      let weight = Math.exp(
        -normalizedDistance * normalizedDistance * gaussianCoeff,
      );

      // Height-based weight adjustments
      if (center.type === "mountains" && baseHeight > mountainHeightThreshold) {
        const heightFactor = baseHeight - mountainHeightThreshold;
        weight *= 1.0 + heightFactor * mountainWeightBoost;
      }

      if (
        (center.type === "valley" || center.type === "plains") &&
        baseHeight < valleyHeightThreshold
      ) {
        const heightFactor = valleyHeightThreshold - baseHeight;
        weight *= 1.0 + heightFactor * valleyWeightBoost;
      }

      // Merge same-type biomes
      const existing = biomeWeightMap.get(center.type) ?? 0;
      biomeWeightMap.set(center.type, existing + weight);
    }

    // Convert map to array
    const biomeInfluences: BiomeInfluence[] = [];
    for (const [type, weight] of biomeWeightMap) {
      biomeInfluences.push({ type, weight });
    }

    // Normalize weights
    const totalWeight = biomeInfluences.reduce((sum, b) => sum + b.weight, 0);
    if (totalWeight > 0) {
      for (const influence of biomeInfluences) {
        influence.weight /= totalWeight;
      }
    } else {
      // Fallback to plains if no biome centers are nearby
      biomeInfluences.push({ type: "plains", weight: 1.0 });
    }

    // Sort by weight descending
    biomeInfluences.sort((a, b) => b.weight - a.weight);

    return biomeInfluences;
  }

  /**
   * Get the dominant biome at a world position
   */
  getDominantBiome(worldX: number, worldZ: number, baseHeight: number): string {
    const influences = this.getBiomeInfluencesAtPosition(
      worldX,
      worldZ,
      baseHeight,
    );
    return influences.length > 0 ? influences[0].type : "plains";
  }

  /**
   * Get the dominant biome for a terrain tile (at tile center)
   */
  getBiomeForTile(tileX: number, tileZ: number, tileSize: number): string {
    // Get world coordinates for center of tile
    const worldX = tileX * tileSize + tileSize / 2;
    const worldZ = tileZ * tileSize + tileSize / 2;

    // Use mid-range height for tile-level biome query
    return this.getDominantBiome(worldX, worldZ, 0.5);
  }

  /**
   * Apply mountain height boost based on biome influence
   * Call this after getting base height to add mountain elevation
   */
  applyMountainHeightBoost(
    worldX: number,
    worldZ: number,
    baseHeightNormalized: number,
  ): number {
    const { mountainHeightBoost } = this.config;

    let maxBoost = 0;

    for (const center of this.biomeCenters) {
      if (center.type === "mountains") {
        const dx = worldX - center.x;
        const dz = worldZ - center.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const normalizedDist = distance / center.influence;

        if (normalizedDist < 2.5) {
          // Smooth boost that peaks at center and fades out
          const boost = Math.exp(-normalizedDist * normalizedDist * 0.3);
          maxBoost = Math.max(maxBoost, boost);
        }
      }
    }

    // Apply mountain height boost
    const boostedHeight =
      baseHeightNormalized * (1 + maxBoost * mountainHeightBoost);
    return Math.min(1, boostedHeight);
  }

  /** @deprecated Use exported BIOME_IDS constant instead */
  static readonly BIOME_IDS = BIOME_IDS;

  /** Get numeric biome ID for shader use */
  getBiomeId(biomeName: string): number {
    const id = BIOME_IDS[biomeName];
    if (id === undefined) {
      throw new Error(
        `[BiomeSystem] Unknown biome name: ${biomeName}. Add to BIOME_IDS.`,
      );
    }
    return id;
  }

  /**
   * Blend multiple biome colors based on influences
   * @returns RGB color (0-1 range)
   */
  blendBiomeColors(influences: BiomeInfluence[]): {
    r: number;
    g: number;
    b: number;
  } {
    let r = 0;
    let g = 0;
    let b = 0;

    for (const influence of influences) {
      const biome = this.getBiomeDefinition(influence.type);
      const color = biome.color;

      // Extract RGB from hex
      const biomeR = ((color >> 16) & 0xff) / 255;
      const biomeG = ((color >> 8) & 0xff) / 255;
      const biomeB = (color & 0xff) / 255;

      r += biomeR * influence.weight;
      g += biomeG * influence.weight;
      b += biomeB * influence.weight;
    }

    return { r, g, b };
  }
}
