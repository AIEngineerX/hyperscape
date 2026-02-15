/**
 * Exporter Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  RockGenerator,
  exportToOBJ,
  extractGeometryData,
  createMeshFromData,
} from "../../src/rock/index.js";

describe("Exporter", () => {
  let generator: RockGenerator;
  let mesh: THREE.Mesh;

  beforeEach(() => {
    generator = new RockGenerator();
    const rock = generator.generateFromPreset("boulder", {
      seed: "export-test",
    });
    mesh = rock!.mesh;
  });

  afterEach(() => {
    generator.dispose();
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  describe("exportToOBJ", () => {
    it("exports mesh to OBJ format", () => {
      const result = exportToOBJ(mesh, { filename: "test-rock" });

      expect(result.filename).toBe("test-rock.obj");
      expect(result.mimeType).toBe("text/plain");
      expect(typeof result.data).toBe("string");
    });

    it("includes vertex positions", () => {
      const result = exportToOBJ(mesh);
      const objString = result.data as string;

      expect(objString).toContain("v ");
      expect(objString).toContain("# Vertices:");
    });

    it("includes normals", () => {
      const result = exportToOBJ(mesh);
      const objString = result.data as string;

      expect(objString).toContain("vn ");
    });

    it("includes faces", () => {
      const result = exportToOBJ(mesh);
      const objString = result.data as string;

      expect(objString).toContain("f ");
    });

    it("includes vertex colors when present", () => {
      const result = exportToOBJ(mesh);
      const objString = result.data as string;

      // Lines with colors have 6 values: x y z r g b
      const vertexLines = objString
        .split("\n")
        .filter((l) => l.startsWith("v "));
      const hasColors = vertexLines.some((l) => l.split(" ").length > 4);

      expect(hasColors).toBe(true);
    });

    it("uses default filename when not provided", () => {
      const result = exportToOBJ(mesh);

      expect(result.filename).toBe("rock.obj");
    });
  });

  describe("extractGeometryData", () => {
    it("extracts positions", () => {
      const data = extractGeometryData(mesh);

      expect(data.positions).toBeInstanceOf(Float32Array);
      expect(data.positions.length).toBeGreaterThan(0);
    });

    it("extracts normals", () => {
      const data = extractGeometryData(mesh);

      expect(data.normals).toBeInstanceOf(Float32Array);
      expect(data.normals.length).toBe(data.positions.length);
    });

    it("extracts colors when present", () => {
      const data = extractGeometryData(mesh);

      expect(data.colors).toBeInstanceOf(Float32Array);
      expect(data.colors!.length).toBe(data.positions.length);
    });

    it("handles indexed geometry", () => {
      const data = extractGeometryData(mesh);

      // Our rocks may or may not be indexed depending on flat shading
      // Three.js uses Uint16Array for small meshes, Uint32Array for large ones
      if (data.indices) {
        const isTypedArray =
          data.indices instanceof Uint16Array ||
          data.indices instanceof Uint32Array;
        expect(isTypedArray).toBe(true);
        expect(data.indices.length).toBeGreaterThan(0);
      }
    });
  });

  describe("createMeshFromData", () => {
    it("creates a mesh from geometry data", () => {
      const data = extractGeometryData(mesh);
      const newMesh = createMeshFromData(data);

      expect(newMesh).toBeInstanceOf(THREE.Mesh);
      expect(newMesh.geometry.attributes.position).toBeDefined();
    });

    it("preserves vertex count", () => {
      const data = extractGeometryData(mesh);
      const newMesh = createMeshFromData(data);

      const originalCount = mesh.geometry.attributes.position.count;
      const newCount = newMesh.geometry.attributes.position.count;

      expect(newCount).toBe(originalCount);
    });

    it("preserves colors", () => {
      const data = extractGeometryData(mesh);
      const newMesh = createMeshFromData(data);

      expect(newMesh.geometry.attributes.color).toBeDefined();
    });

    it("uses custom material when provided", () => {
      const data = extractGeometryData(mesh);
      const customMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const newMesh = createMeshFromData(data, customMaterial);

      expect(newMesh.material).toBe(customMaterial);

      customMaterial.dispose();
      newMesh.geometry.dispose();
    });
  });
});
