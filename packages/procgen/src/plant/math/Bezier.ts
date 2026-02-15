/**
 * Cubic Bezier curve mathematics
 *
 * Provides functions for evaluating, subdividing, and manipulating
 * cubic Bezier curves in 2D and 3D.
 */

import type { Point2D, Point3D, Curve2D, Curve3D } from "../types.js";
import {
  lerp2D,
  distance2D,
  clone2D,
  lerp3D,
  distance3D,
  clone3D,
  softEquals,
} from "./Vector.js";
import { angleBetween } from "./Polar.js";

// =============================================================================
// 2D BEZIER CURVES
// =============================================================================

/**
 * Create a 2D Bezier curve
 */
export function createCurve2D(
  p0: Point2D,
  h0: Point2D,
  h1: Point2D,
  p1: Point2D,
): Curve2D {
  return {
    p0: clone2D(p0),
    h0: clone2D(h0),
    h1: clone2D(h1),
    p1: clone2D(p1),
  };
}

/**
 * Create a line as a Bezier curve (handles at 1/3 and 2/3 points)
 */
export function createLine2D(p0: Point2D, p1: Point2D): Curve2D {
  return {
    p0: clone2D(p0),
    h0: lerp2D(p0, p1, 1 / 3),
    h1: lerp2D(p0, p1, 2 / 3),
    p1: clone2D(p1),
  };
}

/**
 * Evaluate a 2D cubic Bezier curve at parameter t
 */
export function evaluateCurve2D(curve: Curve2D, t: number): Point2D {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;

  return {
    x:
      mt3 * curve.p0.x +
      3 * mt2 * t * curve.h0.x +
      3 * mt * t2 * curve.h1.x +
      t3 * curve.p1.x,
    y:
      mt3 * curve.p0.y +
      3 * mt2 * t * curve.h0.y +
      3 * mt * t2 * curve.h1.y +
      t3 * curve.p1.y,
  };
}

/**
 * Get the tangent (derivative) of a 2D Bezier curve at parameter t
 */
export function getCurveTangent2D(curve: Curve2D, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  // First derivative of cubic Bezier
  return {
    x:
      3 * mt2 * (curve.h0.x - curve.p0.x) +
      6 * mt * t * (curve.h1.x - curve.h0.x) +
      3 * t2 * (curve.p1.x - curve.h1.x),
    y:
      3 * mt2 * (curve.h0.y - curve.p0.y) +
      6 * mt * t * (curve.h1.y - curve.h0.y) +
      3 * t2 * (curve.p1.y - curve.h1.y),
  };
}

/**
 * Get approximate arc length of a 2D Bezier curve
 */
export function getCurveLength2D(
  curve: Curve2D,
  segments: number = 20,
): number {
  let length = 0;
  let lastPoint = curve.p0;

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const point = evaluateCurve2D(curve, t);
    length += distance2D(lastPoint, point);
    lastPoint = point;
  }

  return length;
}

/**
 * Subdivide a 2D Bezier curve at parameter t using de Casteljau's algorithm
 */
export function subdivideCurve2D(
  curve: Curve2D,
  t: number,
): { first: Curve2D; second: Curve2D } {
  // First level
  const q0 = lerp2D(curve.p0, curve.h0, t);
  const q1 = lerp2D(curve.h0, curve.h1, t);
  const q2 = lerp2D(curve.h1, curve.p1, t);

  // Second level
  const r0 = lerp2D(q0, q1, t);
  const r1 = lerp2D(q1, q2, t);

  // Third level (the point on the curve)
  const s = lerp2D(r0, r1, t);

  return {
    first: { p0: clone2D(curve.p0), h0: q0, h1: r0, p1: s },
    second: { p0: clone2D(s), h0: r1, h1: q2, p1: clone2D(curve.p1) },
  };
}

/**
 * Get a slice of a 2D Bezier curve between parameters t0 and t1
 */
export function sliceCurve2D(curve: Curve2D, t0: number, t1: number): Curve2D {
  // First subdivide at t1
  const { first } = subdivideCurve2D(curve, t1);
  // Then subdivide the first part at t0/t1
  const adjustedT0 = t0 / t1;
  const { second } = subdivideCurve2D(first, adjustedT0);
  return second;
}

/**
 * Copy a 2D curve
 */
export function copyCurve2D(curve: Curve2D): Curve2D {
  return {
    p0: clone2D(curve.p0),
    h0: clone2D(curve.h0),
    h1: clone2D(curve.h1),
    p1: clone2D(curve.p1),
  };
}

/**
 * Spread handles evenly along the curve
 */
export function spreadHandles2D(curve: Curve2D): Curve2D {
  return {
    p0: clone2D(curve.p0),
    h0: lerp2D(curve.p0, curve.p1, 1 / 3),
    h1: lerp2D(curve.p0, curve.p1, 2 / 3),
    p1: clone2D(curve.p1),
  };
}

/**
 * Find the closest point on a 2D Bezier curve to a given point
 * Returns the parameter t and the distance
 */
export function findClosestPointOnCurve2D(
  curve: Curve2D,
  point: Point2D,
  iterations: number = 3,
  slices: number = 10,
): { t: number; distance: number; point: Point2D } {
  let start = 0;
  let end = 1;

  for (let iter = 0; iter < iterations; iter++) {
    const tick = (end - start) / slices;
    let best = 0;
    let bestDistance = Infinity;

    for (let t = start; t <= end + tick * 0.9; t += tick) {
      const curvePoint = evaluateCurve2D(curve, Math.min(t, 1));
      const dist = distance2D(curvePoint, point);
      if (dist < bestDistance) {
        bestDistance = dist;
        best = t;
      }
    }

    start = Math.max(best - tick, 0);
    end = Math.min(best + tick, 1);
  }

  const finalT = (start + end) / 2;
  const finalPoint = evaluateCurve2D(curve, finalT);
  return {
    t: finalT,
    distance: distance2D(finalPoint, point),
    point: finalPoint,
  };
}

/**
 * Get the angle at the start of a 2D curve (p0 to h0)
 */
export function getStartAngle2D(curve: Curve2D): number {
  return angleBetween(curve.p0, curve.h0);
}

/**
 * Get the angle at the end of a 2D curve (h1 to p1)
 */
export function getEndAngle2D(curve: Curve2D): number {
  return angleBetween(curve.h1, curve.p1);
}

/**
 * Get the inner angle between handles at a junction
 */
export function getHandlesInnerAngle2D(curve: Curve2D): number {
  const angle0 = angleBetween(curve.p0, curve.h0);
  const angle1 = angleBetween(curve.p1, curve.h1);
  return angle1 - angle0;
}

/**
 * Find the apex (highest Y value) on a curve
 */
export function findApex2D(curve: Curve2D, startT: number = 0): number {
  // Use Newton's method to find maximum Y
  let t = startT + 0.5;
  const steps = 20;

  for (let i = 0; i < steps; i++) {
    const tangent = getCurveTangent2D(curve, t);
    if (Math.abs(tangent.y) < 0.0001) break;
    // Move toward zero tangent
    t -= tangent.y * 0.1;
    t = Math.max(0, Math.min(1, t));
  }

  return t;
}

/**
 * Get the span (diagonal extent) of a 2D curve's bounding box
 */
export function getCurveSpan2D(curve: Curve2D): number {
  const dx = Math.abs(curve.p1.x - curve.p0.x);
  const dy = Math.abs(curve.p1.y - curve.p0.y);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Fast approximate length using control polygon
 */
export function fastLength2D(curve: Curve2D): number {
  const chordLength = distance2D(curve.p0, curve.p1);
  const controlLength =
    distance2D(curve.p0, curve.h0) +
    distance2D(curve.h0, curve.h1) +
    distance2D(curve.h1, curve.p1);
  return (chordLength + controlLength) / 2;
}

// =============================================================================
// 3D BEZIER CURVES
// =============================================================================

/**
 * Create a 3D Bezier curve
 */
export function createCurve3D(
  p0: Point3D,
  h0: Point3D,
  h1: Point3D,
  p1: Point3D,
): Curve3D {
  return {
    p0: clone3D(p0),
    h0: clone3D(h0),
    h1: clone3D(h1),
    p1: clone3D(p1),
  };
}

/**
 * Create a 3D Bezier curve from two points (auto-generate handles)
 */
export function createCurve3DFromPoints(p0: Point3D, p1: Point3D): Curve3D {
  return {
    p0: clone3D(p0),
    h0: lerp3D(p0, p1, 1 / 3),
    h1: lerp3D(p0, p1, 2 / 3),
    p1: clone3D(p1),
  };
}

/**
 * Convert a 2D curve to 3D (z = 0)
 */
export function curve2Dto3D(curve: Curve2D): Curve3D {
  return {
    p0: { x: curve.p0.x, y: curve.p0.y, z: 0 },
    h0: { x: curve.h0.x, y: curve.h0.y, z: 0 },
    h1: { x: curve.h1.x, y: curve.h1.y, z: 0 },
    p1: { x: curve.p1.x, y: curve.p1.y, z: 0 },
  };
}

/**
 * Convert a 3D curve to 2D (drop z)
 */
export function curve3Dto2D(curve: Curve3D): Curve2D {
  return {
    p0: { x: curve.p0.x, y: curve.p0.y },
    h0: { x: curve.h0.x, y: curve.h0.y },
    h1: { x: curve.h1.x, y: curve.h1.y },
    p1: { x: curve.p1.x, y: curve.p1.y },
  };
}

/**
 * Evaluate a 3D cubic Bezier curve at parameter t
 */
export function evaluateCurve3D(curve: Curve3D, t: number): Point3D {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;

  return {
    x:
      mt3 * curve.p0.x +
      3 * mt2 * t * curve.h0.x +
      3 * mt * t2 * curve.h1.x +
      t3 * curve.p1.x,
    y:
      mt3 * curve.p0.y +
      3 * mt2 * t * curve.h0.y +
      3 * mt * t2 * curve.h1.y +
      t3 * curve.p1.y,
    z:
      mt3 * curve.p0.z +
      3 * mt2 * t * curve.h0.z +
      3 * mt * t2 * curve.h1.z +
      t3 * curve.p1.z,
  };
}

/**
 * Get the tangent (derivative) of a 3D Bezier curve at parameter t
 */
export function getCurveTangent3D(curve: Curve3D, t: number): Point3D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  return {
    x:
      3 * mt2 * (curve.h0.x - curve.p0.x) +
      6 * mt * t * (curve.h1.x - curve.h0.x) +
      3 * t2 * (curve.p1.x - curve.h1.x),
    y:
      3 * mt2 * (curve.h0.y - curve.p0.y) +
      6 * mt * t * (curve.h1.y - curve.h0.y) +
      3 * t2 * (curve.p1.y - curve.h1.y),
    z:
      3 * mt2 * (curve.h0.z - curve.p0.z) +
      6 * mt * t * (curve.h1.z - curve.h0.z) +
      3 * t2 * (curve.p1.z - curve.h1.z),
  };
}

/**
 * Get approximate arc length of a 3D Bezier curve
 */
export function getCurveLength3D(
  curve: Curve3D,
  segments: number = 20,
): number {
  let length = 0;
  let lastPoint = curve.p0;

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const point = evaluateCurve3D(curve, t);
    length += distance3D(lastPoint, point);
    lastPoint = point;
  }

  return length;
}

/**
 * Subdivide a 3D Bezier curve at parameter t
 */
export function subdivideCurve3D(
  curve: Curve3D,
  t: number,
): { first: Curve3D; second: Curve3D } {
  const q0 = lerp3D(curve.p0, curve.h0, t);
  const q1 = lerp3D(curve.h0, curve.h1, t);
  const q2 = lerp3D(curve.h1, curve.p1, t);

  const r0 = lerp3D(q0, q1, t);
  const r1 = lerp3D(q1, q2, t);

  const s = lerp3D(r0, r1, t);

  return {
    first: { p0: clone3D(curve.p0), h0: q0, h1: r0, p1: s },
    second: { p0: clone3D(s), h0: r1, h1: q2, p1: clone3D(curve.p1) },
  };
}

/**
 * Get a slice of a 3D Bezier curve between parameters t0 and t1
 */
export function sliceCurve3D(curve: Curve3D, t0: number, t1: number): Curve3D {
  const { first } = subdivideCurve3D(curve, t1);
  const adjustedT0 = t0 / t1;
  const { second } = subdivideCurve3D(first, adjustedT0);
  return second;
}

/**
 * Copy a 3D curve
 */
export function copyCurve3D(curve: Curve3D): Curve3D {
  return {
    p0: clone3D(curve.p0),
    h0: clone3D(curve.h0),
    h1: clone3D(curve.h1),
    p1: clone3D(curve.p1),
  };
}

/**
 * Spread handles evenly along the 3D curve
 */
export function spreadHandles3D(curve: Curve3D): Curve3D {
  return {
    p0: clone3D(curve.p0),
    h0: lerp3D(curve.p0, curve.p1, 1 / 3),
    h1: lerp3D(curve.p0, curve.p1, 2 / 3),
    p1: clone3D(curve.p1),
  };
}

/**
 * Find the closest point on a 3D Bezier curve to a given point
 * Works in XY plane only (for leaf generation)
 */
export function findClosestPointOnCurve3D(
  curve: Curve3D,
  point: Point3D,
  iterations: number = 2,
  slices: number = 10,
): { t: number; distance: number; point: Point3D } {
  let start = 0;
  let end = 1;

  for (let iter = 0; iter < iterations; iter++) {
    const tick = (end - start) / slices;
    let best = 0;
    let bestDistance = Infinity;

    for (let t = start; t <= end + tick * 0.9; t += tick) {
      const curvePoint = evaluateCurve3D(curve, Math.min(t, 1));
      // 2D distance in XY plane
      const dx = curvePoint.x - point.x;
      const dy = curvePoint.y - point.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDistance) {
        bestDistance = dist;
        best = t;
      }
    }

    start = Math.max(best - tick, 0);
    end = Math.min(best + tick, 1);
  }

  const finalT = (start + end) / 2;
  const finalPoint = evaluateCurve3D(curve, finalT);
  return {
    t: finalT,
    distance: distance3D(finalPoint, point),
    point: finalPoint,
  };
}

/**
 * Rotate a 3D curve around an axis
 */
export function rotateCurve3D(
  curve: Curve3D,
  angleX: number,
  angleY: number,
  angleZ: number,
  pivot: Point3D = { x: 0, y: 0, z: 0 },
): Curve3D {
  const rotatePoint = (p: Point3D): Point3D => {
    // Translate to pivot
    let x = p.x - pivot.x;
    let y = p.y - pivot.y;
    let z = p.z - pivot.z;

    // Rotate around X
    if (angleX !== 0) {
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);
      const y1 = y * cosX - z * sinX;
      const z1 = y * sinX + z * cosX;
      y = y1;
      z = z1;
    }

    // Rotate around Y
    if (angleY !== 0) {
      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const x1 = x * cosY + z * sinY;
      const z1 = -x * sinY + z * cosY;
      x = x1;
      z = z1;
    }

    // Rotate around Z
    if (angleZ !== 0) {
      const cosZ = Math.cos(angleZ);
      const sinZ = Math.sin(angleZ);
      const x1 = x * cosZ - y * sinZ;
      const y1 = x * sinZ + y * cosZ;
      x = x1;
      y = y1;
    }

    // Translate back
    return {
      x: x + pivot.x,
      y: y + pivot.y,
      z: z + pivot.z,
    };
  };

  return {
    p0: rotatePoint(curve.p0),
    h0: rotatePoint(curve.h0),
    h1: rotatePoint(curve.h1),
    p1: rotatePoint(curve.p1),
  };
}

/**
 * Get the span (extent) of a 3D curve
 */
export function getCurveSpan3D(curve: Curve3D): number {
  return distance3D(curve.p0, curve.p1);
}

/**
 * Find point along curve from Y coordinate
 * Assumes curve is roughly vertical (leaf-style)
 */
export function findPointFromY(curve: Curve3D, targetY: number): number {
  // Check if the curve is approximately horizontal
  if (
    softEquals(curve.p0.y, curve.p1.y, 0.01) &&
    softEquals(curve.p0.y, curve.h0.y, 0.01) &&
    softEquals(curve.p0.y, curve.h1.y, 0.01)
  ) {
    // Horizontal curve - use X instead
    const range = curve.p1.x - curve.p0.x;
    if (Math.abs(range) < 0.01) return 0.5;
    return (targetY - curve.p0.x) / range; // targetY is actually X in this context
  }

  // Binary search for Y
  let low = 0;
  let high = 1;
  const iterations = 20;

  for (let i = 0; i < iterations; i++) {
    const mid = (low + high) / 2;
    const point = evaluateCurve3D(curve, mid);

    if (point.y < targetY) {
      if (curve.p1.y > curve.p0.y) low = mid;
      else high = mid;
    } else {
      if (curve.p1.y > curve.p0.y) high = mid;
      else low = mid;
    }
  }

  return (low + high) / 2;
}

// =============================================================================
// ARC UTILITIES (for curl distortion)
// =============================================================================

/**
 * Create a Bezier arc approximation
 * Used for leaf curl effect
 */
export function createArc(
  curve: Curve3D,
  degrees: number,
  reverse: boolean,
): Curve3D {
  if (softEquals(degrees, 0)) return copyCurve3D(curve);

  const p0 = { x: curve.p0.x, y: curve.p0.y };
  const p1 = { x: curve.p1.x, y: curve.p1.y };
  const width = p1.x - p0.x;
  const angleRad = (degrees * Math.PI) / 180;
  let radius = width / angleRad;

  let mult = 1;
  if (reverse) {
    radius *= -1;
    mult = -1;
  }

  const center = { x: p0.x, y: p0.y + radius };

  // Calculate arc endpoint
  const v1x =
    center.x +
    radius * Math.cos((3 * Math.PI) / 2 + degrees * mult * (Math.PI / 180));
  const v1y =
    center.y +
    radius * Math.sin((3 * Math.PI) / 2 + degrees * mult * (Math.PI / 180));

  // Calculate Bezier handles for arc approximation
  const ax = p0.x - center.x;
  const ay = p0.y - center.y;
  const bx = v1x - center.x;
  const by = v1y - center.y;

  const q1 = ax * ax + ay * ay;
  const q2 = q1 + ax * bx + ay * by;
  const k2 = ((4 / 3) * (Math.sqrt(2 * q1 * q2) - q2)) / (ax * by - ay * bx);

  const h0x = center.x + ax - k2 * ay;
  const h0y = center.y + ay + k2 * ax;
  const h1x = center.x + bx + k2 * by;
  const h1y = center.y + by - k2 * bx;

  return {
    p0: clone3D(curve.p0),
    h0: { x: h0x, y: h0y, z: curve.h0.z },
    h1: { x: h1x, y: h1y, z: curve.h1.z },
    p1: { x: v1x, y: v1y, z: curve.p1.z },
  };
}
