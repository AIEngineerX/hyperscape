/**
 * Vertex Color Optimization Service
 *
 * Service for optimizing GLB models to use vertex colors instead of textures.
 * This improves GPU performance by eliminating texture sampling overhead.
 *
 * Operations:
 * - Analyze: Check if model has vertex colors and/or textures
 * - Strip: Remove textures from models that already have vertex colors
 */

// GLB constants
const GLB_MAGIC = 0x46546c67; // 'glTF'

interface GLTFAnalysis {
  hasVertexColors: boolean;
  hasTextures: boolean;
  textureCount: number;
  embeddedImageCount: number;
  materialTextureRefs: number;
  binarySize: number;
  fileSize: number;
  vertexCount: number;
  faceCount: number;
}

interface StripResult {
  success: boolean;
  modified: boolean;
  newBuffer?: Buffer;
  originalSize: number;
  newSize: number;
  savedBytes: number;
  error?: string;
}

interface GLTF {
  meshes?: Array<{
    primitives: Array<{
      attributes: Record<string, number>;
      indices?: number;
    }>;
  }>;
  materials?: Array<{
    pbrMetallicRoughness?: {
      baseColorTexture?: unknown;
      baseColorFactor?: number[];
      metallicRoughnessTexture?: unknown;
    };
    normalTexture?: unknown;
    occlusionTexture?: unknown;
    emissiveTexture?: unknown;
  }>;
  textures?: unknown[];
  images?: unknown[];
  samplers?: unknown[];
  accessors?: Array<{ count: number; bufferView?: number }>;
  bufferViews?: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    target?: number;
  }>;
  buffers?: Array<{ byteLength: number }>;
}

export class VertexColorService {
  /**
   * Analyze a GLB file for vertex colors and textures
   */
  analyzeGLB(buffer: Buffer): GLTFAnalysis | { error: string } {
    if (buffer.length < 12) {
      return { error: "Buffer too small" };
    }

    // GLB header: magic(4) + version(4) + length(4)
    const magic = buffer.readUInt32LE(0);
    if (magic !== GLB_MAGIC) {
      return { error: "Not a valid GLB file" };
    }

    // Find JSON chunk
    const jsonChunkLength = buffer.readUInt32LE(12);
    const jsonChunkType = buffer.readUInt32LE(16);

    if (jsonChunkType !== 0x4e4f534a) {
      // 'JSON'
      return { error: "No JSON chunk found" };
    }

    const jsonData = buffer.subarray(20, 20 + jsonChunkLength).toString("utf8");
    const gltf = JSON.parse(jsonData) as GLTF;

    // Check for vertex colors (COLOR_0 attribute in primitives)
    let hasVertexColors = false;
    let vertexCount = 0;
    let faceCount = 0;

    if (gltf.meshes) {
      for (const mesh of gltf.meshes) {
        if (mesh.primitives) {
          for (const prim of mesh.primitives) {
            if (prim.attributes && prim.attributes.COLOR_0 !== undefined) {
              hasVertexColors = true;
            }
            // Count vertices and faces
            if (prim.attributes.POSITION !== undefined && gltf.accessors) {
              const posAccessor = gltf.accessors[prim.attributes.POSITION];
              if (posAccessor) {
                vertexCount += posAccessor.count;
              }
            }
            if (prim.indices !== undefined && gltf.accessors) {
              const idxAccessor = gltf.accessors[prim.indices];
              if (idxAccessor) {
                faceCount += Math.floor(idxAccessor.count / 3);
              }
            }
          }
        }
      }
    }

    // Check for textures
    let hasTextures = false;
    let textureCount = 0;
    let embeddedImageCount = 0;

    if (gltf.textures && gltf.textures.length > 0) {
      hasTextures = true;
      textureCount = gltf.textures.length;
    }

    if (gltf.images) {
      embeddedImageCount = gltf.images.length;
      if (embeddedImageCount > 0) hasTextures = true;
    }

    // Check material texture references
    let materialTextureRefs = 0;
    if (gltf.materials) {
      for (const mat of gltf.materials) {
        if (mat.pbrMetallicRoughness) {
          if (mat.pbrMetallicRoughness.baseColorTexture) materialTextureRefs++;
          if (mat.pbrMetallicRoughness.metallicRoughnessTexture)
            materialTextureRefs++;
        }
        if (mat.normalTexture) materialTextureRefs++;
        if (mat.occlusionTexture) materialTextureRefs++;
        if (mat.emissiveTexture) materialTextureRefs++;
      }
    }

    // Calculate binary chunk size (images)
    let binarySize = 0;
    const binaryChunkOffset = 20 + jsonChunkLength;
    if (buffer.length > binaryChunkOffset + 8) {
      binarySize = buffer.readUInt32LE(binaryChunkOffset);
    }

    return {
      hasVertexColors,
      hasTextures,
      textureCount,
      embeddedImageCount,
      materialTextureRefs,
      binarySize,
      fileSize: buffer.length,
      vertexCount,
      faceCount,
    };
  }

  /**
   * Strip textures from a GLB that has vertex colors
   * Keeps vertex colors and removes all texture references
   */
  stripTextures(buffer: Buffer): StripResult {
    const analysis = this.analyzeGLB(buffer);
    if ("error" in analysis) {
      return {
        success: false,
        modified: false,
        originalSize: buffer.length,
        newSize: buffer.length,
        savedBytes: 0,
        error: analysis.error,
      };
    }

    if (!analysis.hasVertexColors) {
      return {
        success: false,
        modified: false,
        originalSize: buffer.length,
        newSize: buffer.length,
        savedBytes: 0,
        error: "No vertex colors found - cannot strip textures safely",
      };
    }

    if (!analysis.hasTextures) {
      return {
        success: true,
        modified: false,
        originalSize: buffer.length,
        newSize: buffer.length,
        savedBytes: 0,
      };
    }

    // Parse GLB
    const jsonChunkLength = buffer.readUInt32LE(12);
    const jsonData = buffer.subarray(20, 20 + jsonChunkLength).toString("utf8");
    const gltf = JSON.parse(jsonData) as GLTF;

    // Remove texture references from materials
    if (gltf.materials) {
      for (const mat of gltf.materials) {
        if (mat.pbrMetallicRoughness) {
          if (mat.pbrMetallicRoughness.baseColorTexture) {
            if (!mat.pbrMetallicRoughness.baseColorFactor) {
              mat.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1];
            }
            delete mat.pbrMetallicRoughness.baseColorTexture;
          }
          if (mat.pbrMetallicRoughness.metallicRoughnessTexture) {
            delete mat.pbrMetallicRoughness.metallicRoughnessTexture;
          }
        }
        if (mat.normalTexture) delete mat.normalTexture;
        if (mat.occlusionTexture) delete mat.occlusionTexture;
        if (mat.emissiveTexture) delete mat.emissiveTexture;
      }
    }

    // Remove textures, samplers, images
    if (gltf.textures) gltf.textures = [];
    if (gltf.samplers) gltf.samplers = [];
    if (gltf.images) gltf.images = [];

    // Find which buffer views are used by accessors (geometry data)
    const usedBufferViews = new Set<number>();
    if (gltf.accessors) {
      for (const accessor of gltf.accessors) {
        if (accessor.bufferView !== undefined) {
          usedBufferViews.add(accessor.bufferView);
        }
      }
    }

    // Get original binary chunk
    const binaryChunkOffset = 20 + jsonChunkLength;
    let originalBinary = Buffer.alloc(0);
    if (buffer.length > binaryChunkOffset + 8) {
      const binaryLength = buffer.readUInt32LE(binaryChunkOffset);
      originalBinary = buffer.subarray(
        binaryChunkOffset + 8,
        binaryChunkOffset + 8 + binaryLength,
      );
    }

    // Build new binary chunk with only geometry data
    const newBufferViews: Array<{
      buffer: number;
      byteOffset: number;
      byteLength: number;
      byteStride?: number;
      target?: number;
    }> = [];
    const bufferViewMapping = new Map<number, number>();
    const newBinaryParts: Buffer[] = [];
    let currentOffset = 0;

    if (gltf.bufferViews) {
      for (let i = 0; i < gltf.bufferViews.length; i++) {
        if (usedBufferViews.has(i)) {
          const view = gltf.bufferViews[i];
          const byteOffset = view.byteOffset ?? 0;
          const data = originalBinary.subarray(
            byteOffset,
            byteOffset + view.byteLength,
          );

          // Align to 4 bytes
          const padding = (4 - (currentOffset % 4)) % 4;
          if (padding > 0) {
            newBinaryParts.push(Buffer.alloc(padding));
            currentOffset += padding;
          }

          bufferViewMapping.set(i, newBufferViews.length);
          newBufferViews.push({
            buffer: 0,
            byteOffset: currentOffset,
            byteLength: view.byteLength,
            ...(view.byteStride && { byteStride: view.byteStride }),
            ...(view.target && { target: view.target }),
          });

          newBinaryParts.push(data);
          currentOffset += view.byteLength;
        }
      }
    }

    // Update accessor buffer view references
    if (gltf.accessors) {
      for (const accessor of gltf.accessors) {
        if (accessor.bufferView !== undefined) {
          const newIdx = bufferViewMapping.get(accessor.bufferView);
          if (newIdx !== undefined) {
            accessor.bufferView = newIdx;
          }
        }
      }
    }

    gltf.bufferViews = newBufferViews;

    // Combine binary parts
    const newBinary = Buffer.concat(newBinaryParts);

    // Pad binary to 4-byte alignment
    const binaryPadding = (4 - (newBinary.length % 4)) % 4;
    const paddedBinary =
      binaryPadding > 0
        ? Buffer.concat([newBinary, Buffer.alloc(binaryPadding)])
        : newBinary;

    // Update buffer length
    if (gltf.buffers && gltf.buffers.length > 0) {
      gltf.buffers[0].byteLength = paddedBinary.length;
    }

    // Serialize JSON
    const jsonString = JSON.stringify(gltf);
    let jsonBuffer = Buffer.from(jsonString, "utf8");

    // Pad JSON to 4-byte alignment
    const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
    if (jsonPadding > 0) {
      jsonBuffer = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPadding, 0x20)]);
    }

    // Build GLB
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); // 'glTF'
    header.writeUInt32LE(2, 4); // version
    header.writeUInt32LE(
      12 + 8 + jsonBuffer.length + 8 + paddedBinary.length,
      8,
    );

    const jsonChunkHeader = Buffer.alloc(8);
    jsonChunkHeader.writeUInt32LE(jsonBuffer.length, 0);
    jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

    const binaryChunkHeader = Buffer.alloc(8);
    binaryChunkHeader.writeUInt32LE(paddedBinary.length, 0);
    binaryChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

    const newGLB = Buffer.concat([
      header,
      jsonChunkHeader,
      jsonBuffer,
      binaryChunkHeader,
      paddedBinary,
    ]);

    return {
      success: true,
      modified: true,
      newBuffer: newGLB,
      originalSize: buffer.length,
      newSize: newGLB.length,
      savedBytes: buffer.length - newGLB.length,
    };
  }

  /**
   * Analyze a GLB file from path
   */
  async analyzeGLBFile(
    filePath: string,
  ): Promise<GLTFAnalysis | { error: string }> {
    const buffer = Buffer.from(await Bun.file(filePath).arrayBuffer());
    return this.analyzeGLB(buffer);
  }

  /**
   * Strip textures from a GLB file
   */
  async stripTexturesFromFile(
    inputPath: string,
    outputPath?: string,
  ): Promise<StripResult> {
    const buffer = Buffer.from(await Bun.file(inputPath).arrayBuffer());
    const result = this.stripTextures(buffer);

    if (result.success && result.modified && result.newBuffer) {
      const outPath = outputPath || inputPath;
      await Bun.write(outPath, result.newBuffer);
    }

    return result;
  }
}

export type { GLTFAnalysis, StripResult };
