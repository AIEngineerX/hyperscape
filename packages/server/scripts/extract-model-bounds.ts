/**
 * Extract Model Bounds - Build-time tool for automatic footprint calculation
 *
 * This script parses GLB files from the assets directory and extracts
 * bounding box information from glTF position accessor min/max values.
 *
 * AAA Approach:
 * - Parse actual model geometry to get real dimensions
 * - Pre-compute footprints at build time (not runtime)
 * - Write to manifest for server to load at startup
 *
 * Usage:
 *   bun run packages/server/scripts/extract-model-bounds.ts
 *
 * Output:
 *   packages/server/world/assets/manifests/model-bounds.json
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
} from "fs";
import { join, relative, basename, dirname } from "path";

// ============================================================================
// TYPES
// ============================================================================

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

interface ModelBounds {
  /** Model identifier (relative path from models/) */
  id: string;
  /** Full asset path */
  assetPath: string;
  /** Bounding box in model space */
  bounds: BoundingBox;
  /** Dimensions (max - min) */
  dimensions: Vec3;
  /** Auto-calculated footprint (tiles) */
  footprint: { width: number; depth: number };
}

interface ModelBoundsManifest {
  generatedAt: string;
  tileSize: number;
  models: ModelBounds[];
}

// glTF accessor types
interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  normalized?: boolean;
}

interface GltfMeshPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

interface GltfMesh {
  name?: string;
  primitives: GltfMeshPrimitive[];
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfJson {
  accessors?: GltfAccessor[];
  meshes?: GltfMesh[];
  scenes?: { nodes?: number[] }[];
  nodes?: {
    mesh?: number;
    children?: number[];
    translation?: number[];
    scale?: number[];
    matrix?: number[];
  }[];
  bufferViews?: GltfBufferView[];
  extensionsUsed?: string[];
}

// ============================================================================
// GLB PARSER
// ============================================================================

const GLB_MAGIC = 0x46546c67; // "glTF" in little-endian
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON" in little-endian
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0" in little-endian

interface GlbParseResult {
  json: GltfJson;
  bin: Buffer | null;
}

/**
 * Parse GLB file and extract the JSON and binary chunks
 */
function parseGlb(buffer: Buffer): GlbParseResult | null {
  if (buffer.length < 12) {
    console.warn("  GLB too short");
    return null;
  }

  // Read header
  const magic = buffer.readUInt32LE(0);
  const version = buffer.readUInt32LE(4);
  const length = buffer.readUInt32LE(8);

  if (magic !== GLB_MAGIC) {
    console.warn("  Not a valid GLB file (bad magic)");
    return null;
  }

  if (version !== 2) {
    console.warn(`  Unsupported GLB version: ${version}`);
    return null;
  }

  // Parse chunks
  let offset = 12;
  let jsonChunk: GltfJson | null = null;
  let binChunk: Buffer | null = null;

  while (offset < length) {
    if (offset + 8 > buffer.length) break;

    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    offset += 8;

    if (chunkType === CHUNK_TYPE_JSON) {
      const jsonString = buffer.toString("utf8", offset, offset + chunkLength);
      try {
        jsonChunk = JSON.parse(jsonString) as GltfJson;
      } catch (e) {
        console.warn("  Failed to parse JSON chunk");
        return null;
      }
    } else if (chunkType === CHUNK_TYPE_BIN) {
      binChunk = buffer.subarray(offset, offset + chunkLength);
    }

    offset += chunkLength;
  }

  if (!jsonChunk) {
    console.warn("  No JSON chunk found");
    return null;
  }

  return { json: jsonChunk, bin: binChunk };
}

// glTF component types
const COMPONENT_TYPE_BYTE = 5120;
const COMPONENT_TYPE_UNSIGNED_BYTE = 5121;
const COMPONENT_TYPE_SHORT = 5122;
const COMPONENT_TYPE_UNSIGNED_SHORT = 5123;
const COMPONENT_TYPE_FLOAT = 5126;

// Maximum value for normalization
const SHORT_MAX = 32767;
const UNSIGNED_SHORT_MAX = 65535;
const BYTE_MAX = 127;
const UNSIGNED_BYTE_MAX = 255;

// Maximum reasonable dimension for a model in meters
// Values larger than this indicate quantized integer data being misinterpreted as floats
const MAX_REASONABLE_DIMENSION = 100;

/**
 * Get the normalization divisor for a component type
 */
function getNormalizationDivisor(componentType: number): number {
  switch (componentType) {
    case COMPONENT_TYPE_BYTE:
      return BYTE_MAX;
    case COMPONENT_TYPE_UNSIGNED_BYTE:
      return UNSIGNED_BYTE_MAX;
    case COMPONENT_TYPE_SHORT:
      return SHORT_MAX;
    case COMPONENT_TYPE_UNSIGNED_SHORT:
      return UNSIGNED_SHORT_MAX;
    default:
      return 1;
  }
}

/**
 * Dequantize a min/max value based on component type
 */
function dequantizeValue(value: number, componentType: number): number {
  const divisor = getNormalizationDivisor(componentType);
  return value / divisor;
}

/**
 * Find the maximum scale factor applied to meshes via node transforms.
 * For quantized meshes, gltf-transform typically applies a uniform scale
 * at the node level to map normalized coordinates back to world space.
 */
function findMeshNodeScale(gltf: GltfJson, meshIndex: number): number {
  if (!gltf.nodes) return 1.0;

  for (const node of gltf.nodes) {
    if (node.mesh === meshIndex) {
      // Check for scale in node transform
      if (node.scale && node.scale.length >= 3) {
        // Return the maximum scale component (for uniform scaling this is all the same)
        return Math.max(node.scale[0], node.scale[1], node.scale[2]);
      }
      // Check for scale in matrix (elements 0, 5, 10 for scale on diagonal)
      if (node.matrix && node.matrix.length >= 16) {
        const sx = Math.sqrt(
          node.matrix[0] ** 2 + node.matrix[1] ** 2 + node.matrix[2] ** 2,
        );
        const sy = Math.sqrt(
          node.matrix[4] ** 2 + node.matrix[5] ** 2 + node.matrix[6] ** 2,
        );
        const sz = Math.sqrt(
          node.matrix[8] ** 2 + node.matrix[9] ** 2 + node.matrix[10] ** 2,
        );
        return Math.max(sx, sy, sz);
      }
    }
  }

  return 1.0;
}

/**
 * Read position bounds directly from the binary buffer for quantized data
 */
function readQuantizedBounds(
  gltf: GltfJson,
  bin: Buffer,
  accessor: GltfAccessor,
  meshIndex: number,
): BoundingBox | null {
  if (accessor.bufferView === undefined || !gltf.bufferViews) {
    return null;
  }

  const bufferView = gltf.bufferViews[accessor.bufferView];
  if (!bufferView) return null;

  const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const byteStride = bufferView.byteStride;
  const count = accessor.count;
  const componentType = accessor.componentType;

  // Calculate bytes per component
  let bytesPerComponent: number;
  switch (componentType) {
    case COMPONENT_TYPE_BYTE:
    case COMPONENT_TYPE_UNSIGNED_BYTE:
      bytesPerComponent = 1;
      break;
    case COMPONENT_TYPE_SHORT:
    case COMPONENT_TYPE_UNSIGNED_SHORT:
      bytesPerComponent = 2;
      break;
    case COMPONENT_TYPE_FLOAT:
      bytesPerComponent = 4;
      break;
    default:
      return null;
  }

  const elementSize = bytesPerComponent * 3; // VEC3
  const elementStride = byteStride ?? elementSize;

  // Calculate the maximum byte we'll need to read
  const maxOffset = byteOffset + (count - 1) * elementStride + elementSize;

  // Bounds check - if we would read past the buffer, return null
  if (maxOffset > bin.length) {
    return null;
  }

  // Find scale from node transform
  const nodeScale = findMeshNodeScale(gltf, meshIndex);

  // Initialize bounds
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  // Read each vertex position
  for (let i = 0; i < count; i++) {
    const offset = byteOffset + i * elementStride;

    let x: number, y: number, z: number;

    switch (componentType) {
      case COMPONENT_TYPE_SHORT:
        x = bin.readInt16LE(offset);
        y = bin.readInt16LE(offset + 2);
        z = bin.readInt16LE(offset + 4);
        break;
      case COMPONENT_TYPE_UNSIGNED_SHORT:
        x = bin.readUInt16LE(offset);
        y = bin.readUInt16LE(offset + 2);
        z = bin.readUInt16LE(offset + 4);
        break;
      case COMPONENT_TYPE_BYTE:
        x = bin.readInt8(offset);
        y = bin.readInt8(offset + 1);
        z = bin.readInt8(offset + 2);
        break;
      case COMPONENT_TYPE_UNSIGNED_BYTE:
        x = bin.readUInt8(offset);
        y = bin.readUInt8(offset + 1);
        z = bin.readUInt8(offset + 2);
        break;
      case COMPONENT_TYPE_FLOAT:
        x = bin.readFloatLE(offset);
        y = bin.readFloatLE(offset + 4);
        z = bin.readFloatLE(offset + 8);
        break;
      default:
        return null;
    }

    // Dequantize if normalized
    if (accessor.normalized && componentType !== COMPONENT_TYPE_FLOAT) {
      const divisor = getNormalizationDivisor(componentType);
      x /= divisor;
      y /= divisor;
      z /= divisor;
    }

    // Apply node scale
    x *= nodeScale;
    y *= nodeScale;
    z *= nodeScale;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

/**
 * Extract bounding box from glTF accessors
 *
 * The position accessor (POSITION attribute) contains min/max arrays
 * that define the bounding box of the mesh vertices.
 *
 * For quantized meshes (KHR_mesh_quantization), positions are stored as
 * INT16/UINT16. We handle these by:
 * 1. Using accessor min/max and dequantizing + applying node scale
 * 2. Falling back to reading the binary buffer directly
 */
function extractBounds(gltf: GltfJson, bin: Buffer | null): BoundingBox | null {
  if (!gltf.accessors || !gltf.meshes) {
    return null;
  }

  // Check if this model uses mesh quantization
  const usesQuantization = gltf.extensionsUsed?.includes(
    "KHR_mesh_quantization",
  );

  // Initialize bounds to extremes
  const globalMin: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const globalMax: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  let foundAny = false;

  // Iterate all meshes and their primitives
  for (let meshIndex = 0; meshIndex < gltf.meshes.length; meshIndex++) {
    const mesh = gltf.meshes[meshIndex];
    for (const primitive of mesh.primitives) {
      const positionIndex = primitive.attributes?.POSITION;
      if (positionIndex === undefined) continue;

      const accessor = gltf.accessors[positionIndex];
      if (!accessor || accessor.type !== "VEC3") continue;

      const isQuantized = accessor.componentType !== COMPONENT_TYPE_FLOAT;

      // For quantized data, try to read from buffer directly
      if (isQuantized && bin) {
        const quantizedBounds = readQuantizedBounds(
          gltf,
          bin,
          accessor,
          meshIndex,
        );
        if (quantizedBounds) {
          const dimX = quantizedBounds.max.x - quantizedBounds.min.x;
          const dimY = quantizedBounds.max.y - quantizedBounds.min.y;
          const dimZ = quantizedBounds.max.z - quantizedBounds.min.z;

          // Sanity check the dimensions
          if (
            dimX <= MAX_REASONABLE_DIMENSION &&
            dimY <= MAX_REASONABLE_DIMENSION &&
            dimZ <= MAX_REASONABLE_DIMENSION &&
            dimX > 0 &&
            dimY > 0 &&
            dimZ > 0
          ) {
            foundAny = true;
            globalMin.x = Math.min(globalMin.x, quantizedBounds.min.x);
            globalMin.y = Math.min(globalMin.y, quantizedBounds.min.y);
            globalMin.z = Math.min(globalMin.z, quantizedBounds.min.z);
            globalMax.x = Math.max(globalMax.x, quantizedBounds.max.x);
            globalMax.y = Math.max(globalMax.y, quantizedBounds.max.y);
            globalMax.z = Math.max(globalMax.z, quantizedBounds.max.z);
            continue;
          }
        }
      }

      // For quantized data without binary buffer or failed read, try accessor min/max with dequantization
      if (isQuantized) {
        if (
          accessor.min &&
          accessor.max &&
          accessor.min.length >= 3 &&
          accessor.max.length >= 3
        ) {
          // Dequantize the min/max values
          const nodeScale = findMeshNodeScale(gltf, meshIndex);
          let minX = accessor.min[0];
          let minY = accessor.min[1];
          let minZ = accessor.min[2];
          let maxX = accessor.max[0];
          let maxY = accessor.max[1];
          let maxZ = accessor.max[2];

          // Apply normalization if accessor is normalized
          if (accessor.normalized) {
            const divisor = getNormalizationDivisor(accessor.componentType);
            minX /= divisor;
            minY /= divisor;
            minZ /= divisor;
            maxX /= divisor;
            maxY /= divisor;
            maxZ /= divisor;
          }

          // Apply node scale
          minX *= nodeScale;
          minY *= nodeScale;
          minZ *= nodeScale;
          maxX *= nodeScale;
          maxY *= nodeScale;
          maxZ *= nodeScale;

          const dimX = maxX - minX;
          const dimY = maxY - minY;
          const dimZ = maxZ - minZ;

          if (
            dimX <= MAX_REASONABLE_DIMENSION &&
            dimY <= MAX_REASONABLE_DIMENSION &&
            dimZ <= MAX_REASONABLE_DIMENSION &&
            dimX > 0 &&
            dimY > 0 &&
            dimZ > 0
          ) {
            foundAny = true;
            globalMin.x = Math.min(globalMin.x, minX);
            globalMin.y = Math.min(globalMin.y, minY);
            globalMin.z = Math.min(globalMin.z, minZ);
            globalMax.x = Math.max(globalMax.x, maxX);
            globalMax.y = Math.max(globalMax.y, maxY);
            globalMax.z = Math.max(globalMax.z, maxZ);
            continue;
          }
        }

        // Skip quantized accessor that we couldn't handle
        console.warn(
          `  ⚠️  Skipping quantized POSITION accessor (componentType=${accessor.componentType})`,
        );
        continue;
      }

      // Use accessor min/max for FLOAT data (most efficient)
      if (
        accessor.min &&
        accessor.max &&
        accessor.min.length >= 3 &&
        accessor.max.length >= 3
      ) {
        // Additional sanity check: skip values that look unreasonable
        const dimX = accessor.max[0] - accessor.min[0];
        const dimY = accessor.max[1] - accessor.min[1];
        const dimZ = accessor.max[2] - accessor.min[2];

        if (
          dimX > MAX_REASONABLE_DIMENSION ||
          dimY > MAX_REASONABLE_DIMENSION ||
          dimZ > MAX_REASONABLE_DIMENSION
        ) {
          console.warn(
            `  ⚠️  Skipping accessor with unreasonable dimensions: ${dimX.toFixed(1)}x${dimY.toFixed(1)}x${dimZ.toFixed(1)}m`,
          );
          continue;
        }

        foundAny = true;
        globalMin.x = Math.min(globalMin.x, accessor.min[0]);
        globalMin.y = Math.min(globalMin.y, accessor.min[1]);
        globalMin.z = Math.min(globalMin.z, accessor.min[2]);
        globalMax.x = Math.max(globalMax.x, accessor.max[0]);
        globalMax.y = Math.max(globalMax.y, accessor.max[1]);
        globalMax.z = Math.max(globalMax.z, accessor.max[2]);
      }
    }
  }

  if (!foundAny) {
    return null;
  }

  return { min: globalMin, max: globalMax };
}

// ============================================================================
// FOOTPRINT CALCULATION
// ============================================================================

/** Tile size in world units (1 tile = 1 unit) */
const TILE_SIZE = 1.0;

/**
 * Calculate footprint from bounds
 *
 * Strategy:
 * - Width comes from X dimension
 * - Depth comes from Z dimension
 * - Round to nearest tile (not ceil - avoids over-blocking)
 * - Minimum 1x1 footprint
 *
 * Note: This calculates footprint at scale 1.0.
 * StationDataProvider applies modelScale at runtime for final footprint.
 */
function calculateFootprint(
  bounds: BoundingBox,
  modelScale: number = 1.0,
): { width: number; depth: number } {
  const width = (bounds.max.x - bounds.min.x) * modelScale;
  const depth = (bounds.max.z - bounds.min.z) * modelScale;

  return {
    width: Math.max(1, Math.round(width / TILE_SIZE)),
    depth: Math.max(1, Math.round(depth / TILE_SIZE)),
  };
}

// ============================================================================
// FILE SCANNER
// ============================================================================

/**
 * Recursively find all GLB files in a directory
 */
function findGlbFiles(dir: string): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip backup directories
      if (entry === "backups" || entry === ".git") continue;
      files.push(...findGlbFiles(fullPath));
    } else if (entry.endsWith(".glb")) {
      files.push(fullPath);
    }
  }

  return files;
}

// ============================================================================
// MAIN
// ============================================================================

function main() {
  const assetsDir = join(__dirname, "../world/assets");
  const modelsDir = join(assetsDir, "models");
  const manifestsDir = join(assetsDir, "manifests");
  const outputPath = join(manifestsDir, "model-bounds.json");

  console.log("=".repeat(60));
  console.log("Model Bounds Extractor");
  console.log("=".repeat(60));
  console.log(`Scanning: ${modelsDir}`);
  console.log("");

  // Check if models directory exists (assets may not be cloned in CI)
  if (!existsSync(modelsDir)) {
    console.log("Models directory not found - assets may not be cloned.");
    console.log("Creating empty manifest for CI compatibility.");
    // Ensure manifests directory exists
    mkdirSync(manifestsDir, { recursive: true });
    const emptyManifest = {
      generatedAt: new Date().toISOString(),
      tileSize: TILE_SIZE,
      models: [],
    };
    writeFileSync(outputPath, JSON.stringify(emptyManifest, null, 2));
    console.log("=".repeat(60));
    console.log(`Generated: ${outputPath} (empty - no assets)`);
    console.log("=".repeat(60));
    return;
  }

  // Find all GLB files
  const glbFiles = findGlbFiles(modelsDir);
  console.log(`Found ${glbFiles.length} GLB files\n`);

  const models: ModelBounds[] = [];

  for (const glbPath of glbFiles) {
    const relativePath = relative(modelsDir, glbPath);
    const modelId = dirname(relativePath);

    // Skip animation files and raw files
    if (
      relativePath.includes("/animations/") ||
      relativePath.includes("_raw.glb")
    ) {
      console.log(`[SKIP] ${relativePath} (animation/raw)`);
      continue;
    }

    console.log(`[SCAN] ${relativePath}`);

    try {
      const buffer = readFileSync(glbPath);
      const result = parseGlb(buffer);

      if (!result) {
        console.log("  -> Failed to parse GLB\n");
        continue;
      }

      const { json: gltf, bin } = result;
      const bounds = extractBounds(gltf, bin);
      if (!bounds) {
        console.log("  -> No position bounds found\n");
        continue;
      }

      const dimensions: Vec3 = {
        x: bounds.max.x - bounds.min.x,
        y: bounds.max.y - bounds.min.y,
        z: bounds.max.z - bounds.min.z,
      };

      // Calculate footprint at scale 1.0 (manifest can specify scale separately)
      const footprint = calculateFootprint(bounds, 1.0);

      const modelBounds: ModelBounds = {
        id: modelId,
        assetPath: `asset://models/${relativePath}`,
        bounds,
        dimensions,
        footprint,
      };

      models.push(modelBounds);

      console.log(
        `  -> Dimensions: ${dimensions.x.toFixed(2)} x ${dimensions.y.toFixed(2)} x ${dimensions.z.toFixed(2)}`,
      );
      console.log(
        `  -> Footprint (scale=1.0): ${footprint.width}x${footprint.depth} tiles\n`,
      );
    } catch (error) {
      console.log(`  -> Error: ${error}\n`);
    }
  }

  // Ensure manifests directory exists
  mkdirSync(manifestsDir, { recursive: true });

  // Write manifest
  const manifest: ModelBoundsManifest = {
    generatedAt: new Date().toISOString(),
    tileSize: TILE_SIZE,
    models,
  };

  writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
  console.log("=".repeat(60));
  console.log(`Generated: ${outputPath}`);
  console.log(`Total models: ${models.length}`);
  console.log("=".repeat(60));
}

main();
