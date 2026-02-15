/**
 * LOD Routes
 * API endpoints for LOD baking, bundle management, and settings
 *
 * Endpoints:
 * - GET /api/lod/settings - Get LOD settings
 * - PUT /api/lod/settings - Update LOD settings
 * - GET /api/lod/bundle/:assetId - Get LOD bundle for an asset
 * - GET /api/lod/bundles - List all LOD bundles
 * - POST /api/lod/bake - Start a LOD baking job
 * - POST /api/lod/bake-all - Bake all LODs
 * - GET /api/lod/jobs - List all baking jobs
 * - GET /api/lod/jobs/:jobId - Get job status
 * - DELETE /api/lod/jobs/:jobId - Cancel a running job
 *
 * Imposter Endpoints:
 * - GET /api/lod/imposters - List all imposters
 * - GET /api/lod/imposter/:assetId - Get imposter metadata
 * - GET /api/lod/imposter/discover - Discover models with imposter status
 * - GET /api/lod/imposter/stats - Get imposter statistics
 * - POST /api/lod/imposter/bake - Start batch imposter baking job
 * - GET /api/lod/imposter/task/:jobId - Get next bake task for a job
 * - POST /api/lod/imposter/result - Report bake result
 * - POST /api/lod/imposter/upload - Upload atlas image
 * - DELETE /api/lod/imposter/:assetId - Delete an imposter
 */

import { Elysia, t } from "elysia";
import type { LODBakingService } from "../services/LODBakingService";
import { VertexColorService } from "../services/VertexColorService";
import { ImpostorBakingService } from "../services/ImpostorBakingService";
import * as Models from "../models";

export const createLODRoutes = (
  lodService: LODBakingService,
  projectRoot: string,
) => {
  const vertexColorService = new VertexColorService();
  const impostorService = new ImpostorBakingService(projectRoot);

  // Initialize imposter service
  impostorService.initialize().catch((err) => {
    console.error("[LOD] Failed to initialize ImpostorBakingService:", err);
  });

  return new Elysia({ prefix: "/api/lod", name: "lod" }).guard(
    {
      beforeHandle: ({ request }) => {
        console.log(`[LOD] ${request.method} ${new URL(request.url).pathname}`);
      },
    },
    (app) =>
      app
        // Get LOD settings
        .get(
          "/settings",
          async () => {
            const settings = await lodService.getSettings();
            return settings;
          },
          {
            response: Models.LODSettings,
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Get LOD settings",
              description:
                "Returns LOD distance thresholds, dissolve settings, and vertex budgets per category.",
            },
          },
        )

        // Update LOD settings
        .put(
          "/settings",
          async ({ body }) => {
            await lodService.saveSettings(body);
            return { success: true, message: "LOD settings saved" };
          },
          {
            body: Models.LODSettings,
            response: Models.SuccessResponse,
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Update LOD settings",
              description:
                "Updates LOD distance thresholds, dissolve settings, and vertex budgets.",
            },
          },
        )

        // Get LOD bundle for an asset
        .get(
          "/bundle/:assetId",
          async ({ params: { assetId }, set }) => {
            const bundle = await lodService.getLODBundle(assetId);
            if (!bundle) {
              set.status = 404;
              return { error: `No LOD bundle found for asset: ${assetId}` };
            }
            return bundle;
          },
          {
            params: t.Object({
              assetId: t.String({ minLength: 1 }),
            }),
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Get LOD bundle for an asset",
              description:
                "Returns the LOD bundle containing all LOD variants for a specific asset.",
            },
          },
        )

        // List all LOD bundles
        .get(
          "/bundles",
          async () => {
            return lodService.getAllBundles();
          },
          {
            detail: {
              tags: ["LOD Pipeline"],
              summary: "List all LOD bundles",
              description:
                "Returns a list of all LOD bundles with their variants and status.",
            },
          },
        )

        // Discover all available assets (even those without bundles)
        .get(
          "/assets",
          async ({ query }) => {
            const category = query.category || undefined;
            const categories = category ? [category] : undefined;
            const assets = await lodService.discoverAssets(categories);
            return assets;
          },
          {
            query: t.Object({
              category: t.Optional(t.String()),
            }),
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Discover available assets",
              description:
                "Returns a list of all assets that can have LODs generated, including their current LOD status.",
            },
          },
        )

        // Start a LOD baking job
        .post(
          "/bake",
          async ({ body }) => {
            const levels = body.levels || ["lod1"];
            const job = await lodService.startBakeJob(
              body.assetPaths,
              body.categories,
              body.dryRun ?? false,
              levels,
            );

            return {
              jobId: job.jobId,
              status: job.status,
              message: `LOD baking job started for ${job.totalAssets} operations`,
            };
          },
          {
            body: Models.LODBakeRequest,
            response: Models.LODBakeResponse,
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Start LOD baking job",
              description:
                "Starts a background job to bake LOD models for specified assets or categories. Supports multiple LOD levels (lod1, lod2, imposter). Returns a job ID to track progress.",
            },
          },
        )

        // Bake all LODs
        .post(
          "/bake-all",
          async ({ query }) => {
            const dryRun = query.dryRun === "true";
            const job = await lodService.startBakeJob(
              undefined,
              undefined,
              dryRun,
            );

            return {
              jobId: job.jobId,
              status: job.status,
              message: `LOD baking job started for all ${job.totalAssets} assets`,
            };
          },
          {
            query: t.Object({
              dryRun: t.Optional(t.String()),
            }),
            response: Models.LODBakeResponse,
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Bake all LODs",
              description:
                "Starts a background job to bake LOD1 models for all vegetation and resource assets.",
            },
          },
        )

        // List all jobs
        .get(
          "/jobs",
          async () => {
            // Clean up old jobs first
            lodService.cleanupOldJobs();
            return lodService.listJobs();
          },
          {
            response: t.Array(Models.LODBakeJobStatus),
            detail: {
              tags: ["LOD Pipeline"],
              summary: "List LOD baking jobs",
              description:
                "Returns a list of all LOD baking jobs (queued, running, completed, and failed).",
            },
          },
        )

        // Get job status
        .get(
          "/jobs/:jobId",
          async ({ params: { jobId }, set }) => {
            const job = lodService.getJob(jobId);
            if (!job) {
              set.status = 404;
              return { error: `Job not found: ${jobId}` };
            }

            return {
              jobId: job.jobId,
              status: job.status,
              progress: job.progress,
              totalAssets: job.totalAssets,
              processedAssets: job.processedAssets,
              currentAsset: job.currentAsset,
              results: job.results,
              error: job.error,
              startedAt: job.startedAt,
              completedAt: job.completedAt,
            };
          },
          {
            params: t.Object({
              jobId: t.String({ minLength: 1 }),
            }),
            response: {
              200: Models.LODBakeJobStatus,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Get LOD baking job status",
              description:
                "Returns the status and progress of a LOD baking job.",
            },
          },
        )

        // Cancel a running job
        .delete(
          "/jobs/:jobId",
          async ({ params: { jobId }, set }) => {
            const success = lodService.cancelJob(jobId);
            if (!success) {
              set.status = 404;
              return { error: `Job not found or not running: ${jobId}` };
            }

            return { success: true, message: `Job ${jobId} cancelled` };
          },
          {
            params: t.Object({
              jobId: t.String({ minLength: 1 }),
            }),
            response: {
              200: Models.SuccessResponse,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Cancel LOD baking job",
              description: "Cancels a running LOD baking job.",
            },
          },
        )

        // TypeScript-based baking (no Blender required)
        .post(
          "/bake-ts",
          async ({ body }) => {
            const levels = body.levels || ["lod1"];
            const job = await lodService.startTypeScriptBakeJob(
              body.assetPaths,
              body.categories,
              body.dryRun ?? false,
              levels,
            );

            return {
              jobId: job.jobId,
              status: job.status,
              message: `TypeScript LOD baking job started for ${job.totalAssets} operations`,
            };
          },
          {
            body: Models.LODBakeRequest,
            response: Models.LODBakeResponse,
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Start TypeScript-based LOD baking job",
              description:
                "Starts a background job using the built-in TypeScript decimation engine. No external tools required. Supports seam-aware UV preservation.",
            },
          },
        )

        // Decimate a single asset
        .post(
          "/decimate",
          async ({ body, set }) => {
            const result = await lodService.decimateSingleAsset(
              body.assetPath,
              body.level,
              {
                targetPercent: body.targetPercent,
                strictness: body.strictness,
                minVertices: body.minVertices,
              },
            );

            if (!result.success) {
              set.status = 400;
              return {
                error: result.error || "Decimation failed",
                originalVertices: result.originalVertices,
                processingTime: result.processingTime,
              };
            }

            return {
              success: true,
              originalVertices: result.originalVertices,
              finalVertices: result.finalVertices,
              originalFaces: result.originalFaces,
              finalFaces: result.finalFaces,
              reductionPercent: result.reductionPercent,
              processingTime: result.processingTime,
            };
          },
          {
            body: t.Object({
              assetPath: t.String({ minLength: 1 }),
              level: t.Union([t.Literal("lod1"), t.Literal("lod2")]),
              targetPercent: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
              strictness: t.Optional(
                t.Union([t.Literal(0), t.Literal(1), t.Literal(2)]),
              ),
              minVertices: t.Optional(t.Number({ minimum: 4 })),
            }),
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Decimate a single asset",
              description:
                "Decimate a single asset using TypeScript-based seam-aware decimation. Returns immediately with results.",
            },
          },
        )

        // Analyze vertex colors in a GLB
        .post(
          "/vertex-color/analyze",
          async ({ body, set }) => {
            const result = await vertexColorService.analyzeGLBFile(
              body.assetPath,
            );

            if ("error" in result) {
              set.status = 400;
              return { error: result.error };
            }

            return {
              hasVertexColors: result.hasVertexColors,
              hasTextures: result.hasTextures,
              textureCount: result.textureCount,
              embeddedImageCount: result.embeddedImageCount,
              materialTextureRefs: result.materialTextureRefs,
              vertexCount: result.vertexCount,
              faceCount: result.faceCount,
              fileSize: result.fileSize,
              canOptimize: result.hasVertexColors && result.hasTextures,
            };
          },
          {
            body: t.Object({
              assetPath: t.String({ minLength: 1 }),
            }),
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Analyze vertex colors in a GLB",
              description:
                "Analyzes a GLB file to determine if it has vertex colors and/or textures, and whether it can be optimized.",
            },
          },
        )

        // Strip textures from a vertex-colored GLB
        .post(
          "/vertex-color/strip",
          async ({ body, set }) => {
            const result = await vertexColorService.stripTexturesFromFile(
              body.assetPath,
              body.outputPath,
            );

            if (!result.success) {
              set.status = 400;
              return {
                error: result.error || "Strip operation failed",
                modified: false,
              };
            }

            return {
              success: true,
              modified: result.modified,
              originalSize: result.originalSize,
              newSize: result.newSize,
              savedBytes: result.savedBytes,
              savingsPercent:
                result.originalSize > 0
                  ? ((result.savedBytes / result.originalSize) * 100).toFixed(1)
                  : "0",
            };
          },
          {
            body: t.Object({
              assetPath: t.String({ minLength: 1 }),
              outputPath: t.Optional(t.String()),
            }),
            detail: {
              tags: ["LOD Pipeline"],
              summary: "Strip textures from vertex-colored GLB",
              description:
                "Removes textures from a GLB file that already has vertex colors, reducing file size and GPU memory usage.",
            },
          },
        )

        // ==================== Imposter Routes ====================

        // List all imposters
        .get(
          "/imposters",
          async () => {
            return impostorService.getAllImposters();
          },
          {
            response: t.Array(Models.ImpostorMetadata),
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "List all imposters",
              description:
                "Returns a list of all baked imposters with their metadata.",
            },
          },
        )

        // Get imposter statistics
        .get(
          "/imposter/stats",
          async () => {
            return impostorService.getStats();
          },
          {
            response: Models.ImpostorStats,
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "Get imposter statistics",
              description:
                "Returns statistics about imposters including counts by category and total size.",
            },
          },
        )

        // Discover models with imposter status
        .get(
          "/imposter/discover",
          async ({ query }) => {
            const category = query.category || undefined;
            const categories = category ? category.split(",") : undefined;
            return impostorService.discoverAssetsWithStatus(categories);
          },
          {
            query: t.Object({
              category: t.Optional(t.String()),
            }),
            response: t.Array(Models.ImpostorAssetStatus),
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "Discover models with imposter status",
              description:
                "Returns a list of all models that can have imposters baked, including their current imposter status.",
            },
          },
        )

        // Get imposter metadata for an asset
        .get(
          "/imposter/:assetId",
          async ({ params: { assetId }, set }) => {
            const metadata = await impostorService.getImposterMetadata(assetId);
            if (!metadata) {
              set.status = 404;
              return { error: `No imposter found for asset: ${assetId}` };
            }
            return metadata;
          },
          {
            params: t.Object({
              assetId: t.String({ minLength: 1 }),
            }),
            response: {
              200: Models.ImpostorMetadata,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "Get imposter metadata",
              description:
                "Returns the imposter metadata for a specific asset including atlas path and configuration.",
            },
          },
        )

        // Start batch imposter baking job
        .post(
          "/imposter/bake",
          async ({ body }) => {
            const job = await impostorService.startBatchBakeJob({
              assetIds: body.assetIds,
              categories: body.categories,
              config: body.config,
              force: body.force,
            });

            return {
              jobId: job.jobId,
              status: job.status,
              message: `Imposter baking job started for ${job.totalAssets} assets`,
            };
          },
          {
            body: Models.ImpostorBakeRequest,
            response: Models.ImpostorBakeResponse,
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "Start imposter baking job",
              description:
                "Starts a background job to bake octahedral imposters for specified assets or categories. " +
                "Returns a job ID that can be used to fetch bake tasks and report results.",
            },
          },
        )

        // Get next bake task for a job (client pulls work)
        .get(
          "/imposter/task/:jobId",
          async ({ params: { jobId }, set }) => {
            const task = await impostorService.getNextBakeTask(jobId);
            if (!task) {
              set.status = 404;
              return { error: `No pending tasks for job: ${jobId}` };
            }
            return task;
          },
          {
            params: t.Object({
              jobId: t.String({ minLength: 1 }),
            }),
            response: {
              200: Models.ImpostorBakeTask,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "Get next bake task",
              description:
                "Returns the next asset to bake for a job. Called by the client to pull work items.",
            },
          },
        )

        // Report bake result
        .post(
          "/imposter/result",
          async ({ body }) => {
            await impostorService.reportBakeResult(body.jobId, {
              assetId: body.assetId,
              success: body.success,
              metadata: body.metadata,
              atlasPath: body.atlasPath,
              error: body.error,
              duration: body.duration,
            });
            return { success: true, message: "Result recorded" };
          },
          {
            body: t.Object({
              jobId: t.String({ minLength: 1 }),
              assetId: t.String({ minLength: 1 }),
              success: t.Boolean(),
              metadata: t.Optional(Models.ImpostorMetadata),
              atlasPath: t.Optional(t.String()),
              error: t.Optional(t.String()),
              duration: t.Number(),
            }),
            response: Models.SuccessResponse,
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "Report bake result",
              description:
                "Reports the result of baking an imposter. Called by the client after completing a bake task.",
            },
          },
        )

        // Upload atlas image
        .post(
          "/imposter/upload",
          async ({ body, set }) => {
            const imageBuffer = Buffer.from(body.imageData, "base64");
            const outputPath = await impostorService.saveAtlasImage(
              body.assetId,
              body.category,
              imageBuffer,
            );
            return {
              success: true,
              message: `Atlas saved to ${outputPath}`,
              path: outputPath,
            };
          },
          {
            body: t.Object({
              assetId: t.String({ minLength: 1 }),
              category: t.String({ minLength: 1 }),
              imageData: t.String({ minLength: 1 }), // Base64 encoded PNG
            }),
            response: t.Object({
              success: t.Boolean(),
              message: t.String(),
              path: t.String(),
            }),
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "Upload atlas image",
              description:
                "Uploads a baked imposter atlas image. The client sends the PNG data after baking.",
            },
          },
        )

        // List imposter jobs
        .get(
          "/imposter/jobs",
          async () => {
            impostorService.cleanupOldJobs();
            return impostorService.listJobs();
          },
          {
            response: t.Array(Models.ImpostorBakeJobStatus),
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "List imposter baking jobs",
              description:
                "Returns a list of all imposter baking jobs (queued, running, completed, and failed).",
            },
          },
        )

        // Get imposter job status
        .get(
          "/imposter/jobs/:jobId",
          async ({ params: { jobId }, set }) => {
            const job = impostorService.getJob(jobId);
            if (!job) {
              set.status = 404;
              return { error: `Job not found: ${jobId}` };
            }
            return job;
          },
          {
            params: t.Object({
              jobId: t.String({ minLength: 1 }),
            }),
            response: {
              200: Models.ImpostorBakeJobStatus,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "Get imposter baking job status",
              description:
                "Returns the status and progress of an imposter baking job.",
            },
          },
        )

        // Cancel imposter job
        .delete(
          "/imposter/jobs/:jobId",
          async ({ params: { jobId }, set }) => {
            const success = impostorService.cancelJob(jobId);
            if (!success) {
              set.status = 404;
              return { error: `Job not found or not running: ${jobId}` };
            }
            return { success: true, message: `Job ${jobId} cancelled` };
          },
          {
            params: t.Object({
              jobId: t.String({ minLength: 1 }),
            }),
            response: {
              200: Models.SuccessResponse,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "Cancel imposter baking job",
              description: "Cancels a running imposter baking job.",
            },
          },
        )

        // Delete an imposter
        .delete(
          "/imposter/:assetId",
          async ({ params: { assetId }, set }) => {
            const success = await impostorService.deleteImposter(assetId);
            if (!success) {
              set.status = 404;
              return { error: `Imposter not found: ${assetId}` };
            }
            return { success: true, message: `Imposter ${assetId} deleted` };
          },
          {
            params: t.Object({
              assetId: t.String({ minLength: 1 }),
            }),
            response: {
              200: Models.SuccessResponse,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Imposter Pipeline"],
              summary: "Delete an imposter",
              description:
                "Deletes an imposter atlas and its metadata from the registry.",
            },
          },
        ),
  );
};
