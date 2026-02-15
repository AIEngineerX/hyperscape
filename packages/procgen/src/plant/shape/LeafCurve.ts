/**
 * LeafCurve - Leaf-specific Bezier curve operations
 *
 * Extends basic Bezier curves with leaf geometry functionality:
 * - Curve types (FullSide, LowerHalf, LobeOuter, etc.)
 * - Mirroring for symmetric leaves
 * - Intersection detection
 * - Curve chaining
 */

import type {
  Point2D,
  Curve2D,
  Curve3D,
  LeafCurve,
  LeafCurveType,
} from "../types.js";
import { LeafCurveType as LCT } from "../types.js";
import {
  evaluateCurve2D,
  subdivideCurve2D,
  findClosestPointOnCurve2D,
  getCurveTangent2D,
  sliceCurve2D,
  findApex2D,
  curve2Dto3D,
} from "../math/Bezier.js";
import {
  clone2D,
  lerp2D,
  distance2D,
  sub2D,
  add2D,
  mirrorX2D,
  getInfiniteLineIntersection,
} from "../math/Vector.js";
import { angleBetween, PI, addPolar, polar } from "../math/Polar.js";

// =============================================================================
// LEAFCURVE CREATION
// =============================================================================

/**
 * Create a new LeafCurve
 */
export function createLeafCurve(
  p0: Point2D,
  h0: Point2D,
  h1: Point2D,
  p1: Point2D,
  curveType: LeafCurveType,
  lefty: boolean = false,
): LeafCurve {
  return {
    p0: clone2D(p0),
    h0: clone2D(h0),
    h1: clone2D(h1),
    p1: clone2D(p1),
    curveType,
    lefty,
    nextCurve: null,
    prevCurve: null,
  };
}

/**
 * Create a default starting leaf curve (vertical line)
 */
export function createDefaultLeafCurve(
  baseWidth: number,
  baseHeight: number,
): LeafCurve {
  return createLeafCurve(
    { x: 0, y: 0 },
    { x: baseWidth, y: baseHeight / 3 },
    { x: baseWidth, y: (baseHeight / 3) * 2 },
    { x: 0, y: baseHeight },
    LCT.FullSide,
    false,
  );
}

/**
 * Copy a LeafCurve
 */
export function copyLeafCurve(curve: LeafCurve): LeafCurve {
  return {
    p0: clone2D(curve.p0),
    h0: clone2D(curve.h0),
    h1: clone2D(curve.h1),
    p1: clone2D(curve.p1),
    curveType: curve.curveType,
    lefty: curve.lefty,
    nextCurve: null,
    prevCurve: null,
  };
}

/**
 * Clone a LeafCurve array
 */
export function cloneLeafCurves(curves: LeafCurve[]): LeafCurve[] {
  const cloned = curves.map(copyLeafCurve);
  rebuildCurveJoins(cloned);
  return cloned;
}

// =============================================================================
// CURVE OPERATIONS
// =============================================================================

/**
 * Evaluate a LeafCurve at parameter t
 */
export function evaluateLeafCurve(curve: LeafCurve, t: number): Point2D {
  return evaluateCurve2D(curve, t);
}

/**
 * Get the tangent of a LeafCurve at parameter t
 */
export function getLeafCurveTangent(curve: LeafCurve, t: number): Point2D {
  return getCurveTangent2D(curve, t);
}

/**
 * Get the angle at the start of the curve (p0 -> h0)
 */
export function getAngle0(curve: LeafCurve): number {
  return angleBetween(curve.p0, curve.h0);
}

/**
 * Get the angle at the end of the curve (h1 -> p1)
 */
export function getAngle1(curve: LeafCurve): number {
  return angleBetween(curve.h1, curve.p1);
}

/**
 * Get the inner angle between the handles
 */
export function getHandlesInnerAngle(curve: LeafCurve): number {
  const a0 = angleBetween(curve.p0, curve.h0);
  const a1 = angleBetween(curve.p1, curve.h1);
  return a1 - a0;
}

/**
 * Sheer the curve (adjust handle X positions)
 *
 * From original C# LeafCurve.cs:
 * public void Sheer(float val, float baseWidth) {
 *   h0.x = baseWidth * val * 2f;
 *   h1.x = baseWidth * (1 - val) * 2f;
 * }
 */
export function sheerCurve(
  curve: LeafCurve,
  sheerAmount: number,
  baseWidth: number,
): void {
  curve.h0.x = baseWidth * sheerAmount * 2;
  curve.h1.x = baseWidth * (1 - sheerAmount) * 2;
}

/**
 * Set pudge (bulge) on the curve
 *
 * From original C# LeafCurve.cs:
 * public float Pudge {
 *   set {
 *     h0.y = value * (p1.y - p0.y);
 *     h1.y = (1 - value) * (p1.y - p0.y);
 *   }
 * }
 */
export function setPudge(
  curve: LeafCurve,
  pudge: number,
  baseHeight: number,
): void {
  // value = pudge / -baseHeight (from LeafShape.cs)
  const value = pudge / -baseHeight;

  // Original C# implementation
  const heightDiff = curve.p1.y - curve.p0.y;
  curve.h0.y = value * heightDiff;
  curve.h1.y = (1 - value) * heightDiff;
}

/**
 * Set length extent (scale Y)
 */
export function setLengthExtent(
  curve: LeafCurve,
  extent: number,
  baseHeight: number,
): void {
  const scale = extent / -baseHeight;
  curve.p1.y *= scale;
  curve.h0.y *= scale;
  curve.h1.y *= scale;
}

/**
 * Set width extent (scale X)
 */
export function setWidthExtent(
  curve: LeafCurve,
  extent: number,
  baseWidth: number,
): void {
  const scale = extent / baseWidth;
  curve.h0.x *= scale;
  curve.h1.x *= scale;
}

/**
 * Set the tip angle and amplitude
 */
export function setTip(
  curve: LeafCurve,
  angleDegrees: number,
  amplitude: number,
): void {
  curve.h1 = addPolar(curve.p1, polar(amplitude, angleDegrees, true));
}

/**
 * Subdivide a LeafCurve at parameter t
 * Returns two new curves and updates the original
 */
export function subdivideLeafCurve(
  curve: LeafCurve,
  t: number,
): { first: LeafCurve; second: LeafCurve } {
  const { first, second } = subdivideCurve2D(curve, t);

  const firstLeaf: LeafCurve = {
    ...first,
    curveType: curve.curveType,
    lefty: curve.lefty,
    nextCurve: null,
    prevCurve: curve.prevCurve,
  };

  const secondLeaf: LeafCurve = {
    ...second,
    curveType: curve.curveType,
    lefty: curve.lefty,
    nextCurve: curve.nextCurve,
    prevCurve: null,
  };

  firstLeaf.nextCurve = secondLeaf;
  secondLeaf.prevCurve = firstLeaf;

  return { first: firstLeaf, second: secondLeaf };
}

/**
 * Get a slice of a LeafCurve between t0 and t1
 */
export function sliceLeafCurve(
  curve: LeafCurve,
  t0: number,
  t1: number,
): LeafCurve {
  const sliced = sliceCurve2D(curve, t0, t1);
  return {
    ...sliced,
    curveType: curve.curveType,
    lefty: curve.lefty,
    nextCurve: null,
    prevCurve: null,
  };
}

/**
 * Find the apex (highest Y point) on the curve
 */
export function findCurveApex(curve: LeafCurve, startT: number = 0): number {
  return findApex2D(curve, startT);
}

/**
 * Find the closest angle on the curve to a target angle
 */
export function findClosestAngle(
  curve: LeafCurve,
  targetAngle: number,
): number {
  // Sample the curve and find where tangent matches target
  const steps = 20;
  let bestT = 0;
  let bestDiff = Infinity;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const tangent = getLeafCurveTangent(curve, t);
    const angle = Math.atan2(tangent.y, tangent.x);
    const diff = Math.abs(angle - targetAngle);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestT = t;
    }
  }

  return bestT;
}

/**
 * Get the percentage along the curve for a given point
 */
export function getPercentFromPoint(curve: LeafCurve, point: Point2D): number {
  const result = findClosestPointOnCurve2D(curve, point);
  return result.t;
}

/**
 * Create an extension curve (continues from p1)
 */
export function createExtension(curve: LeafCurve): LeafCurve {
  const dir = sub2D(curve.p1, curve.h1);
  const newH0 = add2D(curve.p1, dir);
  const newP1 = add2D(newH0, dir);
  const newH1 = lerp2D(newH0, newP1, 0.5);

  return createLeafCurve(
    clone2D(curve.p1),
    newH0,
    newH1,
    newP1,
    curve.curveType,
    curve.lefty,
  );
}

// =============================================================================
// CURVE LINKING
// =============================================================================

/**
 * Link two curves together
 */
export function linkCurves(first: LeafCurve, second: LeafCurve): void {
  first.nextCurve = second;
  second.prevCurve = first;
}

/**
 * Rebuild joins for an array of curves
 */
export function rebuildCurveJoins(curves: LeafCurve[]): void {
  // Clear all joins first
  for (const curve of curves) {
    curve.prevCurve = null;
    curve.nextCurve = null;
  }

  // Rebuild sequential joins
  for (let i = 1; i < curves.length; i++) {
    curves[i - 1].nextCurve = curves[i];
    curves[i].prevCurve = curves[i - 1];
  }
}

/**
 * Join the end of the curve array to the start (close the loop)
 */
export function joinCurveEnds(curves: LeafCurve[]): void {
  if (curves.length < 2) return;
  const last = curves[curves.length - 1];
  const first = curves[0];
  linkCurves(last, first);
}

// =============================================================================
// MIRRORING
// =============================================================================

/**
 * Mirror a single curve across the Y axis
 */
export function mirrorLeafCurve(curve: LeafCurve): LeafCurve {
  return createLeafCurve(
    mirrorX2D(curve.p1),
    mirrorX2D(curve.h1),
    mirrorX2D(curve.h0),
    mirrorX2D(curve.p0),
    curve.curveType,
    true, // Mark as lefty
  );
}

/**
 * Mirror all curves and append to array
 */
export function mirrorCurves(
  curves: LeafCurve[],
  replace: boolean = false,
): LeafCurve[] {
  if (replace) {
    // Remove existing mirrored curves
    const originalCount = curves.length;
    if (originalCount % 2 === 1) {
      curves.splice(
        Math.floor((originalCount + 1) / 2),
        Math.floor((originalCount - 1) / 2),
      );
    } else {
      curves.splice(originalCount / 2, originalCount / 2);
    }
  }

  const originalLength = curves.length;

  // Mirror in reverse order
  for (let i = originalLength - 1; i >= 0; i--) {
    const mirrored = mirrorLeafCurve(curves[i]);
    curves.push(mirrored);
  }

  rebuildCurveJoins(curves);
  return curves;
}

// =============================================================================
// INTERSECTION DETECTION
// =============================================================================

/**
 * Check if two curves intersect (using subdivision)
 */
export function curvesIntersect(
  curve1: LeafCurve,
  curve2: LeafCurve,
  depth: number = 4,
  skipEndpoints: boolean = true,
): { intersects: boolean; point: Point2D } {
  // Quick bounding box check
  const box1 = getCurveBoundingBox(curve1);
  const box2 = getCurveBoundingBox(curve2);

  if (!boxesOverlap(box1, box2)) {
    return { intersects: false, point: { x: 0, y: 0 } };
  }

  if (depth === 0) {
    // At max depth, check line intersection
    const result = getInfiniteLineIntersection(
      curve1.p0,
      curve1.p1,
      curve2.p0,
      curve2.p1,
    );

    if (result.error) {
      return { intersects: false, point: { x: 0, y: 0 } };
    }

    // Check if intersection is within both segments
    const t1 = getParameterForPoint(curve1, result.point);
    const t2 = getParameterForPoint(curve2, result.point);

    if (t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1) {
      // Skip if at endpoints
      if (skipEndpoints) {
        if ((t1 < 0.01 || t1 > 0.99) && (t2 < 0.01 || t2 > 0.99)) {
          return { intersects: false, point: { x: 0, y: 0 } };
        }
      }
      return { intersects: true, point: result.point };
    }

    return { intersects: false, point: { x: 0, y: 0 } };
  }

  // Subdivide and recurse
  const { first: c1a, second: c1b } = subdivideLeafCurve(curve1, 0.5);
  const { first: c2a, second: c2b } = subdivideLeafCurve(curve2, 0.5);

  const tests: [LeafCurve, LeafCurve][] = [
    [c1a, c2a],
    [c1a, c2b],
    [c1b, c2a],
    [c1b, c2b],
  ];

  for (const [a, b] of tests) {
    const result = curvesIntersect(a, b, depth - 1, skipEndpoints);
    if (result.intersects) {
      return result;
    }
  }

  return { intersects: false, point: { x: 0, y: 0 } };
}

/**
 * Get bounding box of a curve
 */
function getCurveBoundingBox(curve: LeafCurve): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const points = [curve.p0, curve.h0, curve.h1, curve.p1];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Check if two bounding boxes overlap
 */
function boxesOverlap(
  box1: { minX: number; minY: number; maxX: number; maxY: number },
  box2: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return !(
    box1.maxX < box2.minX ||
    box2.maxX < box1.minX ||
    box1.maxY < box2.minY ||
    box2.maxY < box1.minY
  );
}

/**
 * Get approximate parameter t for a point on the curve
 */
function getParameterForPoint(curve: LeafCurve, point: Point2D): number {
  const dx = curve.p1.x - curve.p0.x;
  const dy = curve.p1.y - curve.p0.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    return (point.x - curve.p0.x) / dx;
  } else {
    return (point.y - curve.p0.y) / dy;
  }
}

// =============================================================================
// ANGLE FLATTENING
// =============================================================================

/**
 * Get the angle between two connected curves at their junction
 */
export function getJunctionAngle(curve1: LeafCurve, curve2: LeafCurve): number {
  const angle1 = getAngle1(curve1);
  const angle2 = getAngle0(curve2);
  return angle2 - angle1;
}

/**
 * Flatten the angle at a junction between two curves
 */
export function flattenJunctionAngle(
  curve1: LeafCurve,
  curve2: LeafCurve,
  _baseWidth: number,
): void {
  // Get the current angles
  const angle1 = getAngle1(curve1);
  const angle2 = getAngle0(curve2);

  // Calculate the average angle
  const avgAngle = (angle1 + angle2 + PI) / 2;

  // Calculate handle lengths
  const len1 = distance2D(curve1.h1, curve1.p1);
  const len2 = distance2D(curve2.h0, curve2.p0);

  // Adjust handles to meet at average angle
  curve1.h1 = addPolar(curve1.p1, polar(len1, avgAngle + PI));
  curve2.h0 = addPolar(curve2.p0, polar(len2, avgAngle));
}

// =============================================================================
// CONVERSION
// =============================================================================

/**
 * Convert LeafCurve to Curve2D
 */
export function leafCurveToCurve2D(curve: LeafCurve): Curve2D {
  return {
    p0: clone2D(curve.p0),
    h0: clone2D(curve.h0),
    h1: clone2D(curve.h1),
    p1: clone2D(curve.p1),
  };
}

/**
 * Convert LeafCurve to Curve3D
 */
export function leafCurveToCurve3D(curve: LeafCurve): Curve3D {
  return curve2Dto3D(leafCurveToCurve2D(curve));
}

/**
 * Convert array of LeafCurves to Curve2D array
 */
export function leafCurvesToCurve2D(curves: LeafCurve[]): Curve2D[] {
  return curves.map(leafCurveToCurve2D);
}

/**
 * Convert array of LeafCurves to Curve3D array
 */
export function leafCurvesToCurve3D(curves: LeafCurve[]): Curve3D[] {
  return curves.map(leafCurveToCurve3D);
}

// =============================================================================
// CURVE FINDER
// =============================================================================

/**
 * Find a curve by type in an array
 */
export function findCurveByType(
  curves: LeafCurve[],
  type: LeafCurveType,
  leftyCheck: "all" | "left" | "right" = "all",
  allowFallback: boolean = true,
): LeafCurve | null {
  let found: LeafCurve | null = null;

  for (const curve of curves) {
    if (leftyCheck === "right" && curve.lefty) continue;
    if (leftyCheck === "left" && !curve.lefty) continue;

    if (curve.curveType === type) {
      found = curve;
    }
  }

  if (found) return found;

  // Fallback hierarchy
  if (allowFallback) {
    if (type === LCT.Scoop)
      return findCurveByType(curves, LCT.LobeInner, leftyCheck, true);
    if (type === LCT.LobeInner)
      return findCurveByType(curves, LCT.LobeOuter, leftyCheck, true);
    if (type === LCT.LobeOuter)
      return findCurveByType(curves, LCT.LowerHalf, leftyCheck, true);
    if (type === LCT.Tip)
      return findCurveByType(curves, LCT.LowerHalf, leftyCheck, true);
    if (type === LCT.LowerHalf)
      return findCurveByType(curves, LCT.FullSide, leftyCheck, true);
    if (type === LCT.FullSide && curves.length > 0) return curves[0];
  }

  return null;
}

/**
 * Update a point on a curve by index (0=p0, 1=h0, 2=h1, 3=p1)
 */
export function updateCurvePoint(
  curve: LeafCurve,
  pointIndex: number,
  newValue: Point2D,
): void {
  switch (pointIndex) {
    case 0:
      curve.p0 = clone2D(newValue);
      if (curve.prevCurve) {
        curve.prevCurve.p1 = clone2D(newValue);
      }
      break;
    case 1:
      curve.h0 = clone2D(newValue);
      break;
    case 2:
      curve.h1 = clone2D(newValue);
      break;
    case 3:
      curve.p1 = clone2D(newValue);
      if (curve.nextCurve) {
        curve.nextCurve.p0 = clone2D(newValue);
      }
      break;
  }
}
