/**
 * VAT Routes
 * API endpoints for Vertex Animation Texture (VAT) baking
 *
 * Endpoints:
 * - POST /api/vat/bake - Start a VAT baking job
 * - POST /api/vat/bake-all - Bake VAT for all mobs
 * - GET /api/vat/jobs - List all baking jobs
 * - GET /api/vat/jobs/:jobId - Get job status
 * - DELETE /api/vat/jobs/:jobId - Cancel a running job
 * - GET /api/vat/files - List existing VAT files
 * - GET /api/vat/files/:modelName - Get VAT metadata for a model
 */

import { Elysia, t } from "elysia";
import type { VATBakingService } from "../services/VATBakingService";
import * as Models from "../models";

export const createVATRoutes = (vatService: VATBakingService) => {
  return new Elysia({ prefix: "/api/vat", name: "vat" }).guard(
    {
      beforeHandle: ({ request }) => {
        console.log(`[VAT] ${request.method} ${new URL(request.url).pathname}`);
      },
    },
    (app) =>
      app
        // Start a VAT baking job
        .post(
          "/bake",
          async ({ body }) => {
            const job = await vatService.startBakeJob(
              body.modelPaths,
              body.mobIds,
              {
                fps: body.fps || 30,
                maxFrames: body.maxFrames || 30,
                outputFormat: body.outputFormat || "bin",
                dryRun: body.dryRun || false,
              },
            );

            return {
              jobId: job.jobId,
              status: job.status,
              message: `VAT baking job started for ${job.totalModels} models`,
            };
          },
          {
            body: Models.VATBakeRequest,
            response: Models.VATBakeResponse,
            detail: {
              tags: ["VAT Pipeline"],
              summary: "Start VAT baking job",
              description:
                "Starts a background job to bake Vertex Animation Textures for specified mob models. Returns a job ID to track progress.",
            },
          },
        )

        // Bake all VATs
        .post(
          "/bake-all",
          async ({ query }) => {
            const dryRun = query.dryRun === "true";
            const fps = query.fps ? parseInt(query.fps, 10) : 30;
            const maxFrames = query.maxFrames
              ? parseInt(query.maxFrames, 10)
              : 30;

            const job = await vatService.startBakeJob(undefined, undefined, {
              fps,
              maxFrames,
              outputFormat: "bin",
              dryRun,
            });

            return {
              jobId: job.jobId,
              status: job.status,
              message: `VAT baking job started for all ${job.totalModels} mob models`,
            };
          },
          {
            query: t.Object({
              dryRun: t.Optional(t.String()),
              fps: t.Optional(t.String()),
              maxFrames: t.Optional(t.String()),
            }),
            response: Models.VATBakeResponse,
            detail: {
              tags: ["VAT Pipeline"],
              summary: "Bake all VATs",
              description:
                "Starts a background job to bake VATs for all rigged mob models found in the assets.",
            },
          },
        )

        // List all jobs
        .get(
          "/jobs",
          async () => {
            vatService.cleanupOldJobs();
            return vatService.listJobs();
          },
          {
            response: t.Array(Models.VATBakeJobStatus),
            detail: {
              tags: ["VAT Pipeline"],
              summary: "List VAT baking jobs",
              description:
                "Returns a list of all VAT baking jobs (queued, running, completed, and failed).",
            },
          },
        )

        // Get job status
        .get(
          "/jobs/:jobId",
          async ({ params: { jobId }, set }) => {
            const job = vatService.getJob(jobId);
            if (!job) {
              set.status = 404;
              return { error: `Job not found: ${jobId}` };
            }

            return {
              jobId: job.jobId,
              status: job.status,
              progress: job.progress,
              totalModels: job.totalModels,
              processedModels: job.processedModels,
              currentModel: job.currentModel,
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
              200: Models.VATBakeJobStatus,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["VAT Pipeline"],
              summary: "Get VAT baking job status",
              description:
                "Returns the status and progress of a VAT baking job.",
            },
          },
        )

        // Cancel a running job
        .delete(
          "/jobs/:jobId",
          async ({ params: { jobId }, set }) => {
            const success = vatService.cancelJob(jobId);
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
              tags: ["VAT Pipeline"],
              summary: "Cancel VAT baking job",
              description: "Cancels a running VAT baking job.",
            },
          },
        )

        // List existing VAT files
        .get(
          "/files",
          async () => {
            const files = await vatService.listVATFiles();
            return files;
          },
          {
            response: t.Array(t.String()),
            detail: {
              tags: ["VAT Pipeline"],
              summary: "List VAT files",
              description:
                "Returns a list of existing VAT metadata files in the output directory.",
            },
          },
        )

        // Get VAT metadata for a model
        .get(
          "/files/:modelName",
          async ({ params: { modelName }, set }) => {
            const metadata = await vatService.readVATMetadata(modelName);
            if (!metadata) {
              set.status = 404;
              return { error: `VAT metadata not found for: ${modelName}` };
            }

            return metadata;
          },
          {
            params: t.Object({
              modelName: t.String({ minLength: 1 }),
            }),
            response: {
              200: t.Object({
                modelName: t.String(),
                vertexCount: t.Number(),
                totalFrames: t.Number(),
                textureWidth: t.Number(),
                textureHeight: t.Number(),
                animations: t.Array(Models.VATAnimationInfo),
                outputPath: t.Optional(t.String()),
              }),
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["VAT Pipeline"],
              summary: "Get VAT metadata",
              description:
                "Returns VAT metadata for a specific model including animation info.",
            },
          },
        ),
  );
};
