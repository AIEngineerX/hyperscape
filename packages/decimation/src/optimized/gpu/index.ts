/**
 * GPU Module Exports
 *
 * WebGPU-accelerated mesh decimation.
 */

export {
  GPUDecimationContext,
  isWebGPUAvailable,
  getGPUInfo,
} from "./context.js";
export type {
  GPUContextOptions,
  MeshBuffers,
  EdgeBuffers,
  MetricBuffers,
  CostBuffers,
} from "./context.js";

export { decimateGPU, shouldUseGPU } from "./decimate-gpu.js";
export type { GPUDecimationOptions } from "./decimate-gpu.js";

export {
  QUADRIC_METRIC_SHADER,
  EDGE_COST_SHADER,
  ACCUMULATE_METRICS_SHADER,
  BATCH_COST_UPDATE_SHADER,
  MIN_REDUCTION_SHADER,
  EDGE_DELETION_SHADER,
  VERTEX_MERGE_SHADER,
} from "./shaders.js";
