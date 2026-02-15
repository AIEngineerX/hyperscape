/**
 * Vector math utilities for 2D and 3D operations
 */

import type { Point2D, Point3D, Polar } from "../types.js";
import { polarToCartesian } from "./Polar.js";

// =============================================================================
// POINT CREATION
// =============================================================================

/**
 * Create a 2D point
 */
export function point2D(x: number, y: number): Point2D {
  return { x, y };
}

/**
 * Create a 3D point
 */
export function point3D(x: number, y: number, z: number = 0): Point3D {
  return { x, y, z };
}

/**
 * Convert Point2D to Point3D
 */
export function to3D(p: Point2D, z: number = 0): Point3D {
  return { x: p.x, y: p.y, z };
}

/**
 * Convert Point3D to Point2D (drop z)
 */
export function to2D(p: Point3D): Point2D {
  return { x: p.x, y: p.y };
}

/**
 * Zero 2D point
 */
export const ZERO_2D: Point2D = { x: 0, y: 0 };

/**
 * Zero 3D point
 */
export const ZERO_3D: Point3D = { x: 0, y: 0, z: 0 };

// =============================================================================
// POINT2D OPERATIONS
// =============================================================================

/**
 * Add two 2D points
 */
export function add2D(a: Point2D, b: Point2D): Point2D {
  return { x: a.x + b.x, y: a.y + b.y };
}

/**
 * Subtract 2D points
 */
export function sub2D(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

/**
 * Multiply 2D point by scalar
 */
export function mul2D(p: Point2D, s: number): Point2D {
  return { x: p.x * s, y: p.y * s };
}

/**
 * Multiply 2D point component-wise
 */
export function mult2D(a: Point2D, b: Point2D): Point2D {
  return { x: a.x * b.x, y: a.y * b.y };
}

/**
 * Divide 2D point by scalar
 */
export function div2D(p: Point2D, s: number): Point2D {
  return { x: p.x / s, y: p.y / s };
}

/**
 * Negate 2D point
 */
export function neg2D(p: Point2D): Point2D {
  return { x: -p.x, y: -p.y };
}

/**
 * Dot product of 2D points
 */
export function dot2D(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Cross product of 2D points (returns scalar z-component)
 */
export function cross2D(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * Length of 2D vector
 */
export function length2D(p: Point2D): number {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}

/**
 * Squared length of 2D vector
 */
export function lengthSq2D(p: Point2D): number {
  return p.x * p.x + p.y * p.y;
}

/**
 * Normalize 2D vector
 */
export function normalize2D(p: Point2D): Point2D {
  const len = length2D(p);
  if (len === 0) return { x: 0, y: 0 };
  return { x: p.x / len, y: p.y / len };
}

/**
 * Distance between 2D points
 */
export function distance2D(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Squared distance between 2D points
 */
export function distanceSq2D(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/**
 * Linear interpolation between 2D points
 */
export function lerp2D(a: Point2D, b: Point2D, t: number): Point2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/**
 * Extra lerp (can go beyond 0-1 range)
 */
export function extraLerp2D(a: Point2D, b: Point2D, t: number): Point2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/**
 * Rotate 2D point around origin
 */
export function rotate2D(p: Point2D, angle: number): Point2D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  };
}

/**
 * Rotate 2D point around a center point
 */
export function rotateAround2D(
  p: Point2D,
  center: Point2D,
  angle: number,
): Point2D {
  const translated = sub2D(p, center);
  const rotated = rotate2D(translated, angle);
  return add2D(rotated, center);
}

/**
 * Perpendicular vector (90 degrees counter-clockwise)
 */
export function perpendicular2D(p: Point2D): Point2D {
  return { x: -p.y, y: p.x };
}

/**
 * Add polar offset to 2D point
 */
export function addPolar2D(p: Point2D, polar: Polar): Point2D {
  const offset = polarToCartesian(polar);
  return add2D(p, offset);
}

/**
 * Mirror 2D point across X axis
 */
export function mirrorX2D(p: Point2D): Point2D {
  return { x: -p.x, y: p.y };
}

/**
 * Mirror 2D point across Y axis
 */
export function mirrorY2D(p: Point2D): Point2D {
  return { x: p.x, y: -p.y };
}

/**
 * Check if two 2D points are approximately equal
 */
export function equals2D(
  a: Point2D,
  b: Point2D,
  epsilon: number = 0.0001,
): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

/**
 * With X - create new point with different X
 */
export function withX2D(p: Point2D, x: number): Point2D {
  return { x, y: p.y };
}

/**
 * With Y - create new point with different Y
 */
export function withY2D(p: Point2D, y: number): Point2D {
  return { x: p.x, y };
}

/**
 * Add X to point
 */
export function addX2D(p: Point2D, x: number): Point2D {
  return { x: p.x + x, y: p.y };
}

/**
 * Add Y to point
 */
export function addY2D(p: Point2D, y: number): Point2D {
  return { x: p.x, y: p.y + y };
}

// =============================================================================
// POINT3D OPERATIONS
// =============================================================================

/**
 * Add two 3D points
 */
export function add3D(a: Point3D, b: Point3D): Point3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * Subtract 3D points
 */
export function sub3D(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Multiply 3D point by scalar
 */
export function mul3D(p: Point3D, s: number): Point3D {
  return { x: p.x * s, y: p.y * s, z: p.z * s };
}

/**
 * Multiply 3D point component-wise
 */
export function mult3D(a: Point3D, b: Point3D): Point3D {
  return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z };
}

/**
 * Divide 3D point by scalar
 */
export function div3D(p: Point3D, s: number): Point3D {
  return { x: p.x / s, y: p.y / s, z: p.z / s };
}

/**
 * Negate 3D point
 */
export function neg3D(p: Point3D): Point3D {
  return { x: -p.x, y: -p.y, z: -p.z };
}

/**
 * Dot product of 3D points
 */
export function dot3D(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Cross product of 3D points
 */
export function cross3D(a: Point3D, b: Point3D): Point3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Length of 3D vector
 */
export function length3D(p: Point3D): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
}

/**
 * Squared length of 3D vector
 */
export function lengthSq3D(p: Point3D): number {
  return p.x * p.x + p.y * p.y + p.z * p.z;
}

/**
 * Normalize 3D vector
 */
export function normalize3D(p: Point3D): Point3D {
  const len = length3D(p);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: p.x / len, y: p.y / len, z: p.z / len };
}

/**
 * Distance between 3D points
 */
export function distance3D(a: Point3D, b: Point3D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Squared distance between 3D points
 */
export function distanceSq3D(a: Point3D, b: Point3D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Linear interpolation between 3D points
 */
export function lerp3D(a: Point3D, b: Point3D, t: number): Point3D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/**
 * Extra lerp (can go beyond 0-1 range)
 */
export function extraLerp3D(a: Point3D, b: Point3D, t: number): Point3D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/**
 * Check if two 3D points are approximately equal
 */
export function equals3D(
  a: Point3D,
  b: Point3D,
  epsilon: number = 0.0001,
): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.z - b.z) < epsilon
  );
}

/**
 * With X - create new point with different X
 */
export function withX3D(p: Point3D, x: number): Point3D {
  return { x, y: p.y, z: p.z };
}

/**
 * With Y - create new point with different Y
 */
export function withY3D(p: Point3D, y: number): Point3D {
  return { x: p.x, y, z: p.z };
}

/**
 * With Z - create new point with different Z
 */
export function withZ3D(p: Point3D, z: number): Point3D {
  return { x: p.x, y: p.y, z };
}

/**
 * Add X to point
 */
export function addX3D(p: Point3D, x: number): Point3D {
  return { x: p.x + x, y: p.y, z: p.z };
}

/**
 * Add Y to point
 */
export function addY3D(p: Point3D, y: number): Point3D {
  return { x: p.x, y: p.y + y, z: p.z };
}

/**
 * Add Z to point
 */
export function addZ3D(p: Point3D, z: number): Point3D {
  return { x: p.x, y: p.y, z: p.z + z };
}

/**
 * Multiply X by scalar
 */
export function multX3D(p: Point3D, s: number): Point3D {
  return { x: p.x * s, y: p.y, z: p.z };
}

/**
 * Multiply Y by scalar
 */
export function multY3D(p: Point3D, s: number): Point3D {
  return { x: p.x, y: p.y * s, z: p.z };
}

/**
 * Multiply Z by scalar
 */
export function multZ3D(p: Point3D, s: number): Point3D {
  return { x: p.x, y: p.y, z: p.z * s };
}

/**
 * Clone a 3D point
 */
export function clone3D(p: Point3D): Point3D {
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * Clone a 2D point
 */
export function clone2D(p: Point2D): Point2D {
  return { x: p.x, y: p.y };
}

// =============================================================================
// INTERSECTION UTILITIES
// =============================================================================

/**
 * Get intersection point of two line segments
 * Returns null if no intersection
 */
export function getLineIntersection(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
): Point2D | null {
  const s1_x = p1.x - p0.x;
  const s1_y = p1.y - p0.y;
  const s2_x = p3.x - p2.x;
  const s2_y = p3.y - p2.y;

  const denom = -s2_x * s1_y + s1_x * s2_y;
  if (Math.abs(denom) < 0.0001) return null; // Parallel

  const s = (-s1_y * (p0.x - p2.x) + s1_x * (p0.y - p2.y)) / denom;
  const t = (s2_x * (p0.y - p2.y) - s2_y * (p0.x - p2.x)) / denom;

  if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
    return {
      x: p0.x + t * s1_x,
      y: p0.y + t * s1_y,
    };
  }

  return null;
}

/**
 * Get intersection point of two infinite lines
 */
export function getInfiniteLineIntersection(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
): { point: Point2D; error: boolean } {
  const s1_x = p1.x - p0.x;
  const s1_y = p1.y - p0.y;
  const s2_x = p3.x - p2.x;
  const s2_y = p3.y - p2.y;

  const denom = -s2_x * s1_y + s1_x * s2_y;
  if (Math.abs(denom) < 0.0001) {
    return { point: { x: 0, y: 0 }, error: true };
  }

  const t = (s2_x * (p0.y - p2.y) - s2_y * (p0.x - p2.x)) / denom;

  return {
    point: {
      x: p0.x + t * s1_x,
      y: p0.y + t * s1_y,
    },
    error: false,
  };
}

// =============================================================================
// BOUNDS UTILITIES
// =============================================================================

/**
 * Get bounding box extents from array of points
 */
export function getExtents2D(points: Point2D[]): {
  min: Point2D;
  max: Point2D;
} {
  if (points.length === 0) {
    return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  }

  let minX = Infinity,
    minY = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
  };
}

/**
 * Get bounding box extents from array of 3D points
 */
export function getExtents3D(points: Point3D[]): {
  min: Point3D;
  max: Point3D;
} {
  if (points.length === 0) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  }

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

/**
 * Check if a number is approximately equal to another
 */
export function softEquals(
  a: number,
  b: number,
  epsilon: number = 0.01,
): boolean {
  return Math.abs(a - b) < epsilon;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp a value between 0 and 1
 */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
