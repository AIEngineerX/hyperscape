/**
 * WebGPU polyfills for non-WebGPU runtimes.
 *
 * `three/webgpu` expects a handful of WebGPU constant objects to exist at module
 * initialization time (e.g. `GPUShaderStage.VERTEX`). Bun/Node don't provide
 * these in many environments, which can crash the server on import.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const g = globalThis as unknown as Record<string, any>;

if (g.GPUShaderStage == null || typeof g.GPUShaderStage !== "object") {
  g.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
}

if (g.GPUBufferUsage == null || typeof g.GPUBufferUsage !== "object") {
  g.GPUBufferUsage = {
    MAP_READ: 1,
    MAP_WRITE: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
    INDEX: 16,
    VERTEX: 32,
    UNIFORM: 64,
    STORAGE: 128,
    INDIRECT: 256,
    QUERY_RESOLVE: 512,
  };
}

if (g.GPUTextureUsage == null || typeof g.GPUTextureUsage !== "object") {
  g.GPUTextureUsage = {
    COPY_SRC: 1,
    COPY_DST: 2,
    TEXTURE_BINDING: 4,
    STORAGE_BINDING: 8,
    RENDER_ATTACHMENT: 16,
  };
}

if (g.GPUMapMode == null || typeof g.GPUMapMode !== "object") {
  g.GPUMapMode = { READ: 1, WRITE: 2 };
}

export {};
