/**
 * UV Generation Utilities for Building Geometry
 *
 * Provides world-space UV mapping for seamless procedural texture tiling.
 * Uses box projection based on surface normals for axis-aligned geometry.
 */

import * as THREE from "three";

// ============================================================================
// TYPES
// ============================================================================

export interface UVConfig {
  scale: number;
  offset?: { u: number; v: number };
  flipU?: boolean;
  flipV?: boolean;
}

const DEFAULT_UV_CONFIG: UVConfig = {
  scale: 1.0,
  offset: { u: 0, v: 0 },
  flipU: false,
  flipV: false,
};

// ============================================================================
// UV GENERATION
// ============================================================================

/** Helper to extract common UV config values */
function getUVParams(config: Partial<UVConfig>) {
  const merged = { ...DEFAULT_UV_CONFIG, ...config };
  return {
    scale: merged.scale,
    offsetU: merged.offset?.u ?? 0,
    offsetV: merged.offset?.v ?? 0,
    flipUSign: merged.flipU ? -1 : 1,
    flipVSign: merged.flipV ? -1 : 1,
  };
}

/**
 * Apply world-space UV coordinates using box projection.
 * Seamless tiling across adjacent surfaces based on dominant normal axis.
 */
export function applyWorldSpaceUVs(
  geometry: THREE.BufferGeometry,
  config: Partial<UVConfig> = {},
): void {
  const position = geometry.attributes.position;
  if (!position) return;

  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const normal = geometry.attributes.normal;

  const { scale, offsetU, offsetV, flipUSign, flipVSign } = getUVParams(config);
  const vertexCount = position.count;
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i < vertexCount; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));

    let u: number, v: number;
    if (ny > nx && ny > nz) {
      // Y-dominant: floors/ceilings - XZ plane
      u = x / scale;
      v = z / scale;
    } else if (nx > nz) {
      // X-dominant: East/West walls - ZY plane
      u = z / scale;
      v = y / scale;
    } else {
      // Z-dominant: North/South walls - XY plane
      u = x / scale;
      v = y / scale;
    }

    uvs[i * 2] = u * flipUSign + offsetU;
    uvs[i * 2 + 1] = v * flipVSign + offsetV;
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

/**
 * Apply UV coordinates optimized for wall geometry.
 * Uses world Y for V (brick courses align) and horizontal axis for U.
 */
export function applyWallUVs(
  geometry: THREE.BufferGeometry,
  config: Partial<UVConfig> = {},
  isVertical: boolean = false,
): void {
  const position = geometry.attributes.position;
  if (!position) return;

  const { scale, offsetU, offsetV, flipUSign, flipVSign } = getUVParams(config);
  const vertexCount = position.count;
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i < vertexCount; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);

    const u = (isVertical ? z : x) / scale;
    const v = y / scale;

    uvs[i * 2] = u * flipUSign + offsetU;
    uvs[i * 2 + 1] = v * flipVSign + offsetV;
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

/**
 * Apply UV coordinates for floor/ceiling geometry (XZ plane projection).
 */
export function applyFloorUVs(
  geometry: THREE.BufferGeometry,
  config: Partial<UVConfig> = {},
): void {
  const position = geometry.attributes.position;
  if (!position) return;

  const { scale, offsetU, offsetV, flipUSign, flipVSign } = getUVParams(config);
  const vertexCount = position.count;
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i < vertexCount; i++) {
    uvs[i * 2] = (position.getX(i) / scale) * flipUSign + offsetU;
    uvs[i * 2 + 1] = (position.getZ(i) / scale) * flipVSign + offsetV;
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

/**
 * Apply UV coordinates for roof geometry with slope projection.
 */
export function applyRoofUVs(
  geometry: THREE.BufferGeometry,
  config: Partial<UVConfig> = {},
  pitchAxis: "x" | "z" = "z",
): void {
  const position = geometry.attributes.position;
  if (!position) return;

  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const normal = geometry.attributes.normal;

  const { scale, offsetU, offsetV, flipUSign, flipVSign } = getUVParams(config);
  const vertexCount = position.count;
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i < vertexCount; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const ny = normal.getY(i);

    let u: number, v: number;
    if (pitchAxis === "z") {
      u = x / scale;
      const slopeDistance = Math.sqrt(y * y + z * z);
      v = (ny >= 0 ? slopeDistance : -slopeDistance) / scale;
    } else {
      u = z / scale;
      const slopeDistance = Math.sqrt(y * y + x * x);
      v = (ny >= 0 ? slopeDistance : -slopeDistance) / scale;
    }

    uvs[i * 2] = u * flipUSign + offsetU;
    uvs[i * 2 + 1] = v * flipVSign + offsetV;
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

// ============================================================================
// UV SCALE PRESETS
// ============================================================================

/**
 * UV scales for common building materials (world units per texture tile).
 */
export const UV_SCALE_PRESETS = {
  brick: 1.0,
  stoneLarge: 0.6,
  stoneMedium: 0.3,
  stoneRubble: 0.15,
  woodPlank: 0.2,
  timberFrame: 1.0,
  plaster: 2.0,
  shingle: 0.3,
  floorTile: 0.5,
} as const;

export type UVScalePreset = keyof typeof UV_SCALE_PRESETS;
