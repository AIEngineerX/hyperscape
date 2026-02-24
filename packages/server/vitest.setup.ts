/**
 * Vitest setup file to mock browser globals for tests that import @hyperscape/shared
 * which includes Three.js WebGPU code expecting browser APIs.
 */

// Mock WebGPU globals that Three.js WebGPU renderer expects
if (typeof globalThis.GPUShaderStage === "undefined") {
  (globalThis as Record<string, unknown>).GPUShaderStage = {
    VERTEX: 1,
    FRAGMENT: 2,
    COMPUTE: 4,
  };
}

if (typeof globalThis.GPUBufferUsage === "undefined") {
  (globalThis as Record<string, unknown>).GPUBufferUsage = {
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

if (typeof globalThis.GPUTextureUsage === "undefined") {
  (globalThis as Record<string, unknown>).GPUTextureUsage = {
    COPY_SRC: 1,
    COPY_DST: 2,
    TEXTURE_BINDING: 4,
    STORAGE_BINDING: 8,
    RENDER_ATTACHMENT: 16,
  };
}

if (typeof globalThis.GPUMapMode === "undefined") {
  (globalThis as Record<string, unknown>).GPUMapMode = {
    READ: 1,
    WRITE: 2,
  };
}
