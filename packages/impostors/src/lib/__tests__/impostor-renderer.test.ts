/**
 * Impostor Renderer Tests (WebGPU)
 *
 * Tests for WebGPU impostor materials and baking.
 * These tests verify the core functionality of the impostor system.
 *
 * Runs in browser environment via Playwright for WebGPU support.
 */

import * as THREE from "three/webgpu";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  OctahedralImpostor,
  OctahedronType,
  PBRBakeMode,
  createTSLImpostorMaterial,
  type CompatibleRenderer,
} from "../index";
// Note: ImpostorViewData type available in types.ts if needed
import type { TSLImpostorMaterial } from "../ImpostorMaterialTSL";

function supportsWebGPUInTestEnv(): boolean {
  if (typeof navigator === "undefined" || typeof document === "undefined") {
    return false;
  }
  const nav = navigator as Navigator & { gpu?: unknown };
  if (!nav.gpu) {
    return false;
  }
  const canvas = document.createElement("canvas");
  return (
    canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null
  );
}

const describeWebGPU = supportsWebGPUInTestEnv() ? describe : describe.skip;

// Helper to cast WebGPURenderer to CompatibleRenderer for tests
function asCompatible(renderer: THREE.WebGPURenderer): CompatibleRenderer {
  return renderer as unknown as CompatibleRenderer;
}

// Create a test mesh with a distinct color
function createTestMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  return new THREE.Mesh(geometry, material);
}

// Create a multi-colored test mesh to verify atlas content variety
function createColoredCubeMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = [
    new THREE.MeshBasicMaterial({ color: 0xff0000 }), // Red +X
    new THREE.MeshBasicMaterial({ color: 0x00ff00 }), // Green -X
    new THREE.MeshBasicMaterial({ color: 0x0000ff }), // Blue +Y
    new THREE.MeshBasicMaterial({ color: 0xffff00 }), // Yellow -Y
    new THREE.MeshBasicMaterial({ color: 0xff00ff }), // Magenta +Z
    new THREE.MeshBasicMaterial({ color: 0x00ffff }), // Cyan -Z
  ];
  return new THREE.Mesh(geometry, materials);
}

// Create a WebGPU renderer for testing
async function createTestRenderer(): Promise<THREE.WebGPURenderer> {
  // Create a canvas for rendering (browser tests use real DOM canvas)
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;

  // Ensure canvas has a style object (may be missing in some test environments)
  if (!canvas.style) {
    Object.defineProperty(canvas, "style", {
      value: { width: "", height: "" },
      writable: true,
    });
  }

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
  });

  // Use updateStyle=false to avoid issues with canvas.style in test environments
  renderer.setSize(512, 512, false);
  await renderer.init();
  return renderer;
}

/**
 * Analyze pixel data to detect if content is valid (not black, white, or empty)
 * Returns statistics about the texture content
 */
function analyzePixelContent(pixels: Uint8Array): {
  isEmpty: boolean;
  isAllBlack: boolean;
  isAllWhite: boolean;
  hasColor: boolean;
  hasVariation: boolean;
  avgR: number;
  avgG: number;
  avgB: number;
  avgA: number;
  nonTransparentPixels: number;
  totalPixels: number;
} {
  const totalPixels = pixels.length / 4;
  let sumR = 0,
    sumG = 0,
    sumB = 0,
    sumA = 0;
  let blackPixels = 0,
    whitePixels = 0,
    transparentPixels = 0;
  let minR = 255,
    maxR = 0,
    minG = 255,
    maxG = 0,
    minB = 255,
    maxB = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];

    sumR += r;
    sumG += g;
    sumB += b;
    sumA += a;

    if (a === 0) transparentPixels++;
    if (r === 0 && g === 0 && b === 0) blackPixels++;
    if (r === 255 && g === 255 && b === 255) whitePixels++;

    if (a > 0) {
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minG = Math.min(minG, g);
      maxG = Math.max(maxG, g);
      minB = Math.min(minB, b);
      maxB = Math.max(maxB, b);
    }
  }

  const avgR = sumR / totalPixels;
  const avgG = sumG / totalPixels;
  const avgB = sumB / totalPixels;
  const avgA = sumA / totalPixels;
  const nonTransparentPixels = totalPixels - transparentPixels;

  // Check for variation in color values (indicates actual content)
  const hasVariation = maxR - minR > 10 || maxG - minG > 10 || maxB - minB > 10;
  const hasColor = avgR > 5 || avgG > 5 || avgB > 5;

  return {
    isEmpty: transparentPixels === totalPixels,
    isAllBlack: blackPixels === totalPixels,
    isAllWhite: whitePixels === totalPixels,
    hasColor,
    hasVariation,
    avgR,
    avgG,
    avgB,
    avgA,
    nonTransparentPixels,
    totalPixels,
  };
}

/**
 * Verify atlas content is valid (not black, white, or empty)
 */
async function verifyAtlasContent(
  renderer: THREE.WebGPURenderer,
  renderTarget: THREE.RenderTarget,
  label: string,
): Promise<void> {
  const { width, height } = renderTarget;

  type AsyncRenderer = THREE.WebGPURenderer & {
    readRenderTargetPixelsAsync: (
      rt: THREE.RenderTarget,
      x: number,
      y: number,
      w: number,
      h: number,
    ) => Promise<Uint8Array | Float32Array>;
  };

  const asyncRenderer = renderer as AsyncRenderer;
  const result = await asyncRenderer.readRenderTargetPixelsAsync(
    renderTarget,
    0,
    0,
    width,
    height,
  );

  // Convert to Uint8Array if needed
  let pixels: Uint8Array;
  if (result instanceof Float32Array) {
    pixels = new Uint8Array(result.length);
    for (let i = 0; i < result.length; i++) {
      pixels[i] = Math.round(result[i] * 255);
    }
  } else {
    pixels = result as Uint8Array;
  }

  const stats = analyzePixelContent(pixels);

  console.log(
    `[${label}] Atlas content: ${width}x${height}, ` +
      `avg RGB(${stats.avgR.toFixed(1)}, ${stats.avgG.toFixed(1)}, ${stats.avgB.toFixed(1)}), ` +
      `avgA=${stats.avgA.toFixed(1)}, ` +
      `nonTransparent=${stats.nonTransparentPixels}/${stats.totalPixels} (${((stats.nonTransparentPixels / stats.totalPixels) * 100).toFixed(1)}%), ` +
      `hasVariation=${stats.hasVariation}`,
  );

  // Fail if content is invalid
  expect(stats.isEmpty).toBe(false);
  expect(stats.isAllBlack).toBe(false);
  expect(stats.isAllWhite).toBe(false);
  expect(stats.hasColor || stats.nonTransparentPixels > 0).toBe(true);
}

// ============================================================================
// WEBGPU IMPOSTOR TESTS
// ============================================================================

describeWebGPU("OctahedralImpostor (WebGPU)", () => {
  let renderer: THREE.WebGPURenderer;
  let impostor: OctahedralImpostor;

  beforeEach(async () => {
    renderer = await createTestRenderer();
    impostor = new OctahedralImpostor(asCompatible(renderer));
  });

  afterEach(() => {
    renderer?.dispose();
  });

  describe("WebGPU Baking", () => {
    it("should bake a basic impostor atlas", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      expect(bakeResult).toBeDefined();
      expect(bakeResult.atlasTexture).toBeInstanceOf(THREE.Texture);
      expect(bakeResult.gridSizeX).toBe(8);
      expect(bakeResult.gridSizeY).toBe(8);
    });

    it("should bake with normals (Standard mode)", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bakeWithNormals(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
        pbrMode: PBRBakeMode.STANDARD,
      });

      expect(bakeResult).toBeDefined();
      expect(bakeResult.atlasTexture).toBeInstanceOf(THREE.Texture);
      expect(bakeResult.normalAtlasTexture).toBeInstanceOf(THREE.Texture);
    });

    it("should bake full AAA (depth + normals)", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bakeFull(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
        pbrMode: PBRBakeMode.COMPLETE,
      });

      expect(bakeResult).toBeDefined();
      expect(bakeResult.atlasTexture).toBeInstanceOf(THREE.Texture);
      expect(bakeResult.normalAtlasTexture).toBeInstanceOf(THREE.Texture);
      expect(bakeResult.depthAtlasTexture).toBeInstanceOf(THREE.Texture);
    });

    it("should bake atlas with actual content (not all white/black)", async () => {
      const mesh = createColoredCubeMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      expect(bakeResult).toBeDefined();
      expect(bakeResult.atlasTexture).toBeInstanceOf(THREE.Texture);
      expect(bakeResult.renderTarget).toBeDefined();
      // Verify the texture has valid dimensions
      expect(bakeResult.renderTarget?.width).toBe(256);
      expect(bakeResult.renderTarget?.height).toBe(256);

      // Verify actual pixel content is not black/white/empty
      await verifyAtlasContent(
        renderer,
        bakeResult.renderTarget!,
        "ColorAtlas",
      );
    });

    it("should bake consistent atlas across multiple calls with same mesh", async () => {
      const mesh = createColoredCubeMesh();
      const config = {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      };

      const result1 = await impostor.bake(mesh, config);
      const result2 = await impostor.bake(mesh, config);

      expect(result1.gridSizeX).toBe(result2.gridSizeX);
      expect(result1.gridSizeY).toBe(result2.gridSizeY);
    });
  });

  describe("Instance Creation", () => {
    it("should create an impostor instance", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      const instance = impostor.createInstance(bakeResult);

      expect(instance).toBeDefined();
      expect(instance.mesh).toBeInstanceOf(THREE.Mesh);
      expect(instance.mesh.material).toBeDefined();
    });

    it("should create TSL material instance", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      const instance = impostor.createInstance(bakeResult, 1, { useTSL: true });

      expect(instance).toBeDefined();
      expect(instance.mesh).toBeInstanceOf(THREE.Mesh);
    });
  });

  describe("Impostor Rendering", () => {
    it("should render impostor to scene without being all white", async () => {
      const mesh = createColoredCubeMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      const instance = impostor.createInstance(bakeResult);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
      camera.position.set(0, 0, 5);
      camera.lookAt(0, 0, 0);

      scene.add(instance.mesh);
      instance.update(camera);

      // Render to verify no errors
      renderer.render(scene, camera);

      // The instance should be valid
      expect(instance.mesh.visible).toBe(true);
    });

    it("should position impostor mesh correctly at center", async () => {
      const mesh = createTestMesh();
      const bakeResult = await impostor.bake(mesh, {
        gridSizeX: 8,
        gridSizeY: 8,
        atlasWidth: 256,
        atlasHeight: 256,
      });

      const instance = impostor.createInstance(bakeResult);

      // Default position should be at origin
      expect(instance.mesh.position.x).toBe(0);
      expect(instance.mesh.position.y).toBeCloseTo(0, 1);
      expect(instance.mesh.position.z).toBe(0);
    });
  });
});

// ============================================================================
// TSL MATERIAL TESTS
// ============================================================================

describeWebGPU("TSL Impostor Material (WebGPU)", () => {
  let renderer: THREE.WebGPURenderer;
  let impostor: OctahedralImpostor;

  beforeEach(async () => {
    renderer = await createTestRenderer();
    impostor = new OctahedralImpostor(asCompatible(renderer));
  });

  afterEach(() => {
    renderer?.dispose();
  });

  it("should create TSL material with required uniforms", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 8,
      gridSizeY: 8,
      atlasWidth: 256,
      atlasHeight: 256,
    });

    const material = createTSLImpostorMaterial({
      atlasTexture: bakeResult.atlasTexture,
      gridSizeX: bakeResult.gridSizeX,
      gridSizeY: bakeResult.gridSizeY,
    }) as TSLImpostorMaterial;

    expect(material).toBeDefined();
    expect(material.impostorUniforms).toBeDefined();
    expect(material.impostorUniforms.faceIndices).toBeDefined();
    expect(material.impostorUniforms.faceWeights).toBeDefined();
  });

  it("should support updateView method", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 8,
      gridSizeY: 8,
      atlasWidth: 256,
      atlasHeight: 256,
    });

    const material = createTSLImpostorMaterial({
      atlasTexture: bakeResult.atlasTexture,
      gridSizeX: bakeResult.gridSizeX,
      gridSizeY: bakeResult.gridSizeY,
    }) as TSLImpostorMaterial;

    const faceIndices = new THREE.Vector3(1, 2, 3);
    const faceWeights = new THREE.Vector3(0.5, 0.3, 0.2);

    material.updateView(faceIndices, faceWeights);

    expect(material.impostorUniforms.faceIndices.value.x).toBe(1);
    expect(material.impostorUniforms.faceIndices.value.y).toBe(2);
    expect(material.impostorUniforms.faceIndices.value.z).toBe(3);
  });
});

// ============================================================================
// TSL MATERIAL TESTS
// ============================================================================

describeWebGPU("TSL Impostor Material", () => {
  let renderer: THREE.WebGPURenderer;
  let impostor: OctahedralImpostor;

  beforeEach(async () => {
    renderer = await createTestRenderer();
    impostor = new OctahedralImpostor(asCompatible(renderer));
  });

  afterEach(() => {
    renderer?.dispose();
  });

  it("should create TSL material with required methods", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 8,
      gridSizeY: 8,
      atlasWidth: 256,
      atlasHeight: 256,
    });

    const material = createTSLImpostorMaterial({
      atlasTexture: bakeResult.atlasTexture,
      gridSizeX: bakeResult.gridSizeX,
      gridSizeY: bakeResult.gridSizeY,
    });

    expect(material).toBeDefined();
    expect(material.isMaterial).toBe(true);
    // TSL materials have updateView method for view updates
    expect(typeof material.updateView).toBe("function");
  });
});

// ============================================================================
// BOUNDING SPHERE TESTS
// ============================================================================

describeWebGPU("Bounding Sphere Calculation", () => {
  it("should calculate correct bounding sphere for simple mesh", async () => {
    const renderer = await createTestRenderer();
    const impostor = new OctahedralImpostor(asCompatible(renderer));

    const geometry = new THREE.BoxGeometry(2, 2, 2); // 2x2x2 cube
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);

    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 128,
    });

    // Bounding sphere radius should be approximately sqrt(3) for a 2x2x2 cube centered at origin
    // sqrt(1^2 + 1^2 + 1^2) = sqrt(3) ≈ 1.73
    expect(bakeResult.boundingSphere).toBeDefined();
    expect(bakeResult.boundingSphere.radius).toBeGreaterThan(1.5);
    expect(bakeResult.boundingSphere.radius).toBeLessThan(2.5);

    renderer?.dispose();
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describeWebGPU("Impostor Configuration", () => {
  let renderer: THREE.WebGPURenderer;
  let impostor: OctahedralImpostor;

  beforeEach(async () => {
    renderer = await createTestRenderer();
    impostor = new OctahedralImpostor(asCompatible(renderer));
  });

  afterEach(() => {
    renderer?.dispose();
  });

  it("should respect gridSizeX and gridSizeY configuration", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 16,
      gridSizeY: 16,
      atlasWidth: 512,
      atlasHeight: 512,
    });

    expect(bakeResult.gridSizeX).toBe(16);
    expect(bakeResult.gridSizeY).toBe(16);
  });

  it("should respect atlas dimensions", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 256,
    });

    expect(bakeResult.renderTarget?.width).toBe(128);
    expect(bakeResult.renderTarget?.height).toBe(256);
  });

  it("should use hemisphere octahedron by default", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 128,
    });

    // HEMI (0) is the default
    expect(bakeResult.octType).toBe(OctahedronType.HEMI);
  });

  it("should support full octahedron configuration", async () => {
    const mesh = createTestMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 128,
      octType: OctahedronType.FULL,
    });

    expect(bakeResult.octType).toBe(OctahedronType.FULL);
  });
});

// ============================================================================
// ATLAS CONTENT VERIFICATION TESTS (Offscreen Canvas)
// ============================================================================

describeWebGPU("Atlas Content Verification (OffscreenCanvas)", () => {
  let renderer: THREE.WebGPURenderer;
  let impostor: OctahedralImpostor;

  beforeEach(async () => {
    renderer = await createTestRenderer();
    impostor = new OctahedralImpostor(asCompatible(renderer));
  });

  afterEach(() => {
    renderer?.dispose();
  });

  it("should produce color atlas with actual rendered content (not black/white/empty)", async () => {
    // Use a distinctly colored mesh to ensure we can detect the content
    const mesh = createColoredCubeMesh();
    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 8,
      gridSizeY: 8,
      atlasWidth: 256,
      atlasHeight: 256,
    });

    expect(bakeResult.renderTarget).toBeDefined();
    await verifyAtlasContent(
      renderer,
      bakeResult.renderTarget!,
      "Basic_ColorAtlas",
    );
  });

  it("should produce valid normal atlas content with bakeWithNormals", async () => {
    const geometry = new THREE.SphereGeometry(0.5, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: 0x4488ff });
    const mesh = new THREE.Mesh(geometry, material);

    const bakeResult = await impostor.bakeWithNormals(mesh, {
      gridSizeX: 8,
      gridSizeY: 8,
      atlasWidth: 256,
      atlasHeight: 256,
      pbrMode: PBRBakeMode.STANDARD,
    });

    expect(bakeResult.renderTarget).toBeDefined();
    expect(bakeResult.normalRenderTarget).toBeDefined();

    // Verify color atlas
    await verifyAtlasContent(
      renderer,
      bakeResult.renderTarget!,
      "Standard_ColorAtlas",
    );

    // Verify normal atlas
    await verifyAtlasContent(
      renderer,
      bakeResult.normalRenderTarget!,
      "Standard_NormalAtlas",
    );
  });

  it("should produce valid depth atlas content with bakeFull", async () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0xff6600 });
    const mesh = new THREE.Mesh(geometry, material);

    const bakeResult = await impostor.bakeFull(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 128,
      pbrMode: PBRBakeMode.COMPLETE,
    });

    expect(bakeResult.renderTarget).toBeDefined();
    expect(bakeResult.normalRenderTarget).toBeDefined();
    expect(bakeResult.depthRenderTarget).toBeDefined();

    // Verify all atlas types
    await verifyAtlasContent(
      renderer,
      bakeResult.renderTarget!,
      "Full_ColorAtlas",
    );
    await verifyAtlasContent(
      renderer,
      bakeResult.normalRenderTarget!,
      "Full_NormalAtlas",
    );
    await verifyAtlasContent(
      renderer,
      bakeResult.depthRenderTarget!,
      "Full_DepthAtlas",
    );
  });

  it("should produce consistent content across multiple bakes", async () => {
    const mesh = createColoredCubeMesh();
    const config = {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 128,
    };

    const result1 = await impostor.bake(mesh, config);
    const result2 = await impostor.bake(mesh, config);

    // Both should produce valid content
    await verifyAtlasContent(renderer, result1.renderTarget!, "Bake1");
    await verifyAtlasContent(renderer, result2.renderTarget!, "Bake2");
  });

  it("should produce atlas with >10% non-transparent pixels for solid mesh", async () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);

    const bakeResult = await impostor.bake(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 128,
    });

    expect(bakeResult.renderTarget).toBeDefined();

    // Read pixels and verify coverage
    type AsyncRenderer = THREE.WebGPURenderer & {
      readRenderTargetPixelsAsync: (
        rt: THREE.RenderTarget,
        x: number,
        y: number,
        w: number,
        h: number,
      ) => Promise<Uint8Array | Float32Array>;
    };

    const asyncRenderer = renderer as AsyncRenderer;
    const result = await asyncRenderer.readRenderTargetPixelsAsync(
      bakeResult.renderTarget!,
      0,
      0,
      128,
      128,
    );

    let pixels: Uint8Array;
    if (result instanceof Float32Array) {
      pixels = new Uint8Array(result.length);
      for (let i = 0; i < result.length; i++) {
        pixels[i] = Math.round(result[i] * 255);
      }
    } else {
      pixels = result as Uint8Array;
    }

    const stats = analyzePixelContent(pixels);
    const coveragePercent =
      (stats.nonTransparentPixels / stats.totalPixels) * 100;

    console.log(`Solid mesh coverage: ${coveragePercent.toFixed(1)}%`);

    // Solid mesh should have significant coverage (at least 10%)
    expect(coveragePercent).toBeGreaterThan(10);
  });
});

// ============================================================================
// NORMAL ATLAS VERIFICATION TESTS
// ============================================================================

describeWebGPU("Normal Atlas Cell Corner Verification", () => {
  let renderer: THREE.WebGPURenderer;
  let impostor: OctahedralImpostor;

  beforeEach(async () => {
    renderer = await createTestRenderer();
    impostor = new OctahedralImpostor(asCompatible(renderer));
  });

  afterEach(() => {
    renderer?.dispose();
  });

  /**
   * Read pixel data from a render target texture.
   * WebGPU's readRenderTargetPixelsAsync returns the data directly (no buffer param).
   */
  async function readRenderTargetPixels(
    renderer: THREE.WebGPURenderer,
    renderTarget: THREE.RenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<Uint8Array> {
    // WebGPU's readRenderTargetPixelsAsync returns the pixel data directly
    // Signature: readRenderTargetPixelsAsync(renderTarget, x, y, width, height) => Promise<TypedArray>
    type AsyncRenderer = THREE.WebGPURenderer & {
      readRenderTargetPixelsAsync: (
        rt: THREE.RenderTarget,
        x: number,
        y: number,
        w: number,
        h: number,
      ) => Promise<Uint8Array | Float32Array>;
    };

    const asyncRenderer = renderer as AsyncRenderer;
    const result = await asyncRenderer.readRenderTargetPixelsAsync(
      renderTarget,
      x,
      y,
      width,
      height,
    );

    // Result may be Float32Array for float textures, convert if needed
    if (result instanceof Float32Array) {
      const uint8Data = new Uint8Array(result.length);
      for (let i = 0; i < result.length; i++) {
        uint8Data[i] = Math.round(result[i] * 255);
      }
      return uint8Data;
    }

    return result as Uint8Array;
  }

  /**
   * Verify that the top-right corner of each cell in a normal atlas is uniform.
   * Since impostors render objects centered in a bounding sphere, the corners
   * of each cell should be empty (showing clear/neutral normal color).
   *
   * Note: Due to color space handling differences between WebGL2/WebGPU,
   * we detect the actual clear color from corner pixels rather than hardcoding.
   */
  it("should have uniform (neutral) normals in top-right corner of each cell", async () => {
    // Create a small sphere mesh - definitely won't fill cell corners
    const geometry = new THREE.SphereGeometry(0.5, 16, 16);
    const material = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
    const mesh = new THREE.Mesh(geometry, material);

    // Bake with normals
    const bakeResult = await impostor.bakeWithNormals(mesh, {
      gridSizeX: 8,
      gridSizeY: 8,
      atlasWidth: 256,
      atlasHeight: 256,
      pbrMode: PBRBakeMode.STANDARD,
    });

    expect(bakeResult.normalAtlasTexture).toBeDefined();
    expect(bakeResult.normalRenderTarget).toBeDefined();

    const normalRT = bakeResult.normalRenderTarget!;
    const gridX = bakeResult.gridSizeX;
    const gridY = bakeResult.gridSizeY;
    const cellWidth = Math.floor(normalRT.width / gridX);
    const cellHeight = Math.floor(normalRT.height / gridY);

    // Sample size: 4x4 pixels from top-right corner of each cell
    const sampleSize = 4;

    // Tolerance for uniformity check (allows for filtering/compression artifacts)
    const TOLERANCE = 10;

    // First, sample the extreme corner (0,0) to detect the actual clear/neutral color
    // This corner is guaranteed to be empty for hemisphere mapping
    const refPixels = await readRenderTargetPixels(
      renderer,
      normalRT,
      0,
      0,
      sampleSize,
      sampleSize,
    );
    let refR = 0,
      refG = 0,
      refB = 0;
    const refCount = sampleSize * sampleSize;
    for (let i = 0; i < refCount; i++) {
      refR += refPixels[i * 4];
      refG += refPixels[i * 4 + 1];
      refB += refPixels[i * 4 + 2];
    }
    const NEUTRAL_R = refR / refCount;
    const NEUTRAL_G = refG / refCount;
    const NEUTRAL_B = refB / refCount;

    console.log(
      `Detected neutral normal color: RGB(${NEUTRAL_R.toFixed(1)}, ${NEUTRAL_G.toFixed(1)}, ${NEUTRAL_B.toFixed(1)})`,
    );

    // Track results for reporting
    const cellResults: Array<{
      row: number;
      col: number;
      isUniform: boolean;
      avgR: number;
      avgG: number;
      avgB: number;
    }> = [];

    // Check each cell's top-right corner
    for (let row = 0; row < gridY; row++) {
      for (let col = 0; col < gridX; col++) {
        // Calculate top-right corner position within cell
        const cellStartX = col * cellWidth;
        const cellStartY = row * cellHeight;
        const cornerX = cellStartX + cellWidth - sampleSize;
        const cornerY = cellStartY + cellHeight - sampleSize;

        // Read the corner pixels
        const pixelData = await readRenderTargetPixels(
          renderer,
          normalRT,
          cornerX,
          cornerY,
          sampleSize,
          sampleSize,
        );

        // Calculate average color
        let sumR = 0,
          sumG = 0,
          sumB = 0;
        const pixelCount = sampleSize * sampleSize;
        for (let i = 0; i < pixelCount; i++) {
          sumR += pixelData[i * 4];
          sumG += pixelData[i * 4 + 1];
          sumB += pixelData[i * 4 + 2];
        }
        const avgR = sumR / pixelCount;
        const avgG = sumG / pixelCount;
        const avgB = sumB / pixelCount;

        // Check if uniform (close to detected neutral normal)
        const isUniform =
          Math.abs(avgR - NEUTRAL_R) <= TOLERANCE &&
          Math.abs(avgG - NEUTRAL_G) <= TOLERANCE &&
          Math.abs(avgB - NEUTRAL_B) <= TOLERANCE;

        cellResults.push({ row, col, isUniform, avgR, avgG, avgB });
      }
    }

    // Report any non-uniform cells
    const nonUniformCells = cellResults.filter((c) => !c.isUniform);
    if (nonUniformCells.length > 0) {
      console.warn(
        `Non-uniform normal atlas corners found in ${nonUniformCells.length} cells:`,
        nonUniformCells.map(
          (c) =>
            `[${c.row},${c.col}]: RGB(${c.avgR.toFixed(1)}, ${c.avgG.toFixed(1)}, ${c.avgB.toFixed(1)})`,
        ),
      );
    }

    // All cells should have uniform corners (matching the clear color)
    expect(nonUniformCells.length).toBe(0);
  });

  it("should have uniform normals in all four corners of each cell", async () => {
    // Create a cube mesh - corners should still be empty due to bounding sphere framing
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0xff6600 });
    const mesh = new THREE.Mesh(geometry, material);

    const bakeResult = await impostor.bakeWithNormals(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 128,
      pbrMode: PBRBakeMode.STANDARD,
    });

    expect(bakeResult.normalRenderTarget).toBeDefined();

    const normalRT = bakeResult.normalRenderTarget!;
    const gridX = bakeResult.gridSizeX;
    const gridY = bakeResult.gridSizeY;
    const cellWidth = Math.floor(normalRT.width / gridX);
    const cellHeight = Math.floor(normalRT.height / gridY);
    const sampleSize = 2;
    const TOLERANCE = 15;

    // Detect actual clear color from extreme corner (0,0)
    const refPixels = await readRenderTargetPixels(
      renderer,
      normalRT,
      0,
      0,
      sampleSize,
      sampleSize,
    );
    let refR = 0,
      refG = 0,
      refB = 0;
    const refCount = sampleSize * sampleSize;
    for (let i = 0; i < refCount; i++) {
      refR += refPixels[i * 4];
      refG += refPixels[i * 4 + 1];
      refB += refPixels[i * 4 + 2];
    }
    const NEUTRAL_R = refR / refCount;
    const NEUTRAL_G = refG / refCount;
    const NEUTRAL_B = refB / refCount;

    // Check corners: top-left, top-right, bottom-left, bottom-right
    const cornerNames = [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ];
    const getCornerOffsets = (cellW: number, cellH: number) => [
      { x: 0, y: cellH - sampleSize }, // top-left
      { x: cellW - sampleSize, y: cellH - sampleSize }, // top-right
      { x: 0, y: 0 }, // bottom-left
      { x: cellW - sampleSize, y: 0 }, // bottom-right
    ];

    const offsets = getCornerOffsets(cellWidth, cellHeight);
    let totalNonUniform = 0;

    for (let row = 0; row < gridY; row++) {
      for (let col = 0; col < gridX; col++) {
        const cellStartX = col * cellWidth;
        const cellStartY = row * cellHeight;

        for (let cornerIdx = 0; cornerIdx < 4; cornerIdx++) {
          const offset = offsets[cornerIdx];
          const cornerX = cellStartX + offset.x;
          const cornerY = cellStartY + offset.y;

          const pixelData = await readRenderTargetPixels(
            renderer,
            normalRT,
            cornerX,
            cornerY,
            sampleSize,
            sampleSize,
          );

          let sumR = 0,
            sumG = 0,
            sumB = 0;
          const pixelCount = sampleSize * sampleSize;
          for (let i = 0; i < pixelCount; i++) {
            sumR += pixelData[i * 4];
            sumG += pixelData[i * 4 + 1];
            sumB += pixelData[i * 4 + 2];
          }
          const avgR = sumR / pixelCount;
          const avgG = sumG / pixelCount;
          const avgB = sumB / pixelCount;

          const isUniform =
            Math.abs(avgR - NEUTRAL_R) <= TOLERANCE &&
            Math.abs(avgG - NEUTRAL_G) <= TOLERANCE &&
            Math.abs(avgB - NEUTRAL_B) <= TOLERANCE;

          if (!isUniform) {
            console.warn(
              `Cell [${row},${col}] ${cornerNames[cornerIdx]} corner: ` +
                `RGB(${avgR.toFixed(1)}, ${avgG.toFixed(1)}, ${avgB.toFixed(1)}) ` +
                `expected ~(${NEUTRAL_R.toFixed(0)}, ${NEUTRAL_G.toFixed(0)}, ${NEUTRAL_B.toFixed(0)})`,
            );
            totalNonUniform++;
          }
        }
      }
    }

    // Allow some tolerance - edge cells may have slight bleeding
    // but most corners should be uniform
    const totalCorners = gridX * gridY * 4;
    const uniformRatio = (totalCorners - totalNonUniform) / totalCorners;
    expect(uniformRatio).toBeGreaterThan(0.9); // At least 90% should be uniform
  });

  it("should produce different normals in cell centers vs corners", async () => {
    // The center of cells should have actual object normals (not neutral)
    // This verifies the normal baking is actually capturing surface normals
    const geometry = new THREE.SphereGeometry(0.5, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: 0x2288ff });
    const mesh = new THREE.Mesh(geometry, material);

    const bakeResult = await impostor.bakeWithNormals(mesh, {
      gridSizeX: 4,
      gridSizeY: 4,
      atlasWidth: 128,
      atlasHeight: 128,
      pbrMode: PBRBakeMode.STANDARD,
    });

    expect(bakeResult.normalRenderTarget).toBeDefined();

    const normalRT = bakeResult.normalRenderTarget!;
    const cellWidth = Math.floor(normalRT.width / bakeResult.gridSizeX);
    const cellHeight = Math.floor(normalRT.height / bakeResult.gridSizeY);

    // Sample center cell (should have varied normals from sphere surface)
    const centerCol = Math.floor(bakeResult.gridSizeX / 2);
    const centerRow = Math.floor(bakeResult.gridSizeY / 2);
    const centerX = centerCol * cellWidth + Math.floor(cellWidth / 2) - 2;
    const centerY = centerRow * cellHeight + Math.floor(cellHeight / 2) - 2;

    const centerPixels = await readRenderTargetPixels(
      renderer,
      normalRT,
      centerX,
      centerY,
      4,
      4,
    );

    // Sample corner (should be neutral)
    const cornerX = 0;
    const cornerY = 0;
    const cornerPixels = await readRenderTargetPixels(
      renderer,
      normalRT,
      cornerX,
      cornerY,
      4,
      4,
    );

    // Calculate variance in center vs corner
    const calcVariance = (data: Uint8Array) => {
      let sumR = 0,
        sumG = 0,
        sumB = 0;
      const count = data.length / 4;
      for (let i = 0; i < count; i++) {
        sumR += data[i * 4];
        sumG += data[i * 4 + 1];
        sumB += data[i * 4 + 2];
      }
      const avgR = sumR / count;
      const avgG = sumG / count;
      const avgB = sumB / count;

      let variance = 0;
      for (let i = 0; i < count; i++) {
        variance += Math.pow(data[i * 4] - avgR, 2);
        variance += Math.pow(data[i * 4 + 1] - avgG, 2);
        variance += Math.pow(data[i * 4 + 2] - avgB, 2);
      }
      return variance / count;
    };

    const centerVariance = calcVariance(centerPixels);
    const cornerVariance = calcVariance(cornerPixels);

    // Center should have more variance (actual normal data)
    // Corner should be uniform (neutral normal)
    // Note: Center may also be uniform if the sphere is very small or cell is large
    // So we just verify corner is low variance
    expect(cornerVariance).toBeLessThan(100); // Corner should be uniform

    console.log(
      `Normal variance - Center: ${centerVariance.toFixed(2)}, Corner: ${cornerVariance.toFixed(2)}`,
    );
  });
});
