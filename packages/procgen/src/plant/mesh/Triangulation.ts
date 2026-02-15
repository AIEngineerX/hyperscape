/**
 * Triangulation - 2D Delaunay triangulation for leaf meshes
 *
 * Converts leaf outline curves into a triangulated mesh using
 * Delaunay triangulation with refinement for skinny triangles.
 *
 * Based on the Unity Procedural-Plant-and-Foliage-Generator.
 */

import Delaunator from "delaunator";
import type { Point2D, Point3D, LeafCurve, MeshData } from "../types.js";
import { evaluateCurve2D } from "../math/Bezier.js";
import { clone2D, distance2D, getExtents2D } from "../math/Vector.js";

// =============================================================================
// TRIANGULATION CONFIGURATION
// =============================================================================

export interface TriangulationConfig {
  /** Number of steps to sample each curve */
  lineSteps: number;
  /** Minimum angle for triangles (degrees) */
  minAngle: number;
  /** Maximum area for triangles */
  maxArea: number;
  /** Number of subdivision steps for refinement */
  subdivisionSteps: number;
  /** Add internal points for better triangulation */
  addInternalPoints: boolean;
}

const DEFAULT_CONFIG: TriangulationConfig = {
  lineSteps: 10,
  minAngle: 20,
  maxArea: 0.1,
  subdivisionSteps: 1,
  addInternalPoints: true,
};

// =============================================================================
// CURVE SAMPLING
// =============================================================================

/**
 * Sample points along leaf curves to create polygon boundary
 */
export function sampleCurvePoints(
  curves: LeafCurve[],
  lineSteps: number,
): Point2D[] {
  const points: Point2D[] = [];

  for (const curve of curves) {
    // Sample curve at regular intervals (skip last point, will be first of next)
    for (let i = 0; i < lineSteps; i++) {
      const t = i / lineSteps;
      const point = evaluateCurve2D(curve, t);
      points.push(clone2D(point));
    }
  }

  return points;
}

/**
 * Remove duplicate points from polygon
 */
function removeDuplicatePoints(
  points: Point2D[],
  epsilon: number = 0.0001,
): Point2D[] {
  const result: Point2D[] = [];

  for (const point of points) {
    let isDuplicate = false;
    for (const existing of result) {
      if (distance2D(point, existing) < epsilon) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      result.push(point);
    }
  }

  return result;
}

// =============================================================================
// DELAUNAY TRIANGULATION
// =============================================================================

/**
 * Perform Delaunay triangulation on a set of points
 */
export function delaunayTriangulate(points: Point2D[]): number[] {
  if (points.length < 3) return [];

  // Convert to flat array for Delaunator
  const coords = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    coords[i * 2] = points[i].x;
    coords[i * 2 + 1] = points[i].y;
  }

  const delaunay = new Delaunator(coords);
  const triangles: number[] = Array.from(delaunay.triangles);

  return triangles;
}

/**
 * Check if a point is inside the polygon boundary
 */
function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;

    if (
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Get the centroid of a triangle
 */
function getTriangleCentroid(p1: Point2D, p2: Point2D, p3: Point2D): Point2D {
  return {
    x: (p1.x + p2.x + p3.x) / 3,
    y: (p1.y + p2.y + p3.y) / 3,
  };
}

/**
 * Filter triangles to only those inside the polygon
 */
function filterTrianglesInPolygon(
  points: Point2D[],
  triangles: number[],
  polygon: Point2D[],
): number[] {
  const filtered: number[] = [];

  for (let i = 0; i < triangles.length; i += 3) {
    const i0 = triangles[i];
    const i1 = triangles[i + 1];
    const i2 = triangles[i + 2];

    const p0 = points[i0];
    const p1 = points[i1];
    const p2 = points[i2];

    // Check if triangle centroid is inside polygon
    const centroid = getTriangleCentroid(p0, p1, p2);
    if (isPointInPolygon(centroid, polygon)) {
      filtered.push(i0, i1, i2);
    }
  }

  return filtered;
}

// =============================================================================
// INTERNAL POINT GENERATION
// =============================================================================

/**
 * Add internal points to improve triangulation quality
 */
function addInternalPoints(
  boundaryPoints: Point2D[],
  density: number,
): Point2D[] {
  const { min, max } = getExtents2D(boundaryPoints);
  const internalPoints: Point2D[] = [];

  const width = max.x - min.x;
  const height = max.y - min.y;

  // Calculate grid spacing
  const spacing = Math.sqrt((width * height) / density);
  const cols = Math.ceil(width / spacing);
  const rows = Math.ceil(height / spacing);

  for (let r = 1; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const x = min.x + (c / cols) * width;
      const y = min.y + (r / rows) * height;
      const point: Point2D = { x, y };

      if (isPointInPolygon(point, boundaryPoints)) {
        // Check distance from boundary
        let minDist = Infinity;
        for (const bp of boundaryPoints) {
          const d = distance2D(point, bp);
          if (d < minDist) minDist = d;
        }

        // Only add if sufficiently far from boundary
        if (minDist > spacing * 0.3) {
          internalPoints.push(point);
        }
      }
    }
  }

  return internalPoints;
}

// =============================================================================
// UV GENERATION
// =============================================================================

/**
 * Generate UV coordinates for leaf vertices
 */
export function generateLeafUVs(
  points: Point2D[],
  extents: { min: Point2D; max: Point2D },
): Point2D[] {
  const uvs: Point2D[] = [];
  const width = extents.max.x - extents.min.x;
  const height = extents.max.y - extents.min.y;

  // Handle zero dimensions
  const safeWidth = width > 0.0001 ? width : 1;
  const safeHeight = height > 0.0001 ? height : 1;

  for (const point of points) {
    uvs.push({
      x: (point.x - extents.min.x) / safeWidth,
      y: (point.y - extents.min.y) / safeHeight,
    });
  }

  return uvs;
}

// =============================================================================
// NORMAL GENERATION
// =============================================================================

/**
 * Calculate face normal for a triangle
 */
function calculateFaceNormal(p0: Point3D, p1: Point3D, p2: Point3D): Point3D {
  const ax = p1.x - p0.x;
  const ay = p1.y - p0.y;
  const az = p1.z - p0.z;

  const bx = p2.x - p0.x;
  const by = p2.y - p0.y;
  const bz = p2.z - p0.z;

  // Cross product
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;

  // Normalize
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 0.0001) {
    return { x: 0, y: 0, z: 1 };
  }

  return {
    x: nx / len,
    y: ny / len,
    z: nz / len,
  };
}

/**
 * Calculate smooth vertex normals by averaging face normals
 */
export function calculateVertexNormals(
  vertices: Point3D[],
  triangles: number[],
): Point3D[] {
  const normals: Point3D[] = vertices.map(() => ({ x: 0, y: 0, z: 0 }));
  const counts: number[] = new Array(vertices.length).fill(0);

  // Accumulate face normals at each vertex
  for (let i = 0; i < triangles.length; i += 3) {
    const i0 = triangles[i];
    const i1 = triangles[i + 1];
    const i2 = triangles[i + 2];

    const faceNormal = calculateFaceNormal(
      vertices[i0],
      vertices[i1],
      vertices[i2],
    );

    normals[i0].x += faceNormal.x;
    normals[i0].y += faceNormal.y;
    normals[i0].z += faceNormal.z;
    counts[i0]++;

    normals[i1].x += faceNormal.x;
    normals[i1].y += faceNormal.y;
    normals[i1].z += faceNormal.z;
    counts[i1]++;

    normals[i2].x += faceNormal.x;
    normals[i2].y += faceNormal.y;
    normals[i2].z += faceNormal.z;
    counts[i2]++;
  }

  // Normalize
  for (let i = 0; i < normals.length; i++) {
    if (counts[i] > 0) {
      normals[i].x /= counts[i];
      normals[i].y /= counts[i];
      normals[i].z /= counts[i];

      const len = Math.sqrt(
        normals[i].x * normals[i].x +
          normals[i].y * normals[i].y +
          normals[i].z * normals[i].z,
      );

      if (len > 0.0001) {
        normals[i].x /= len;
        normals[i].y /= len;
        normals[i].z /= len;
      } else {
        normals[i] = { x: 0, y: 0, z: 1 };
      }
    } else {
      normals[i] = { x: 0, y: 0, z: 1 };
    }
  }

  return normals;
}

// =============================================================================
// MAIN TRIANGULATION FUNCTION
// =============================================================================

/**
 * Triangulate a leaf shape into a mesh
 */
export function triangulateLeaf(
  curves: LeafCurve[],
  config: Partial<TriangulationConfig> = {},
): MeshData {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Sample boundary points
  let boundaryPoints = sampleCurvePoints(curves, cfg.lineSteps);
  boundaryPoints = removeDuplicatePoints(boundaryPoints);

  if (boundaryPoints.length < 3) {
    return createEmptyMeshData();
  }

  // Store ordered edge vertices (boundary indices)
  const orderedEdgeVerts = boundaryPoints.map((_, i) => i);

  // Add internal points if enabled
  let allPoints = [...boundaryPoints];
  if (cfg.addInternalPoints) {
    const internalDensity = Math.max(10, Math.pow(cfg.lineSteps, 2));
    const internalPoints = addInternalPoints(boundaryPoints, internalDensity);
    allPoints = [...boundaryPoints, ...internalPoints];
  }

  // Perform Delaunay triangulation
  let triangles = delaunayTriangulate(allPoints);

  // Filter to only triangles inside the polygon
  triangles = filterTrianglesInPolygon(allPoints, triangles, boundaryPoints);

  // Calculate extents
  const extents = getExtents2D(allPoints);

  // Convert to 3D vertices (z = 0 for now)
  const vertices: Point3D[] = allPoints.map((p) => ({ x: p.x, y: p.y, z: 0 }));

  // Generate UVs
  const uvs = generateLeafUVs(allPoints, extents);

  // Calculate normals
  const normals = calculateVertexNormals(vertices, triangles);

  // Default colors (white)
  const colors = new Array(vertices.length * 4).fill(1);

  return {
    vertices,
    triangles,
    uvs,
    colors,
    normals,
    orderedEdgeVerts,
  };
}

/**
 * Create empty mesh data
 */
function createEmptyMeshData(): MeshData {
  return {
    vertices: [],
    triangles: [],
    uvs: [],
    colors: [],
    normals: [],
    orderedEdgeVerts: [],
  };
}
