/**
 * VAT Baking Service
 * Service for generating Vertex Animation Textures (VAT) for animated mobs
 *
 * VAT encodes per-frame skinned vertex positions into a texture, enabling
 * GPU-driven animation without CPU skeleton updates.
 */

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { glob } from "glob";

// VAT animation info
export interface VATAnimationInfo {
  name: string;
  frames: number;
  startFrame: number;
  duration: number;
  loop: boolean;
}

// VAT bake result for a single model
export interface VATBakeModelResult {
  modelName: string;
  vertexCount: number;
  totalFrames: number;
  textureWidth: number;
  textureHeight: number;
  animations: VATAnimationInfo[];
  outputPath?: string;
  error?: string;
}

// Bake job status
export type VATBakeJobStatus = "queued" | "running" | "completed" | "failed";

// Full bake job
export interface VATBakeJob {
  jobId: string;
  status: VATBakeJobStatus;
  progress: number;
  totalModels: number;
  processedModels: number;
  currentModel?: string;
  results: VATBakeModelResult[];
  error?: string;
  startedAt: string;
  completedAt?: string;
  process?: ChildProcess;
}

// VAT bake options
export interface VATBakeOptions {
  fps: number;
  maxFrames: number;
  outputFormat: "bin" | "ktx2";
  dryRun: boolean;
}

const DEFAULT_VAT_OPTIONS: VATBakeOptions = {
  fps: 30,
  maxFrames: 30,
  outputFormat: "bin",
  dryRun: false,
};

export class VATBakingService {
  private projectRoot: string;
  private scriptsDir: string;
  private assetsDir: string;
  private modelsDir: string;
  private vatOutputDir: string;
  private jobs: Map<string, VATBakeJob> = new Map();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.scriptsDir = path.join(projectRoot, "scripts");
    this.assetsDir = path.join(projectRoot, "assets");
    this.modelsDir = path.join(this.assetsDir, "models");
    this.vatOutputDir = path.join(this.assetsDir, "vat");
  }

  /**
   * Find mob models to bake
   */
  async findMobModels(
    modelPaths?: string[],
    mobIds?: string[],
  ): Promise<string[]> {
    if (modelPaths && modelPaths.length > 0) {
      // Use provided paths
      const absolutePaths: string[] = [];
      for (const p of modelPaths) {
        const fullPath = path.isAbsolute(p)
          ? p
          : path.join(this.projectRoot, p);
        if (await Bun.file(fullPath).exists()) {
          absolutePaths.push(fullPath);
        }
      }
      return absolutePaths;
    }

    // Find all rigged models (GLB/GLTF/VRM) in the models directory
    const patterns = [
      "assets/models/**/*_rigged.glb",
      "assets/models/**/*_rigged.gltf",
      "assets/models/**/*.vrm",
    ];

    const allFiles: string[] = [];

    for (const pattern of patterns) {
      const files = await glob(pattern, {
        cwd: this.projectRoot,
        ignore: ["**/*_lod1.glb", "**/*_lod.glb"],
      });

      for (const file of files) {
        const fullPath = path.join(this.projectRoot, file);

        // Filter by mob ID if specified
        if (mobIds && mobIds.length > 0) {
          const modelName = path
            .basename(file, path.extname(file))
            .replace(/_rigged$/, "");
          if (!mobIds.includes(modelName)) {
            continue;
          }
        }

        allFiles.push(fullPath);
      }
    }

    return allFiles;
  }

  /**
   * Read NPCs manifest to get mob model paths
   */
  async getMobModelPaths(): Promise<Map<string, string>> {
    const npcsPath = path.join(this.assetsDir, "manifests", "npcs.json");
    const npcsFile = Bun.file(npcsPath);

    if (!(await npcsFile.exists())) {
      return new Map();
    }

    const npcs = (await npcsFile.json()) as Array<{
      id: string;
      appearance?: { modelPath?: string };
    }>;

    const mobPaths = new Map<string, string>();

    for (const npc of npcs) {
      if (npc.appearance?.modelPath) {
        // Convert asset:// URL to file path
        const modelPath = npc.appearance.modelPath
          .replace(/^asset:\/\//, "")
          .replace(/^\//, "");
        mobPaths.set(npc.id, path.join(this.assetsDir, modelPath));
      }
    }

    return mobPaths;
  }

  /**
   * Start a VAT baking job
   */
  async startBakeJob(
    modelPaths?: string[],
    mobIds?: string[],
    options: Partial<VATBakeOptions> = {},
  ): Promise<VATBakeJob> {
    const opts = { ...DEFAULT_VAT_OPTIONS, ...options };
    const jobId = crypto.randomUUID();

    // Find models to bake
    let models: string[];
    if (mobIds && mobIds.length > 0) {
      const mobModelPaths = await this.getMobModelPaths();
      models = mobIds
        .map((id) => mobModelPaths.get(id))
        .filter((p): p is string => !!p);
    } else {
      models = await this.findMobModels(modelPaths);
    }

    if (models.length === 0) {
      const job: VATBakeJob = {
        jobId,
        status: "failed",
        progress: 0,
        totalModels: 0,
        processedModels: 0,
        results: [],
        error: "No models found to process",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      this.jobs.set(jobId, job);
      return job;
    }

    const job: VATBakeJob = {
      jobId,
      status: "queued",
      progress: 0,
      totalModels: models.length,
      processedModels: 0,
      results: [],
      startedAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);

    // Start baking in background
    this.runBakeProcess(job, models, opts);

    return job;
  }

  /**
   * Run the VAT baking process
   */
  private async runBakeProcess(
    job: VATBakeJob,
    models: string[],
    options: VATBakeOptions,
  ): Promise<void> {
    job.status = "running";

    // Ensure output directory exists
    await fs.promises.mkdir(this.vatOutputDir, { recursive: true });

    const scriptPath = path.join(this.scriptsDir, "bake-mob-vat.mjs");

    // Process each model sequentially
    for (let i = 0; i < models.length; i++) {
      const modelPath = models[i];
      job.currentModel = path.basename(modelPath);

      console.log(
        `[VATBaking] Processing ${i + 1}/${models.length}: ${job.currentModel}`,
      );

      const result = await this.bakeModel(modelPath, options);
      job.results.push(result);

      job.processedModels++;
      job.progress = (job.processedModels / job.totalModels) * 100;
    }

    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.currentModel = undefined;

    console.log(
      `[VATBaking] Job ${job.jobId} completed: ${job.results.length} models processed`,
    );
  }

  /**
   * Bake a single model
   */
  private async bakeModel(
    modelPath: string,
    options: VATBakeOptions,
  ): Promise<VATBakeModelResult> {
    const modelName = path
      .basename(modelPath, path.extname(modelPath))
      .replace(/_rigged$/, "");

    const scriptPath = path.join(this.scriptsDir, "bake-mob-vat.mjs");

    return new Promise((resolve) => {
      const args = [
        scriptPath,
        "--input",
        modelPath,
        "--output",
        this.vatOutputDir,
        "--fps",
        options.fps.toString(),
        "--max-frames",
        options.maxFrames.toString(),
      ];

      if (options.dryRun) {
        args.push("--dry-run");
      }

      let stdout = "";
      let stderr = "";

      const process = spawn("node", args, {
        cwd: this.projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });

      process.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      process.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      process.on("close", (code: number | null) => {
        if (code === 0) {
          // Parse results from output
          const result = this.parseVATResult(modelName, stdout);
          resolve(result);
        } else {
          resolve({
            modelName,
            vertexCount: 0,
            totalFrames: 0,
            textureWidth: 0,
            textureHeight: 0,
            animations: [],
            error: stderr || `Process exited with code ${code}`,
          });
        }
      });

      process.on("error", (err: Error) => {
        resolve({
          modelName,
          vertexCount: 0,
          totalFrames: 0,
          textureWidth: 0,
          textureHeight: 0,
          animations: [],
          error: err.message,
        });
      });
    });
  }

  /**
   * Parse VAT baking result from script output
   */
  private parseVATResult(
    modelName: string,
    output: string,
  ): VATBakeModelResult {
    // Parse vertex count
    const verticesMatch = output.match(/Vertices:\s*(\d+)/i);
    const vertexCount = verticesMatch ? parseInt(verticesMatch[1], 10) : 0;

    // Parse total frames
    const framesMatch = output.match(/Total frames:\s*(\d+)/i);
    const totalFrames = framesMatch ? parseInt(framesMatch[1], 10) : 0;

    // Parse animations
    const animations: VATAnimationInfo[] = [];
    const animPattern = /Animation "(\w+)":\s*(\d+)\s*frames,\s*([\d.]+)s/gi;
    let match;
    let startFrame = 0;

    while ((match = animPattern.exec(output)) !== null) {
      const frames = parseInt(match[2], 10);
      const duration = parseFloat(match[3]);

      animations.push({
        name: match[1],
        frames,
        startFrame,
        duration,
        loop: match[1] === "idle" || match[1] === "walk",
      });

      startFrame += frames;
    }

    // Check for output path
    const outputMatch = output.match(/Wrote metadata:\s*(.+\.vat\.json)/i);
    const outputPath = outputMatch
      ? path.relative(this.projectRoot, outputMatch[1])
      : undefined;

    return {
      modelName,
      vertexCount,
      totalFrames,
      textureWidth: vertexCount,
      textureHeight: totalFrames,
      animations,
      outputPath,
    };
  }

  /**
   * Get job status
   */
  getJob(jobId: string): VATBakeJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Cancel a running job
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running") {
      return false;
    }

    // Note: We can't easily cancel individual Node processes
    // Just mark the job as cancelled
    job.status = "failed";
    job.error = "Job cancelled by user";
    job.completedAt = new Date().toISOString();

    return true;
  }

  /**
   * List all jobs
   */
  listJobs(): VATBakeJob[] {
    return Array.from(this.jobs.values()).map((job) => ({
      ...job,
      process: undefined,
    }));
  }

  /**
   * Clean up old completed jobs
   */
  cleanupOldJobs(maxAge: number = 3600000): void {
    const now = Date.now();
    for (const [jobId, job] of this.jobs.entries()) {
      if (
        (job.status === "completed" || job.status === "failed") &&
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
   * Get VAT output directory
   */
  getOutputDir(): string {
    return this.vatOutputDir;
  }

  /**
   * List existing VAT files
   */
  async listVATFiles(): Promise<string[]> {
    const dirExists = await Bun.file(this.vatOutputDir).exists();
    if (!dirExists) {
      return [];
    }

    const entries = await fs.promises.readdir(this.vatOutputDir);
    return entries.filter((e) => e.endsWith(".vat.json"));
  }

  /**
   * Read VAT metadata file
   */
  async readVATMetadata(modelName: string): Promise<VATBakeModelResult | null> {
    const metadataPath = path.join(this.vatOutputDir, `${modelName}.vat.json`);
    const file = Bun.file(metadataPath);

    if (!(await file.exists())) {
      return null;
    }

    const metadata = (await file.json()) as {
      modelName: string;
      vertexCount: number;
      totalFrames: number;
      textureWidth: number;
      textureHeight: number;
      animations: VATAnimationInfo[];
    };

    return {
      ...metadata,
      outputPath: path.relative(this.projectRoot, metadataPath),
    };
  }
}
