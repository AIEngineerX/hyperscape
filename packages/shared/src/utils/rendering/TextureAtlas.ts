/**
 * TextureAtlas - Utility for packing multiple textures into a single atlas
 *
 * Reduces texture binding overhead by combining related textures.
 * Provides UV offset/scale data for shader sampling.
 *
 * Usage:
 * ```typescript
 * const atlas = new TextureAtlas(2048, 2);
 * atlas.addTexture('grass', grassTexture);
 * atlas.addTexture('dirt', dirtTexture);
 * const { atlas: atlasTexture, uvMap } = atlas.generate();
 * // uvMap.get('grass') = { offset: [0, 0], scale: [0.5, 0.5] }
 * ```
 */

import * as THREE from "../../extras/three/three";
import { Logger } from "../Logger";

/**
 * UV mapping data for a texture in the atlas
 */
export interface AtlasUVData {
  /** UV offset (x, y) from 0-1 */
  offset: [number, number];
  /** UV scale (x, y) - typically 1/gridSize */
  scale: [number, number];
  /** Grid position (row, column) */
  gridPosition: [number, number];
}

/**
 * Result of atlas generation
 */
export interface AtlasResult {
  /** The generated atlas texture */
  atlas: THREE.Texture;
  /** Map of texture ID to UV data */
  uvMap: Map<string, AtlasUVData>;
  /** Atlas resolution */
  resolution: number;
  /** Grid size (textures per row/column) */
  gridSize: number;
}

/**
 * Texture atlas generator
 */
export class TextureAtlas {
  private resolution: number;
  private gridSize: number;
  private textures: Map<string, THREE.Texture> = new Map();
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  /**
   * Create a new texture atlas
   * @param resolution Total atlas resolution (e.g., 2048 for 2048x2048)
   * @param gridSize Number of textures per row/column (e.g., 2 for 2x2 = 4 textures)
   */
  constructor(resolution: number = 2048, gridSize: number = 2) {
    this.resolution = resolution;
    this.gridSize = gridSize;

    // Only create canvas in browser environment
    if (typeof document !== "undefined") {
      this.canvas = document.createElement("canvas");
      this.canvas.width = resolution;
      this.canvas.height = resolution;
      this.ctx = this.canvas.getContext("2d");
    }
  }

  /**
   * Add a texture to the atlas
   * @param id Unique identifier for the texture
   * @param texture The texture to add
   * @returns true if added, false if atlas is full
   */
  addTexture(id: string, texture: THREE.Texture): boolean {
    const maxTextures = this.gridSize * this.gridSize;
    if (this.textures.size >= maxTextures) {
      Logger.warn(`[TextureAtlas] Atlas is full (${maxTextures} textures max)`);
      return false;
    }

    this.textures.set(id, texture);
    return true;
  }

  /**
   * Generate the atlas texture
   * @returns Atlas texture and UV mapping data
   */
  generate(): AtlasResult | null {
    if (!this.ctx || !this.canvas) {
      Logger.warn("[TextureAtlas] Canvas not available (server-side?)");
      return null;
    }

    const uvMap = new Map<string, AtlasUVData>();
    const cellSize = this.resolution / this.gridSize;
    let index = 0;

    // Clear canvas with a neutral color (for padding)
    this.ctx.fillStyle = "#808080";
    this.ctx.fillRect(0, 0, this.resolution, this.resolution);

    for (const [id, texture] of this.textures) {
      const row = Math.floor(index / this.gridSize);
      const col = index % this.gridSize;
      const x = col * cellSize;
      const y = row * cellSize;

      // Draw texture to atlas
      this.drawTextureToAtlas(texture, x, y, cellSize);

      // Store UV data
      const scale = 1 / this.gridSize;
      uvMap.set(id, {
        offset: [col * scale, row * scale],
        scale: [scale, scale],
        gridPosition: [row, col],
      });

      index++;
    }

    // Create THREE.js texture from canvas
    const atlas = new THREE.CanvasTexture(this.canvas);
    atlas.wrapS = THREE.RepeatWrapping;
    atlas.wrapT = THREE.RepeatWrapping;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.anisotropy = 16;
    atlas.generateMipmaps = true;
    atlas.needsUpdate = true;

    return {
      atlas,
      uvMap,
      resolution: this.resolution,
      gridSize: this.gridSize,
    };
  }

  /**
   * Draw a texture to the atlas canvas
   */
  private drawTextureToAtlas(
    texture: THREE.Texture,
    x: number,
    y: number,
    size: number,
  ): void {
    if (!this.ctx) return;

    // Get the texture image source
    const image = texture.image;

    if (
      image instanceof HTMLImageElement ||
      image instanceof HTMLCanvasElement
    ) {
      // Draw the image scaled to fit the cell
      this.ctx.drawImage(image, x, y, size, size);
    } else if (
      image &&
      "data" in image &&
      "width" in image &&
      "height" in image
    ) {
      // For ImageData or DataTexture, create a temporary canvas
      const imgData = image as {
        data: Uint8ClampedArray | Uint8Array;
        width: number;
        height: number;
      };
      const imageData = new globalThis.ImageData(
        new Uint8ClampedArray(imgData.data),
        imgData.width,
        imgData.height,
      );
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = imgData.width;
      tempCanvas.height = imgData.height;
      const tempCtx = tempCanvas.getContext("2d");
      if (tempCtx) {
        tempCtx.putImageData(imageData, 0, 0);
        this.ctx.drawImage(tempCanvas, x, y, size, size);
      }
    } else {
      // Fallback: fill with placeholder color
      Logger.warn(
        "[TextureAtlas] Unknown texture image type, using placeholder",
      );
      this.ctx.fillStyle = "#ff00ff";
      this.ctx.fillRect(x, y, size, size);
    }
  }

  /**
   * Dispose of atlas resources
   */
  dispose(): void {
    this.textures.clear();
    this.canvas = null;
    this.ctx = null;
  }
}

/**
 * Create a terrain texture atlas from multiple terrain textures
 * Packs grass, dirt, rock, snow into a 2x2 atlas
 *
 * @param textures Map of texture type to texture
 * @param resolution Atlas resolution (default 2048)
 * @returns Atlas result or null if failed
 */
export function createTerrainAtlas(
  textures: Map<string, THREE.Texture>,
  resolution: number = 2048,
): AtlasResult | null {
  const atlas = new TextureAtlas(resolution, 2); // 2x2 grid = 4 textures

  // Add textures in specific order for predictable UV mapping
  const orderedTypes = ["grass", "dirt", "rock", "snow"];

  for (const type of orderedTypes) {
    const texture = textures.get(type);
    if (texture) {
      atlas.addTexture(type, texture);
    }
  }

  const result = atlas.generate();

  if (result) {
    Logger.info(
      `[TextureAtlas] Created terrain atlas: ${resolution}x${resolution}, ${result.uvMap.size} textures`,
    );
  }

  return result;
}

/**
 * TSL helper: Convert atlas UV map to THREE.Vector2 uniforms for shaders
 */
export function createAtlasUniforms(
  uvMap: Map<string, AtlasUVData>,
): Map<string, { offset: THREE.Vector2; scale: THREE.Vector2 }> {
  const uniforms = new Map<
    string,
    { offset: THREE.Vector2; scale: THREE.Vector2 }
  >();
  for (const [id, { offset, scale }] of uvMap) {
    uniforms.set(id, {
      offset: new THREE.Vector2(offset[0], offset[1]),
      scale: new THREE.Vector2(scale[0], scale[1]),
    });
  }
  return uniforms;
}
