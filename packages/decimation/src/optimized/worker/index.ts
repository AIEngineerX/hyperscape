/**
 * Worker Module Exports
 */

export { DecimationWorkerPool } from "./worker-pool.js";
export type { WorkerPoolOptions, BatchComputeResult } from "./worker-pool.js";

export type {
  WorkerInitMessage,
  WorkerComputeMessage,
  WorkerResultMessage,
  WorkerErrorMessage,
  WorkerMessage,
  WorkerResponse,
} from "./cost-worker.js";

export { getFullWorkerUrl } from "./full-worker.js";
export type {
  FullWorkerStartMessage,
  FullWorkerProgressMessage,
  FullWorkerResultMessage,
  FullWorkerErrorMessage,
  FullWorkerMessage,
  FullWorkerResponse,
} from "./full-worker.js";

export {
  SharedMemoryWorkerPool,
  sharedArrayBufferAvailable,
  decimateSharedMemory,
} from "./shared-worker.js";
export type {
  SharedWorkerInitMessage,
  SharedWorkerComputeMessage,
  SharedWorkerDoneMessage,
  SharedWorkerMessage,
  SharedWorkerResponse,
} from "./shared-worker.js";
