/**
 * Impostor Baking Service
 *
 * Service for generating octahedral impostor atlases for animated entities
 * (mobs, characters, NPCs). These are billboard textures that replace 3D
 * models at distance for performance.
 *
 * Supports:
 * - VRM models (player characters, NPCs)
 * - GLB models (mobs, creatures)
 * - Batch baking with job tracking
 * - Metadata storage and retrieval
 *
 * The actual baking happens client-side (browser/worker with WebGL).
 * This service manages the metadata, storage, and coordination.
 */

import fs from "fs";
import path from "path";
import { glob } from "glob";
import type {
  ImpostorBakeRequest,
  BatchImpostorBakeRequest,
  ImpostorBakeResult,
  ImpostorBakeJob,
  ImpostorMetadata,
  OctahedralImpostorBakeConfig,
  LODBakeJobStatus,
} from "../../src/types/LODBundle";
import {
  DEFAULT_OCTAHEDRAL_IMPOSTER_CONFIG,
  DEFAULT_CATEGORY_LOD_SETTINGS,
  getCategoryDefaults,
} from "../../src/types/LODBundle";

// Re-export types
export type {
  ImpostorBakeRequest,
  BatchImpostorBakeRequest,
  ImpostorBakeResult,
  ImpostorBakeJob,
  ImpostorMetadata,
  OctahedralImpostorBakeConfig,
};

/**
 * Imposter registry - tracks all available imposters
 */
interface ImpostorRegistry {
  version: number;
  imposters: Record<string, ImpostorMetadata>;
  lastUpdated: string;
}

/**
 * Internal job with additional tracking
 */
interface InternalImpostorJob extends ImpostorBakeJob {
  /** Asset IDs to process */
  pendingAssets: string[];
  /** Config for this job */
  config: OctahedralImpostorBakeConfig;
}

/**
 * Model info extracted from NPCs manifest
 */
interface ModelInfo {
  id: string;
  name: string;
  category: string;
  modelPath: string;
}

export class ImpostorBakingService {
  private projectRoot: string;
  private assetsDir: string;
  private manifestsDir: string;
  private impostersDir: string;
  private registryPath: string;
  private cachedRegistry: ImpostorRegistry | null = null;
  private jobs: Map<string, InternalImpostorJob> = new Map();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.assetsDir = path.join(projectRoot, "assets");
    this.manifestsDir = path.join(this.assetsDir, "manifests");
    this.impostersDir = path.join(this.assetsDir, "imposters");
    this.registryPath = path.join(this.manifestsDir, "imposter-registry.json");
  }

  /**
   * Initialize the service - create directories if needed
   */
  async initialize(): Promise<void> {
    // Create imposters directory if it doesn't exist
    if (!fs.existsSync(this.impostersDir)) {
      await fs.promises.mkdir(this.impostersDir, { recursive: true });
    }

    // Create manifests directory if it doesn't exist
    if (!fs.existsSync(this.manifestsDir)) {
      await fs.promises.mkdir(this.manifestsDir, { recursive: true });
    }

    // Initialize registry if it doesn't exist
    const registryFile = Bun.file(this.registryPath);
    if (!(await registryFile.exists())) {
      const emptyRegistry: ImpostorRegistry = {
        version: 1,
        imposters: {},
        lastUpdated: new Date().toISOString(),
      };
      await Bun.write(
        this.registryPath,
        JSON.stringify(emptyRegistry, null, 2),
      );
    }
  }

  /**
   * Get the imposter registry
   */
  async getRegistry(): Promise<ImpostorRegistry> {
    if (this.cachedRegistry) {
      return this.cachedRegistry;
    }

    const registryFile = Bun.file(this.registryPath);
    if (await registryFile.exists()) {
      this.cachedRegistry = (await registryFile.json()) as ImpostorRegistry;
      return this.cachedRegistry;
    }

    // Return empty registry
    return {
      version: 1,
      imposters: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Save imposter metadata to registry
   */
  async saveImposterMetadata(metadata: ImpostorMetadata): Promise<void> {
    const registry = await this.getRegistry();
    registry.imposters[metadata.assetId] = metadata;
    registry.lastUpdated = new Date().toISOString();

    await Bun.write(this.registryPath, JSON.stringify(registry, null, 2));
    this.cachedRegistry = registry;

    // Also save individual metadata file alongside the atlas
    const metadataPath = metadata.atlasPath.replace(/\.png$/, ".json");
    await Bun.write(
      path.join(this.projectRoot, metadataPath),
      JSON.stringify(metadata, null, 2),
    );
  }

  /**
   * Get imposter metadata for an asset
   */
  async getImposterMetadata(assetId: string): Promise<ImpostorMetadata | null> {
    const registry = await this.getRegistry();
    return registry.imposters[assetId] || null;
  }

  /**
   * Get all imposter metadata
   */
  async getAllImposters(): Promise<ImpostorMetadata[]> {
    const registry = await this.getRegistry();
    return Object.values(registry.imposters);
  }

  /**
   * Check if an imposter exists and is up to date
   */
  async hasValidImposter(assetId: string, modelPath: string): Promise<boolean> {
    const metadata = await this.getImposterMetadata(assetId);
    if (!metadata) return false;

    // Check if atlas file exists
    const atlasFullPath = path.join(this.projectRoot, metadata.atlasPath);
    if (!fs.existsSync(atlasFullPath)) return false;

    // Check if model path matches (imposter was baked from correct model)
    if (metadata.modelPath !== modelPath) return false;

    return true;
  }

  /**
   * Get the output path for an imposter atlas
   */
  getImpostorOutputPath(assetId: string, category: string): string {
    const categoryDir = path.join(this.impostersDir, category);
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }
    return path.join(
      "assets",
      "imposters",
      category,
      `${assetId}_imposter.png`,
    );
  }

  /**
   * Get all available models that can have imposters baked
   * Reads from NPCs manifest and looks for VRM/GLB models
   */
  async discoverModels(categories?: string[]): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];

    // Load NPCs manifest
    const npcsPath = path.join(this.manifestsDir, "npcs.json");
    const npcsFile = Bun.file(npcsPath);

    if (await npcsFile.exists()) {
      const npcsData = (await npcsFile.json()) as Array<{
        id: string;
        name: string;
        category?: string;
        appearance?: { modelPath?: string };
        modelArchetype?: string;
      }>;

      for (const npc of npcsData) {
        const modelPath = npc.appearance?.modelPath;
        if (!modelPath) continue;

        // Determine category from NPC data
        let category = "npc";
        if (npc.category === "mob" || npc.category === "boss") {
          category = "mob";
        } else if (npc.category === "neutral" || npc.category === "quest") {
          category = "npc";
        }

        // Filter by requested categories
        if (
          categories &&
          categories.length > 0 &&
          !categories.includes(category)
        ) {
          continue;
        }

        models.push({
          id: npc.id,
          name: npc.name,
          category,
          modelPath,
        });
      }
    }

    // Also look for avatar models
    const avatarsPath = path.join(this.manifestsDir, "avatars.json");
    const avatarsFile = Bun.file(avatarsPath);

    if (await avatarsFile.exists()) {
      const avatarsData = (await avatarsFile.json()) as Array<{
        id: string;
        name: string;
        url: string;
      }>;

      for (const avatar of avatarsData) {
        if (
          !categories ||
          categories.length === 0 ||
          categories.includes("character")
        ) {
          models.push({
            id: avatar.id,
            name: avatar.name,
            category: "character",
            modelPath: avatar.url,
          });
        }
      }
    }

    // Scan for VRM/GLB files in models directory
    const modelPatterns = [
      "assets/models/**/*.vrm",
      "assets/models/**/*.glb",
      "assets/mobs/**/*.vrm",
      "assets/mobs/**/*.glb",
      "assets/avatars/**/*.vrm",
    ];

    for (const pattern of modelPatterns) {
      const files = await glob(pattern, {
        cwd: this.projectRoot,
        ignore: ["**/*_lod*.glb", "**/*_imposter*"],
      });

      for (const file of files) {
        const assetId = path.basename(file, path.extname(file));

        // Skip if already added from manifests
        if (models.some((m) => m.id === assetId)) continue;

        // Infer category from path
        let category = "mob";
        if (file.includes("avatar")) category = "character";
        else if (file.includes("npc")) category = "npc";

        if (
          categories &&
          categories.length > 0 &&
          !categories.includes(category)
        ) {
          continue;
        }

        models.push({
          id: assetId,
          name: assetId.replace(/_/g, " "),
          category,
          modelPath: `asset://${file}`,
        });
      }
    }

    return models;
  }

  /**
   * Get discovery data for the UI - shows all models with their imposter status
   */
  async discoverAssetsWithStatus(categories?: string[]): Promise<
    Array<{
      assetId: string;
      name: string;
      category: string;
      modelPath: string;
      hasImposter: boolean;
      imposterPath?: string;
      generatedAt?: string;
      config?: Partial<OctahedralImpostorBakeConfig>;
    }>
  > {
    const models = await this.discoverModels(categories);
    const registry = await this.getRegistry();

    return models.map((model) => {
      const metadata = registry.imposters[model.id];
      return {
        assetId: model.id,
        name: model.name,
        category: model.category,
        modelPath: model.modelPath,
        hasImposter: !!metadata,
        imposterPath: metadata?.atlasPath,
        generatedAt: metadata?.generatedAt,
        config: metadata
          ? {
              atlasWidth: metadata.atlasWidth,
              atlasHeight: metadata.atlasHeight,
              gridSizeX: metadata.gridSizeX,
              gridSizeY: metadata.gridSizeY,
              octType: metadata.octType,
            }
          : undefined,
      };
    });
  }

  /**
   * Get bake config for a category, merging defaults with overrides
   */
  getBakeConfig(
    category: string,
    overrides?: Partial<OctahedralImpostorBakeConfig>,
  ): OctahedralImpostorBakeConfig {
    const categoryDefaults = getCategoryDefaults(category);
    const imposterConfig = categoryDefaults.imposter;

    // Build config from category defaults
    const baseConfig: OctahedralImpostorBakeConfig = {
      atlasWidth: imposterConfig.resolution * 8, // 8 views wide
      atlasHeight: imposterConfig.resolution * 8, // 8 views tall
      gridSizeX: imposterConfig.viewCount || 8,
      gridSizeY: imposterConfig.viewCount || 8,
      octType: imposterConfig.type === "octahedral" ? "HEMI" : "HEMI",
      backgroundColor: 0x000000,
      backgroundAlpha: 0,
    };

    return { ...baseConfig, ...overrides };
  }

  /**
   * Start a batch imposter baking job
   * Returns a job ID that can be used to track progress
   */
  async startBatchBakeJob(
    request: BatchImpostorBakeRequest,
  ): Promise<ImpostorBakeJob> {
    const jobId = crypto.randomUUID();

    // Get models to bake
    let models: ModelInfo[];
    if (request.assetIds && request.assetIds.length > 0) {
      const allModels = await this.discoverModels(request.categories);
      models = allModels.filter((m) => request.assetIds!.includes(m.id));
    } else {
      models = await this.discoverModels(request.categories);
    }

    // Filter out models that already have valid imposters (unless force)
    if (!request.force) {
      const validModels: ModelInfo[] = [];
      for (const model of models) {
        const hasValid = await this.hasValidImposter(model.id, model.modelPath);
        if (!hasValid) {
          validModels.push(model);
        }
      }
      models = validModels;
    }

    if (models.length === 0) {
      const job: InternalImpostorJob = {
        jobId,
        status: "completed",
        progress: 100,
        totalAssets: 0,
        processedAssets: 0,
        results: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        pendingAssets: [],
        config: DEFAULT_OCTAHEDRAL_IMPOSTER_CONFIG,
      };
      this.jobs.set(jobId, job);
      return this.sanitizeJob(job);
    }

    // Get config for first model's category (can be overridden per-asset)
    const config = this.getBakeConfig(models[0].category, request.config);

    const job: InternalImpostorJob = {
      jobId,
      status: "queued",
      progress: 0,
      totalAssets: models.length,
      processedAssets: 0,
      results: [],
      startedAt: new Date().toISOString(),
      pendingAssets: models.map((m) => m.id),
      config,
    };

    this.jobs.set(jobId, job);

    console.log(
      `[ImpostorBaking] Started job ${jobId} with ${models.length} assets`,
    );

    return this.sanitizeJob(job);
  }

  /**
   * Get the next asset to bake for a job
   * Called by the client to get work items
   */
  async getNextBakeTask(jobId: string): Promise<{
    assetId: string;
    modelPath: string;
    category: string;
    config: OctahedralImpostorBakeConfig;
    outputPath: string;
  } | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.status === "completed" || job.status === "failed") {
      return null;
    }

    if (job.pendingAssets.length === 0) {
      return null;
    }

    // Mark job as running
    job.status = "running";

    // Get next asset
    const assetId = job.pendingAssets[0];
    job.currentAsset = assetId;

    // Get model info
    const models = await this.discoverModels();
    const model = models.find((m) => m.id === assetId);
    if (!model) {
      // Skip this asset
      job.pendingAssets.shift();
      job.processedAssets++;
      job.results.push({
        assetId,
        success: false,
        error: "Model not found",
        duration: 0,
      });
      return this.getNextBakeTask(jobId);
    }

    const config = this.getBakeConfig(model.category, job.config);
    const outputPath = this.getImpostorOutputPath(assetId, model.category);

    return {
      assetId,
      modelPath: model.modelPath,
      category: model.category,
      config,
      outputPath,
    };
  }

  /**
   * Report a bake result from the client
   */
  async reportBakeResult(
    jobId: string,
    result: ImpostorBakeResult,
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Remove from pending
    const idx = job.pendingAssets.indexOf(result.assetId);
    if (idx !== -1) {
      job.pendingAssets.splice(idx, 1);
    }

    // Add to results
    job.results.push(result);
    job.processedAssets++;
    job.progress = (job.processedAssets / job.totalAssets) * 100;
    job.currentAsset = undefined;

    // Save metadata if successful
    if (result.success && result.metadata) {
      await this.saveImposterMetadata(result.metadata);
      console.log(`[ImpostorBaking] Saved imposter for ${result.assetId}`);
    }

    // Check if job is complete
    if (job.pendingAssets.length === 0) {
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      console.log(`[ImpostorBaking] Job ${jobId} completed`);
    }
  }

  /**
   * Save atlas image from client
   * The client sends the PNG data after baking
   */
  async saveAtlasImage(
    assetId: string,
    category: string,
    imageData: Buffer | Uint8Array,
  ): Promise<string> {
    const outputPath = this.getImpostorOutputPath(assetId, category);
    const fullPath = path.join(this.projectRoot, outputPath);

    // Ensure directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    await Bun.write(fullPath, imageData);
    console.log(`[ImpostorBaking] Saved atlas to ${outputPath}`);

    return outputPath;
  }

  /**
   * Create metadata for a baked imposter
   */
  createMetadata(
    assetId: string,
    category: string,
    modelPath: string,
    config: OctahedralImpostorBakeConfig,
    boundingSphere: { radius: number; centerY: number },
    atlasPath: string,
    animationName: string = "idle",
    animationFrame: number = 0.25,
  ): ImpostorMetadata {
    return {
      assetId,
      category,
      modelPath,
      gridSizeX: config.gridSizeX,
      gridSizeY: config.gridSizeY,
      octType: config.octType,
      atlasWidth: config.atlasWidth,
      atlasHeight: config.atlasHeight,
      boundingSphereRadius: boundingSphere.radius,
      boundingSphereCenterY: boundingSphere.centerY,
      animationFrame,
      animationName,
      atlasPath,
      generatedAt: new Date().toISOString(),
      version: 1,
    };
  }

  /**
   * Get job status
   */
  getJob(jobId: string): ImpostorBakeJob | null {
    const job = this.jobs.get(jobId);
    return job ? this.sanitizeJob(job) : null;
  }

  /**
   * Cancel a running job
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status === "completed" || job.status === "cancelled") {
      return false;
    }

    job.status = "cancelled";
    job.error = "Job cancelled by user";
    job.completedAt = new Date().toISOString();
    return true;
  }

  /**
   * List all jobs
   */
  listJobs(): ImpostorBakeJob[] {
    return Array.from(this.jobs.values()).map((job) => this.sanitizeJob(job));
  }

  /**
   * Clean up completed jobs older than maxAge
   */
  cleanupOldJobs(maxAge: number = 3600000): void {
    const now = Date.now();
    for (const [jobId, job] of this.jobs.entries()) {
      if (
        (job.status === "completed" ||
          job.status === "failed" ||
          job.status === "cancelled") &&
        job.completedAt
      ) {
        const completedTime = new Date(job.completedAt).getTime();
        if (now - completedTime > maxAge) {
          this.jobs.delete(jobId);
        }
      }
    }
  }

  /**
   * Remove internal fields from job for external use
   */
  private sanitizeJob(job: InternalImpostorJob): ImpostorBakeJob {
    const { pendingAssets, config, ...sanitized } = job;
    return sanitized;
  }

  /**
   * Delete an imposter and its metadata
   */
  async deleteImposter(assetId: string): Promise<boolean> {
    const metadata = await this.getImposterMetadata(assetId);
    if (!metadata) return false;

    // Delete atlas file
    const atlasFullPath = path.join(this.projectRoot, metadata.atlasPath);
    if (fs.existsSync(atlasFullPath)) {
      await fs.promises.unlink(atlasFullPath);
    }

    // Delete metadata file
    const metadataPath = metadata.atlasPath.replace(/\.png$/, ".json");
    const metadataFullPath = path.join(this.projectRoot, metadataPath);
    if (fs.existsSync(metadataFullPath)) {
      await fs.promises.unlink(metadataFullPath);
    }

    // Remove from registry
    const registry = await this.getRegistry();
    delete registry.imposters[assetId];
    registry.lastUpdated = new Date().toISOString();
    await Bun.write(this.registryPath, JSON.stringify(registry, null, 2));
    this.cachedRegistry = registry;

    return true;
  }

  /**
   * Get statistics about imposters
   */
  async getStats(): Promise<{
    totalImposters: number;
    byCategory: Record<string, number>;
    totalSize: number;
    oldestImposter?: string;
    newestImposter?: string;
  }> {
    const registry = await this.getRegistry();
    const imposters = Object.values(registry.imposters);

    const byCategory: Record<string, number> = {};
    let totalSize = 0;
    let oldest: string | undefined;
    let newest: string | undefined;
    let oldestDate = Infinity;
    let newestDate = 0;

    for (const imposter of imposters) {
      // Count by category
      byCategory[imposter.category] = (byCategory[imposter.category] || 0) + 1;

      // Calculate total size
      const atlasPath = path.join(this.projectRoot, imposter.atlasPath);
      if (fs.existsSync(atlasPath)) {
        const stat = await fs.promises.stat(atlasPath);
        totalSize += stat.size;
      }

      // Track oldest/newest
      const date = new Date(imposter.generatedAt).getTime();
      if (date < oldestDate) {
        oldestDate = date;
        oldest = imposter.assetId;
      }
      if (date > newestDate) {
        newestDate = date;
        newest = imposter.assetId;
      }
    }

    return {
      totalImposters: imposters.length,
      byCategory,
      totalSize,
      oldestImposter: oldest,
      newestImposter: newest,
    };
  }
}
