/**
 * Extrusion - Leaf mesh extrusion for thickness
 *
 * Creates back-facing geometry and edge triangles to give
 * leaves physical thickness.
 *
 * Based on the Unity Procedural-Plant-and-Foliage-Generator.
 */

import type { Point2D, Point3D, MeshData, LeafParamDict } from "../types.js";
import { LPK } from "../types.js";
import { getParamValue } from "../params/LeafParamDefaults.js";
import { getExtents2D } from "../math/Vector.js";
import { calculateVertexNormals } from "./Triangulation.js";

// =============================================================================
// EXTRUSION CONFIGURATION
// =============================================================================

export interface ExtrusionConfig {
  /** Thickness of the leaf */
  thickness: number;
  /** Edge depth (how much the edge is recessed) */
  edgeDepth: number;
  /** Succulent thickness (additional bulge in the middle) */
  succulentThickness: number;
}

// =============================================================================
// THICKNESS PROFILE
// =============================================================================

/**
 * Calculate thickness at a vertex based on its position
 * Creates natural leaf thickness variation (thicker in middle, thinner at edges)
 */
function calculateThicknessAtPoint(
  point: Point3D,
  extents: { min: Point2D; max: Point2D },
  centerX: number,
  maxY: number,
  baseThickness: number,
  edgeDepth: number,
  succulentThickness: number,
  isEdgeVertex: boolean,
): number {
  if (isEdgeVertex) {
    return edgeDepth * baseThickness;
  }

  // Distance from center axis (X=0 for symmetric leaves)
  const distFromCenter = Math.abs(point.x - centerX);
  const halfWidth = (extents.max.x - extents.min.x) / 2;
  const normalizedX = halfWidth > 0 ? distFromCenter / halfWidth : 0;

  // Position along length (Y)
  const normalizedY = maxY > 0 ? point.y / maxY : 0;

  // Thickness profile: thickest at center, thinner toward edges
  const xFalloff = 1 - Math.pow(normalizedX, 2);
  const yFalloff = 1 - Math.pow(Math.abs(normalizedY - 0.5) * 2, 2);

  // Base thickness with natural variation
  let thickness = baseThickness * xFalloff * 0.8 + baseThickness * 0.2;

  // Add succulent bulge (most in center)
  const succulentFactor = xFalloff * yFalloff;
  thickness += succulentThickness * succulentFactor;

  return Math.max(edgeDepth * baseThickness, thickness);
}

// =============================================================================
// BACK FACE GENERATION
// =============================================================================

/**
 * Generate back-facing vertices
 */
function generateBackVertices(
  frontVertices: Point3D[],
  extents: { min: Point2D; max: Point2D },
  orderedEdgeVerts: number[],
  config: ExtrusionConfig,
): Point3D[] {
  const backVertices: Point3D[] = [];
  const edgeVertSet = new Set(orderedEdgeVerts);

  const centerX = (extents.min.x + extents.max.x) / 2;
  const maxY = extents.max.y;

  for (let i = 0; i < frontVertices.length; i++) {
    const front = frontVertices[i];
    const isEdge = edgeVertSet.has(i);

    const thickness = calculateThicknessAtPoint(
      front,
      extents,
      centerX,
      maxY,
      config.thickness,
      config.edgeDepth,
      config.succulentThickness,
      isEdge,
    );

    // Back vertex is offset in -Z
    backVertices.push({
      x: front.x,
      y: front.y,
      z: front.z - thickness,
    });
  }

  return backVertices;
}

/**
 * Generate back-facing triangles (reversed winding)
 */
function generateBackTriangles(
  frontTriangles: number[],
  vertexOffset: number,
): number[] {
  const backTriangles: number[] = [];

  for (let i = 0; i < frontTriangles.length; i += 3) {
    // Reverse winding order for back faces
    backTriangles.push(
      frontTriangles[i] + vertexOffset,
      frontTriangles[i + 2] + vertexOffset,
      frontTriangles[i + 1] + vertexOffset,
    );
  }

  return backTriangles;
}

// =============================================================================
// EDGE GENERATION
// =============================================================================

/**
 * Generate edge triangles connecting front and back faces
 */
function generateEdgeTriangles(
  orderedEdgeVerts: number[],
  frontVertexCount: number,
): number[] {
  const edgeTriangles: number[] = [];
  const n = orderedEdgeVerts.length;

  if (n < 3) return edgeTriangles;

  for (let i = 0; i < n; i++) {
    const i0 = orderedEdgeVerts[i];
    const i1 = orderedEdgeVerts[(i + 1) % n];

    // Front vertices
    const f0 = i0;
    const f1 = i1;

    // Back vertices (offset by frontVertexCount)
    const b0 = i0 + frontVertexCount;
    const b1 = i1 + frontVertexCount;

    // Two triangles per edge quad
    // Triangle 1: f0, b0, f1
    edgeTriangles.push(f0, b0, f1);
    // Triangle 2: f1, b0, b1
    edgeTriangles.push(f1, b0, b1);
  }

  return edgeTriangles;
}

// =============================================================================
// UV GENERATION FOR EXTRUDED MESH
// =============================================================================

/**
 * Generate UVs for back faces (mirrored in X for proper mapping)
 */
function generateBackUVs(frontUVs: Point2D[]): Point2D[] {
  return frontUVs.map((uv) => ({
    x: 1 - uv.x, // Mirror horizontally
    y: uv.y,
  }));
}

// =============================================================================
// COLOR VERTEX DATA
// =============================================================================

/**
 * Generate vertex colors with back-face darkening
 */
function generateExtrudedColors(
  frontColors: number[],
  backDarkening: number,
): number[] {
  const backColors: number[] = [];

  // Back faces are slightly darker
  for (let i = 0; i < frontColors.length; i += 4) {
    backColors.push(
      frontColors[i] * (1 - backDarkening),
      frontColors[i + 1] * (1 - backDarkening),
      frontColors[i + 2] * (1 - backDarkening),
      frontColors[i + 3],
    );
  }

  return [...frontColors, ...backColors];
}

// =============================================================================
// MAIN EXTRUSION FUNCTION
// =============================================================================

/**
 * Extrude a leaf mesh to give it thickness
 */
export function extrudeLeafMesh(
  baseMesh: MeshData,
  params: LeafParamDict,
): MeshData {
  // Check if extrusion is enabled
  const extrudeEnabled = getParamValue(params, LPK.ExtrudeEnabled) > 0;
  if (!extrudeEnabled) {
    return baseMesh;
  }

  // Get extrusion parameters
  const config: ExtrusionConfig = {
    thickness: getParamValue(params, LPK.ExtrudeSuccThicc) * 0.3 + 0.02,
    edgeDepth: getParamValue(params, LPK.ExtrudeEdgeDepth),
    succulentThickness: getParamValue(params, LPK.ExtrudeSuccThicc) * 0.2,
  };

  const frontVertices = baseMesh.vertices;
  const frontTriangles = baseMesh.triangles;
  const frontUVs = baseMesh.uvs;
  const orderedEdgeVerts = baseMesh.orderedEdgeVerts;
  const frontVertexCount = frontVertices.length;

  if (frontVertexCount < 3) {
    return baseMesh;
  }

  // Calculate extents
  const extents = getExtents2D(frontVertices.map((v) => ({ x: v.x, y: v.y })));

  // Generate back vertices
  const backVertices = generateBackVertices(
    frontVertices,
    extents,
    orderedEdgeVerts,
    config,
  );

  // Combine vertices
  const allVertices = [...frontVertices, ...backVertices];

  // Generate back triangles
  const backTriangles = generateBackTriangles(frontTriangles, frontVertexCount);

  // Generate edge triangles
  const edgeTriangles = generateEdgeTriangles(
    orderedEdgeVerts,
    frontVertexCount,
  );

  // Combine triangles
  const allTriangles = [...frontTriangles, ...backTriangles, ...edgeTriangles];

  // Generate UVs
  const backUVs = generateBackUVs(frontUVs);
  const allUVs = [...frontUVs, ...backUVs];

  // Generate colors with back-face darkening
  const abaxialDarkening = getParamValue(params, LPK.AbaxialDarkening);
  const allColors = generateExtrudedColors(
    baseMesh.colors,
    abaxialDarkening * 0.3,
  );

  // Recalculate normals for the complete mesh
  const allNormals = calculateVertexNormals(allVertices, allTriangles);

  return {
    vertices: allVertices,
    triangles: allTriangles,
    uvs: allUVs,
    colors: allColors,
    normals: allNormals,
    orderedEdgeVerts: [
      ...orderedEdgeVerts,
      ...orderedEdgeVerts.map((i) => i + frontVertexCount),
    ],
  };
}

/**
 * Apply midrib groove to vertices
 * Creates a subtle depression along the central vein
 */
export function applyMidribGroove(
  mesh: MeshData,
  midribWidth: number,
  midribDepth: number,
): void {
  const halfWidth = midribWidth / 2;

  for (let i = 0; i < mesh.vertices.length; i++) {
    const vertex = mesh.vertices[i];

    // Only affect front vertices (positive Z or zero)
    if (vertex.z < -0.01) continue;

    // Check if vertex is near midrib (X close to 0)
    const distFromCenter = Math.abs(vertex.x);
    if (distFromCenter < halfWidth) {
      // Cosine falloff for smooth groove
      const t = distFromCenter / halfWidth;
      const depthFactor = Math.cos(t * Math.PI * 0.5);
      vertex.z -= midribDepth * depthFactor;
    }
  }

  // Recalculate normals after modification
  mesh.normals = calculateVertexNormals(mesh.vertices, mesh.triangles);
}
