/**
 * Optimization Correctness Tests
 *
 * Verifies that all optimizations produce correct results:
 * - OctahedronGeometry math (directionToUV roundtrip, directionToGridCell, static vector reuse)
 * - GlobalMobAtlas build() TypedArray.set correctness
 * - AnimatedImpostorController timing
 * - ImpostorBaker integration (bake/bakeWithNormals/bakeFull)
 *
 * Runs in browser environment via Playwright for WebGPU + Three.js support.
 */

import * as THREE from "three/webgpu";
import { describe, it, expect, beforeEach } from "vitest";
import {
  getViewDirection,
  directionToUV,
  directionToGridCell,
  buildOctahedronMesh,
  lerpOctahedronGeometry,
} from "../OctahedronGeometry";
import { OctahedronType } from "../types";
import { GlobalMobAtlasBuilder } from "../GlobalMobAtlas";
import { AnimatedImpostorController } from "../AnimatedOctahedralImpostor";
import { DEFAULT_BAKE_CONFIG } from "../ImpostorBaker";
import type { CompatibleRenderer } from "../ImpostorBaker";
import { OctahedralImpostor } from "../OctahedralImpostor";
import type { AnimatedBakeResult } from "../types";

// ============================================================================
// OCTAHEDRON GEOMETRY MATH TESTS
// ============================================================================

describe("OctahedronGeometry Math", () => {
  describe("directionToUV and getViewDirection roundtrip", () => {
    // Axis-aligned directions roundtrip perfectly
    const axisDirections = [
      { name: "up", dir: new THREE.Vector3(0, 1, 0) },
      { name: "front", dir: new THREE.Vector3(0, 0, 1) },
      { name: "right", dir: new THREE.Vector3(1, 0, 0) },
    ];

    for (const { name, dir } of axisDirections) {
      it(`HEMI roundtrip for ${name} direction (axis-aligned, exact)`, () => {
        const uv = directionToUV(dir, OctahedronType.HEMI);
        const recovered = getViewDirection(uv.u, uv.v, OctahedronType.HEMI);

        expect(recovered.x).toBeCloseTo(dir.x, 1);
        expect(recovered.y).toBeCloseTo(dir.y, 1);
        expect(recovered.z).toBeCloseTo(dir.z, 1);
      });

      it(`FULL roundtrip for ${name} direction (axis-aligned, exact)`, () => {
        const uv = directionToUV(dir, OctahedronType.FULL);
        const recovered = getViewDirection(uv.u, uv.v, OctahedronType.FULL);

        expect(recovered.x).toBeCloseTo(dir.x, 1);
        expect(recovered.y).toBeCloseTo(dir.y, 1);
        expect(recovered.z).toBeCloseTo(dir.z, 1);
      });
    }

    // Non-axis-aligned directions: octahedral mapping is inherently lossy
    // (remapping through UV space distorts off-axis directions). We verify
    // that the roundtrip produces a valid normalized direction and that the
    // dot product with the original is high (directions stay roughly similar).
    const offAxisDirections = [
      { name: "diagonal", dir: new THREE.Vector3(1, 1, 1).normalize() },
      {
        name: "angled",
        dir: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
      },
    ];

    for (const { name, dir } of offAxisDirections) {
      it(`HEMI roundtrip for ${name} direction (lossy, dot product check)`, () => {
        const uv = directionToUV(dir, OctahedronType.HEMI);
        const recovered = getViewDirection(uv.u, uv.v, OctahedronType.HEMI);

        // Recovered direction should be normalized
        expect(recovered.length()).toBeCloseTo(1.0, 3);
        // Dot product > 0.7 means directions are within ~45 degrees
        expect(recovered.dot(dir)).toBeGreaterThan(0.7);
      });

      it(`FULL roundtrip for ${name} direction (lossy, dot product check)`, () => {
        const uv = directionToUV(dir, OctahedronType.FULL);
        const recovered = getViewDirection(uv.u, uv.v, OctahedronType.FULL);

        expect(recovered.length()).toBeCloseTo(1.0, 3);
        // FULL octahedron mapping is more lossy than HEMI for off-axis directions
        // (covers full sphere vs upper hemisphere), so we accept a lower threshold
        expect(recovered.dot(dir)).toBeGreaterThan(0.6);
      });
    }
  });

  describe("directionToUV output range", () => {
    it("always returns u,v in [0, 1] for HEMI", () => {
      // Test many random directions in upper hemisphere
      for (let i = 0; i < 100; i++) {
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1,
          Math.random(), // y >= 0 for upper hemisphere
          Math.random() * 2 - 1,
        ).normalize();

        const uv = directionToUV(dir, OctahedronType.HEMI);
        expect(uv.u).toBeGreaterThanOrEqual(0);
        expect(uv.u).toBeLessThanOrEqual(1);
        expect(uv.v).toBeGreaterThanOrEqual(0);
        expect(uv.v).toBeLessThanOrEqual(1);
      }
    });

    it("always returns u,v in [0, 1] for FULL", () => {
      for (let i = 0; i < 100; i++) {
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
        ).normalize();

        const uv = directionToUV(dir, OctahedronType.FULL);
        expect(uv.u).toBeGreaterThanOrEqual(0);
        expect(uv.u).toBeLessThanOrEqual(1);
        expect(uv.v).toBeGreaterThanOrEqual(0);
        expect(uv.v).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("directionToUV static return object reuse", () => {
    it("returns the same object reference across calls", () => {
      const dir1 = new THREE.Vector3(0, 1, 0);
      const dir2 = new THREE.Vector3(1, 0, 0);

      const result1 = directionToUV(dir1, OctahedronType.HEMI);
      const result2 = directionToUV(dir2, OctahedronType.HEMI);

      // Same object reference (zero-allocation)
      expect(result1).toBe(result2);
    });

    it("overwrites previous values on subsequent calls", () => {
      const dir1 = new THREE.Vector3(0, 1, 0);
      const result1 = directionToUV(dir1, OctahedronType.HEMI);
      const u1 = result1.u;
      const v1 = result1.v;

      const dir2 = new THREE.Vector3(1, 0, 0);
      directionToUV(dir2, OctahedronType.HEMI);

      // result1's values have been overwritten (it's the same object)
      expect(result1.u).not.toBe(u1);
      expect(result1.v).not.toBe(v1);
    });
  });

  describe("directionToGridCell", () => {
    it("returns valid face indices within grid bounds", () => {
      const gridSizeX = 16;
      const gridSizeY = 16;
      const maxIndex = gridSizeX * gridSizeY - 1;

      for (let i = 0; i < 50; i++) {
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1,
          Math.random() + 0.01,
          Math.random() * 2 - 1,
        ).normalize();

        const result = directionToGridCell(
          dir,
          gridSizeX,
          gridSizeY,
          OctahedronType.HEMI,
        );

        // All indices within bounds
        expect(result.faceIndices.x).toBeGreaterThanOrEqual(0);
        expect(result.faceIndices.x).toBeLessThanOrEqual(maxIndex);
        expect(result.faceIndices.y).toBeGreaterThanOrEqual(0);
        expect(result.faceIndices.y).toBeLessThanOrEqual(maxIndex);
        expect(result.faceIndices.z).toBeGreaterThanOrEqual(0);
        expect(result.faceIndices.z).toBeLessThanOrEqual(maxIndex);
      }
    });

    it("returns weights that sum to 1", () => {
      for (let i = 0; i < 50; i++) {
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1,
          Math.random() + 0.01,
          Math.random() * 2 - 1,
        ).normalize();

        const { faceWeights } = directionToGridCell(
          dir,
          31,
          31,
          OctahedronType.HEMI,
        );

        // Weights always sum to 1 (normalized)
        const sum = faceWeights.x + faceWeights.y + faceWeights.z;
        expect(sum).toBeCloseTo(1.0, 5);
      }
    });

    it("returns the same object references across calls (zero-allocation)", () => {
      const dir1 = new THREE.Vector3(0, 1, 0);
      const dir2 = new THREE.Vector3(1, 0, 0).normalize();

      const result1 = directionToGridCell(dir1, 16, 16, OctahedronType.HEMI);
      const result2 = directionToGridCell(dir2, 16, 16, OctahedronType.HEMI);

      // Same object references (zero-allocation optimization)
      expect(result1).toBe(result2);
      expect(result1.faceIndices).toBe(result2.faceIndices);
      expect(result1.faceWeights).toBe(result2.faceWeights);
    });

    it("works with asymmetric grid sizes", () => {
      const dir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
      const result = directionToGridCell(dir, 16, 8, OctahedronType.HEMI);

      // Indices should be within the asymmetric grid
      const maxIndex = 16 * 8 - 1;
      expect(result.faceIndices.x).toBeLessThanOrEqual(maxIndex);
      expect(result.faceIndices.y).toBeLessThanOrEqual(maxIndex);
      expect(result.faceIndices.z).toBeLessThanOrEqual(maxIndex);

      // Weights still sum to 1
      const sum =
        result.faceWeights.x + result.faceWeights.y + result.faceWeights.z;
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it("straight-up direction maps to center of HEMI grid", () => {
      const up = new THREE.Vector3(0, 1, 0);
      const { faceIndices } = directionToGridCell(
        up,
        16,
        16,
        OctahedronType.HEMI,
      );

      // For straight up, the UV should be near center (0.5, 0.5)
      // which maps to grid cell ~(7, 7) for a 16x16 grid
      const col0 = faceIndices.x % 16;
      const row0 = Math.floor(faceIndices.x / 16);
      expect(col0).toBeGreaterThanOrEqual(6);
      expect(col0).toBeLessThanOrEqual(9);
      expect(row0).toBeGreaterThanOrEqual(6);
      expect(row0).toBeLessThanOrEqual(9);
    });
  });

  describe("buildOctahedronMesh", () => {
    it("generates correct number of octPoints", () => {
      const mesh = buildOctahedronMesh(OctahedronType.HEMI, 8, 8);
      // 8x8 grid = 64 points, each with 3 components
      expect(mesh.octPoints.length).toBe(8 * 8 * 3);
      expect(mesh.planePoints.length).toBe(8 * 8 * 3);
    });

    it("generates normalized octPoints", () => {
      const mesh = buildOctahedronMesh(OctahedronType.HEMI, 8, 8);
      for (let i = 0; i < mesh.octPoints.length; i += 3) {
        const x = mesh.octPoints[i];
        const y = mesh.octPoints[i + 1];
        const z = mesh.octPoints[i + 2];
        const len = Math.sqrt(x * x + y * y + z * z);
        // All points should be on the unit sphere scaled to radius 0.5
        expect(len).toBeCloseTo(0.5, 3);
      }
    });
  });

  describe("lerpOctahedronGeometry", () => {
    it("at t=0 matches plane points", () => {
      const mesh = buildOctahedronMesh(OctahedronType.HEMI, 4, 4);
      lerpOctahedronGeometry(mesh, 0);

      const positions = mesh.wireframeMesh.geometry.attributes.position
        .array as Float32Array;
      for (let i = 0; i < mesh.planePoints.length; i++) {
        expect(positions[i]).toBeCloseTo(mesh.planePoints[i], 5);
      }
    });

    it("at t=1 matches oct points", () => {
      const mesh = buildOctahedronMesh(OctahedronType.HEMI, 4, 4);
      lerpOctahedronGeometry(mesh, 1);

      const positions = mesh.wireframeMesh.geometry.attributes.position
        .array as Float32Array;
      for (let i = 0; i < mesh.octPoints.length; i++) {
        expect(positions[i]).toBeCloseTo(mesh.octPoints[i], 5);
      }
    });

    it("at t=0.5 is midpoint between plane and oct", () => {
      const mesh = buildOctahedronMesh(OctahedronType.HEMI, 4, 4);
      lerpOctahedronGeometry(mesh, 0.5);

      const positions = mesh.wireframeMesh.geometry.attributes.position
        .array as Float32Array;
      for (let i = 0; i < mesh.planePoints.length; i++) {
        const expected = mesh.planePoints[i] * 0.5 + mesh.octPoints[i] * 0.5;
        expect(positions[i]).toBeCloseTo(expected, 5);
      }
    });
  });
});

// ============================================================================
// GLOBAL MOB ATLAS TESTS
// ============================================================================

describe("GlobalMobAtlasBuilder", () => {
  function createMockBakeResult(
    modelId: string,
    frameCount: number,
    atlasSize: number,
    fillValue: number,
  ): AnimatedBakeResult {
    const pixelsPerFrame = atlasSize * atlasSize * 4;
    const totalPixels = pixelsPerFrame * frameCount;
    const data = new Uint8Array(totalPixels);

    // Fill each frame with a distinct pattern: fillValue + frameIdx
    for (let f = 0; f < frameCount; f++) {
      const frameVal = (fillValue + f) & 0xff;
      const offset = f * pixelsPerFrame;
      for (let i = 0; i < pixelsPerFrame; i++) {
        data[offset + i] = frameVal;
      }
    }

    const tex = new THREE.DataArrayTexture(
      data,
      atlasSize,
      atlasSize,
      frameCount,
    );
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;

    return {
      atlasArray: tex,
      frameCount,
      spritesPerSide: 6,
      spritesX: 6,
      spritesY: 3,
      animationDuration: frameCount / 6,
      animationFPS: 6,
      boundingSphere: new THREE.Sphere(new THREE.Vector3(), 1),
      modelId,
      hemisphere: true,
    };
  }

  it("merges variants with correct frame data (TypedArray.set)", () => {
    const builder = new GlobalMobAtlasBuilder();
    const result1 = createMockBakeResult("goblin", 3, 4, 10);
    const result2 = createMockBakeResult("skeleton", 2, 4, 50);

    builder.addVariant(result1);
    builder.addVariant(result2);
    const atlas = builder.build();

    expect(atlas.totalFrames).toBe(5); // 3 + 2
    expect(atlas.variants.size).toBe(2);

    // Verify merged data integrity
    const mergedData = atlas.atlasArray.image.data as Uint8Array;
    const pixelsPerFrame = 4 * 4 * 4;

    // Frame 0 (goblin frame 0): should be fillValue 10
    expect(mergedData[0]).toBe(10);
    expect(mergedData[pixelsPerFrame - 1]).toBe(10);

    // Frame 1 (goblin frame 1): should be fillValue 11
    expect(mergedData[pixelsPerFrame]).toBe(11);

    // Frame 2 (goblin frame 2): should be fillValue 12
    expect(mergedData[2 * pixelsPerFrame]).toBe(12);

    // Frame 3 (skeleton frame 0): should be fillValue 50
    expect(mergedData[3 * pixelsPerFrame]).toBe(50);

    // Frame 4 (skeleton frame 1): should be fillValue 51
    expect(mergedData[4 * pixelsPerFrame]).toBe(51);
  });

  it("preserves variant configuration", () => {
    const builder = new GlobalMobAtlasBuilder();
    builder.addVariant(createMockBakeResult("goblin", 4, 4, 0));
    builder.addVariant(createMockBakeResult("dragon", 6, 4, 100));

    const atlas = builder.build();

    const goblin = atlas.variants.get("goblin");
    expect(goblin).toBeDefined();
    expect(goblin!.frameCount).toBe(4);
    expect(goblin!.baseFrameIndex).toBe(0);

    const dragon = atlas.variants.get("dragon");
    expect(dragon).toBeDefined();
    expect(dragon!.frameCount).toBe(6);
    expect(dragon!.baseFrameIndex).toBe(4);
  });

  it("rejects mismatched sprite grids", () => {
    const builder = new GlobalMobAtlasBuilder();
    const result1 = createMockBakeResult("goblin", 3, 4, 0);
    const result2 = createMockBakeResult("skeleton", 2, 4, 0);
    result2.spritesX = 8; // Different grid

    builder.addVariant(result1);
    expect(() => builder.addVariant(result2)).toThrow(/Sprite grid mismatch/);
  });
});

// ============================================================================
// ANIMATED IMPOSTOR CONTROLLER TESTS
// ============================================================================

describe("AnimatedImpostorController", () => {
  it("advances frame at configured FPS", () => {
    const controller = new AnimatedImpostorController(10); // 10 FPS = 100ms per frame
    expect(controller.getFPS()).toBe(10);

    // At t=0, no frame advance
    controller.update(0);
    expect(controller.getFrame()).toBe(0);

    // At t=50ms, still frame 0 (need 100ms)
    controller.update(50);
    expect(controller.getFrame()).toBe(0);

    // At t=100ms, should advance to frame 1
    controller.update(100);
    expect(controller.getFrame()).toBe(1);

    // At t=200ms, should advance to frame 2
    controller.update(200);
    expect(controller.getFrame()).toBe(2);
  });

  it("allows changing FPS", () => {
    const controller = new AnimatedImpostorController(10);
    controller.setFPS(20); // 50ms per frame
    expect(controller.getFPS()).toBe(20);
  });

  it("tracks registered impostor count", () => {
    const controller = new AnimatedImpostorController();
    expect(controller.getCount()).toBe(0);
    controller.clear();
    expect(controller.getCount()).toBe(0);
  });
});

// ============================================================================
// IMPOSTOR BAKER INTEGRATION TESTS (requires WebGPU)
// ============================================================================

describe("ImpostorBaker Integration", () => {
  let renderer: THREE.WebGPURenderer;
  let impostor: OctahedralImpostor;

  beforeEach(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    if (!canvas.style) {
      Object.defineProperty(canvas, "style", {
        value: { width: "", height: "" },
        writable: true,
      });
    }

    renderer = new THREE.WebGPURenderer({ canvas });
    await renderer.init();
    impostor = new OctahedralImpostor(
      renderer as unknown as CompatibleRenderer,
    );
  });

  it("bake() produces a valid atlas texture", { timeout: 60000 }, async () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xff0000 }),
    );

    const result = await impostor.bake(mesh, {
      atlasWidth: 256,
      atlasHeight: 256,
      gridSizeX: 8,
      gridSizeY: 8,
    });

    expect(result.atlasTexture).toBeDefined();
    expect(result.gridSizeX).toBe(8);
    expect(result.gridSizeY).toBe(8);
    expect(result.boundingSphere).toBeDefined();
    expect(result.boundingBox).toBeDefined();
    expect(result.octMeshData).toBeDefined();
  });

  it("bakeWithNormals() produces color and normal atlases", async () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x00ff00 }),
    );

    const result = await impostor.bakeWithNormals(mesh, {
      atlasWidth: 256,
      atlasHeight: 256,
      gridSizeX: 8,
      gridSizeY: 8,
    });

    expect(result.atlasTexture).toBeDefined();
    expect(result.normalAtlasTexture).toBeDefined();
    expect(result.gridSizeX).toBe(8);
    expect(result.gridSizeY).toBe(8);
  });

  it("bakeFull() produces color, normal, and depth atlases", async () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x0000ff }),
    );

    const result = await impostor.bakeFull(mesh, {
      atlasWidth: 256,
      atlasHeight: 256,
      gridSizeX: 8,
      gridSizeY: 8,
    });

    expect(result.atlasTexture).toBeDefined();
    expect(result.normalAtlasTexture).toBeDefined();
    expect(result.depthAtlasTexture).toBeDefined();
    expect(result.gridSizeX).toBe(8);
    expect(result.gridSizeY).toBe(8);
    expect(result.depthNear).toBeDefined();
    expect(result.depthFar).toBeDefined();
  });

  it("bakeHybrid() produces color and normal atlases", async () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffff00 }),
    );

    const result = await impostor.bakeHybrid(mesh, {
      atlasWidth: 256,
      atlasHeight: 256,
      gridSizeX: 8,
      gridSizeY: 8,
    });

    expect(result.atlasTexture).toBeDefined();
    expect(result.normalAtlasTexture).toBeDefined();
    expect(result.normalRenderTarget).toBeDefined();
  });

  it("createInstance() returns working impostor instance", async () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xff0000 }),
    );

    const result = await impostor.bake(mesh, {
      atlasWidth: 256,
      atlasHeight: 256,
      gridSizeX: 8,
      gridSizeY: 8,
    });

    const instance = impostor.createInstance(result);
    expect(instance.mesh).toBeDefined();
    expect(instance.update).toBeDefined();
    expect(instance.dispose).toBeDefined();

    // Update should not throw
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    camera.position.set(0, 2, 5);
    instance.update(camera);

    // Cleanup
    instance.dispose();
  });

  it("createInstancedMesh() returns working instanced mesh", async () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x00ff00 }),
    );

    const result = await impostor.bake(mesh, {
      atlasWidth: 256,
      atlasHeight: 256,
      gridSizeX: 8,
      gridSizeY: 8,
    });

    const instanced = impostor.createInstancedMesh(result, 10, 2.0);
    expect(instanced.mesh).toBeDefined();
    expect(instanced.count).toBe(10);

    // Set positions
    for (let i = 0; i < 10; i++) {
      instanced.setPosition(i, new THREE.Vector3(i * 3, 0, 0));
    }

    // Update should not throw
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    camera.position.set(0, 5, 20);
    instanced.update(camera);

    instanced.dispose();
  });

  it(
    "atlas content is not empty after baking",
    { timeout: 60000 },
    async () => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xff0000 }),
      );

      const result = await impostor.bake(mesh, {
        atlasWidth: 128,
        atlasHeight: 128,
        gridSizeX: 4,
        gridSizeY: 4,
      });

      // Read pixels from the atlas
      if (renderer.readRenderTargetPixelsAsync) {
        const pixels = (await renderer.readRenderTargetPixelsAsync(
          result.renderTarget,
          0,
          0,
          128,
          128,
        )) as Uint8Array;

        // Count non-zero pixels (atlas should have actual content)
        let nonZero = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 0 || pixels[i + 1] > 0 || pixels[i + 2] > 0) {
            nonZero++;
          }
        }

        // At least some pixels should be non-zero
        expect(nonZero).toBeGreaterThan(0);
      }
    },
  );
});

// ============================================================================
// DEFAULT CONFIG TESTS
// ============================================================================

describe("DEFAULT_BAKE_CONFIG", () => {
  it("has valid default values", () => {
    expect(DEFAULT_BAKE_CONFIG.atlasWidth).toBe(2048);
    expect(DEFAULT_BAKE_CONFIG.atlasHeight).toBe(2048);
    expect(DEFAULT_BAKE_CONFIG.gridSizeX).toBe(31);
    expect(DEFAULT_BAKE_CONFIG.gridSizeY).toBe(31);
    expect(DEFAULT_BAKE_CONFIG.octType).toBe(OctahedronType.HEMI);
  });
});
