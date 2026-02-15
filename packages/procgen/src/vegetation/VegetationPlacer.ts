/**
 * VegetationPlacer - Procedural Vegetation Placement
 *
 * Pure placement generator (no rendering dependencies) that can be used
 * by both runtime systems and editor tools.
 */

import type {
  VegetationAsset,
  VegetationLayer,
  BiomeVegetationConfig,
  VegetationPlacement,
  TileVegetationResult,
  VegetationTerrainProvider,
  RoadAvoidanceProvider,
  VegetationPlacerConfig,
  TileGenerationOptions,
  VegetationCategory,
} from "./types";
import { DEFAULT_PLACER_CONFIG } from "./types";
import { NoiseGenerator } from "../terrain/NoiseGenerator";

/** How many candidate positions to try per target placement */
const CANDIDATE_MULTIPLIER = 3;

/** Default noise parameters for placement filtering */
const DEFAULT_NOISE_SCALE = 0.05;
const DEFAULT_NOISE_THRESHOLD = 0.3;

/** Slope estimation sample distance */
const SLOPE_SAMPLE_DELTA = 1.0;

export class VegetationPlacer {
  private readonly config: VegetationPlacerConfig;
  private readonly noise: NoiseGenerator;
  private readonly terrain: VegetationTerrainProvider;
  private readonly roads: RoadAvoidanceProvider | null;
  private readonly assets = new Map<string, VegetationAsset>();
  private readonly biomeConfigs = new Map<string, BiomeVegetationConfig>();

  constructor(
    terrain: VegetationTerrainProvider,
    options: {
      config?: Partial<VegetationPlacerConfig>;
      roads?: RoadAvoidanceProvider;
      assets?: VegetationAsset[];
      biomeConfigs?: BiomeVegetationConfig[];
    } = {},
  ) {
    this.config = { ...DEFAULT_PLACER_CONFIG, ...options.config };
    this.noise = new NoiseGenerator(this.config.seed);
    this.terrain = terrain;
    this.roads = options.roads ?? null;

    options.assets?.forEach((a) => this.assets.set(a.id, a));
    options.biomeConfigs?.forEach((c) => this.biomeConfigs.set(c.biomeId, c));
  }

  getConfig(): VegetationPlacerConfig {
    return { ...this.config };
  }

  getTileSize(): number {
    return this.config.tileSize;
  }

  setAssets(assets: VegetationAsset[]): void {
    this.assets.clear();
    assets.forEach((a) => this.assets.set(a.id, a));
  }

  getAsset(id: string): VegetationAsset | undefined {
    return this.assets.get(id);
  }

  getAssetsByCategory(category: VegetationCategory): VegetationAsset[] {
    return [...this.assets.values()].filter((a) => a.category === category);
  }

  setBiomeConfigs(configs: BiomeVegetationConfig[]): void {
    this.biomeConfigs.clear();
    configs.forEach((c) => this.biomeConfigs.set(c.biomeId, c));
  }

  getBiomeConfig(biomeId: string): BiomeVegetationConfig | undefined {
    return this.biomeConfigs.get(biomeId);
  }

  /** Generate vegetation placements for a single tile */
  generateTile(options: TileGenerationOptions): TileVegetationResult {
    const { tileX, tileZ, categories } = options;
    const tileKey = `${tileX}_${tileZ}`;
    const { tileSize } = this.config;
    const tileWorldX = tileX * tileSize;
    const tileWorldZ = tileZ * tileSize;

    const biome =
      options.biome ??
      this.terrain.getBiomeAt(
        tileWorldX + tileSize / 2,
        tileWorldZ + tileSize / 2,
      );

    const biomeConfig = this.biomeConfigs.get(biome);
    if (!biomeConfig) {
      return { tileKey, tileX, tileZ, biome, placements: [] };
    }

    const placements = biomeConfig.layers
      .filter((layer) => !categories || categories.includes(layer.category))
      .flatMap((layer) =>
        this.generateLayerPlacements(
          tileKey,
          tileWorldX,
          tileWorldZ,
          tileSize,
          layer,
          biome,
        ),
      );

    return { tileKey, tileX, tileZ, biome, placements };
  }

  /** Generate vegetation for multiple tiles */
  generateTiles(
    tiles: Array<{ tileX: number; tileZ: number }>,
    categories?: VegetationCategory[],
  ): TileVegetationResult[] {
    return tiles.map(({ tileX, tileZ }) =>
      this.generateTile({ tileX, tileZ, categories }),
    );
  }

  /** Generate vegetation for a rectangular region */
  generateRegion(
    minTileX: number,
    minTileZ: number,
    maxTileX: number,
    maxTileZ: number,
    categories?: VegetationCategory[],
  ): TileVegetationResult[] {
    const results: TileVegetationResult[] = [];
    for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
      for (let tileZ = minTileZ; tileZ <= maxTileZ; tileZ++) {
        results.push(this.generateTile({ tileX, tileZ, categories }));
      }
    }
    return results;
  }

  private generateLayerPlacements(
    tileKey: string,
    tileWorldX: number,
    tileWorldZ: number,
    tileSize: number,
    layer: VegetationLayer,
    biome: string,
  ): VegetationPlacement[] {
    const placements: VegetationPlacement[] = [];

    // Create deterministic RNG for this tile/layer combination
    const rng = this.createTileLayerRng(tileKey, layer.category);

    // Get valid assets for this layer and biome
    const validAssets = this.getValidAssetsForLayer(layer, biome);
    if (validAssets.length === 0) {
      return placements;
    }

    // Calculate target instance count based on density
    const tileArea = (tileSize * tileSize) / (100 * 100); // Normalize to 100x100
    const targetCount = Math.floor(layer.density * tileArea);

    // Calculate total weight for weighted random selection
    const totalWeight = validAssets.reduce((sum, a) => sum + a.weight, 0);

    // Generate candidate positions
    const positions = this.generatePlacementPositions(
      tileWorldX,
      tileWorldZ,
      tileSize,
      targetCount,
      layer,
      rng,
    );

    // Get water threshold
    const waterThreshold =
      this.terrain.getWaterThreshold() + this.config.waterEdgeBuffer;

    // Place instances at valid positions
    let placedCount = 0;
    for (const pos of positions) {
      if (placedCount >= targetCount) break;

      // Get terrain height at position
      const height = this.terrain.getHeightAt(pos.x, pos.z);

      // Check height constraints
      if (layer.minHeight !== undefined && height < layer.minHeight) continue;
      if (layer.maxHeight !== undefined && height > layer.maxHeight) continue;

      // Check water avoidance
      const shouldAvoidWater = layer.avoidWater !== false;
      if (shouldAvoidWater && height < waterThreshold) {
        continue;
      }

      // Check road avoidance
      if (this.roads && this.roads.isOnRoad(pos.x, pos.z)) {
        continue;
      }

      // Calculate slope
      const slope = this.estimateSlope(pos.x, pos.z);

      // Check slope constraints
      if (layer.avoidSteepSlopes && slope > this.config.steepSlopeThreshold) {
        continue;
      }

      // Select asset based on weighted random
      const asset = this.selectWeightedAsset(validAssets, totalWeight, rng);
      if (!asset) continue;

      // Check asset-specific slope constraints
      if (asset.minSlope !== undefined && slope < asset.minSlope) continue;
      if (asset.maxSlope !== undefined && slope > asset.maxSlope) continue;

      // Calculate instance transform
      const scale =
        asset.baseScale *
        (asset.scaleVariation[0] +
          rng() * (asset.scaleVariation[1] - asset.scaleVariation[0]));

      const rotationY = asset.randomRotation ? rng() * Math.PI * 2 : 0;
      let rotationX = 0;
      let rotationZ = 0;

      // Align to terrain normal if requested
      if (asset.alignToNormal && this.terrain.getNormalAt) {
        const normal = this.terrain.getNormalAt(pos.x, pos.z);
        const angles = this.normalToRotation(normal);
        rotationX = angles.x;
        rotationZ = angles.z;
      }

      // Create placement
      const placement: VegetationPlacement = {
        id: `${tileKey}_${layer.category}_${placedCount}`,
        assetId: asset.id,
        category: layer.category,
        position: {
          x: pos.x,
          y: height + (asset.yOffset ?? 0),
          z: pos.z,
        },
        rotation: { x: rotationX, y: rotationY, z: rotationZ },
        scale,
        tileKey,
      };

      placements.push(placement);
      placedCount++;
    }

    return placements;
  }

  private generatePlacementPositions(
    tileWorldX: number,
    tileWorldZ: number,
    tileSize: number,
    targetCount: number,
    layer: VegetationLayer,
    rng: () => number,
  ): Array<{ x: number; z: number }> {
    const positions: Array<{ x: number; z: number }> = [];
    const noiseScale = layer.noiseScale ?? DEFAULT_NOISE_SCALE;
    const noiseThreshold = layer.noiseThreshold ?? DEFAULT_NOISE_THRESHOLD;
    const { minSpacing } = layer;
    const minSpacingSq = minSpacing * minSpacing;
    const maxCandidates = targetCount * CANDIDATE_MULTIPLIER;

    for (let i = 0; i < maxCandidates && positions.length < targetCount; i++) {
      let x: number;
      let z: number;

      if (layer.clustering && layer.clusterSize) {
        // Clustering: generate cluster centers, then scatter around them
        const clusterCount = Math.max(
          1,
          Math.floor(targetCount / layer.clusterSize),
        );
        const clusterIndex = Math.floor(rng() * clusterCount);

        // Deterministic cluster center
        const clusterRng = this.createTileLayerRng(
          `${tileWorldX}_${tileWorldZ}_cluster_${clusterIndex}`,
          layer.category,
        );
        const clusterCenterX =
          tileWorldX + tileSize * 0.1 + clusterRng() * tileSize * 0.8;
        const clusterCenterZ =
          tileWorldZ + tileSize * 0.1 + clusterRng() * tileSize * 0.8;

        // Scatter around cluster center with Gaussian-like distribution
        const angle = rng() * Math.PI * 2;
        const radius = rng() * rng() * minSpacing * layer.clusterSize;
        x = clusterCenterX + Math.cos(angle) * radius;
        z = clusterCenterZ + Math.sin(angle) * radius;
      } else {
        // Uniform random distribution
        x = tileWorldX + rng() * tileSize;
        z = tileWorldZ + rng() * tileSize;
      }

      // Ensure within tile bounds
      if (
        x < tileWorldX ||
        x >= tileWorldX + tileSize ||
        z < tileWorldZ ||
        z >= tileWorldZ + tileSize
      ) {
        continue;
      }

      // Noise-based filtering
      const noiseValue =
        (this.noise.perlin2D(x * noiseScale, z * noiseScale) + 1) / 2;
      if (noiseValue < noiseThreshold) continue;

      // Minimum spacing check
      const tooClose = positions.some(({ x: ex, z: ez }) => {
        const dx = ex - x,
          dz = ez - z;
        return dx * dx + dz * dz < minSpacingSq;
      });
      if (tooClose) continue;

      positions.push({ x, z });
    }

    return positions;
  }

  private getValidAssetsForLayer(
    layer: VegetationLayer,
    biome: string,
  ): VegetationAsset[] {
    return [...this.assets.values()].filter(
      (asset) =>
        asset.category === layer.category &&
        (!asset.biomes?.length || asset.biomes.includes(biome)),
    );
  }

  private selectWeightedAsset(
    assets: VegetationAsset[],
    totalWeight: number,
    rng: () => number,
  ): VegetationAsset | null {
    let random = rng() * totalWeight;
    for (const asset of assets) {
      random -= asset.weight;
      if (random <= 0) return asset;
    }
    return assets.at(-1) ?? null;
  }

  private estimateSlope(x: number, z: number): number {
    const d = SLOPE_SAMPLE_DELTA;
    const hN = this.terrain.getHeightAt(x, z - d);
    const hS = this.terrain.getHeightAt(x, z + d);
    const hE = this.terrain.getHeightAt(x + d, z);
    const hW = this.terrain.getHeightAt(x - d, z);
    const dhdx = (hE - hW) / (2 * d);
    const dhdz = (hS - hN) / (2 * d);
    return Math.sqrt(dhdx * dhdx + dhdz * dhdz);
  }

  private normalToRotation(n: { x: number; y: number; z: number }) {
    return { x: Math.atan2(n.z, n.y), y: 0, z: Math.atan2(-n.x, n.y) };
  }

  private createTileLayerRng(tileKey: string, category: string): () => number {
    const str = `${tileKey}_${category}_${this.config.seed}`;
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    let state = hash >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
  }
}
