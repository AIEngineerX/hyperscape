/**
 * Bezier Curve Utilities
 *
 * Functions for evaluating cubic Bezier curves, used for branch geometry.
 * The tree generation algorithm represents branches as Bezier splines,
 * which are then tessellated into mesh geometry.
 *
 * Optimized versions with "Into" suffix write to existing Vector3 to avoid allocations.
 */

import * as THREE from "three";
import { _scratch } from "./Pool.js";

/**
 * A point on a Bezier spline with handles for curve control.
 */
export type BezierSplinePoint = {
  /** Position of the control point */
  co: THREE.Vector3;
  /** Left handle position (incoming tangent control) */
  handleLeft: THREE.Vector3;
  /** Right handle position (outgoing tangent control) */
  handleRight: THREE.Vector3;
};

/**
 * Evaluate a cubic Bezier curve at a given parameter.
 *
 * The curve is defined by two control points with handles.
 * At offset=0, returns the start point position.
 * At offset=1, returns the end point position.
 *
 * @param offset - Parameter value in [0, 1]
 * @param startPoint - Start control point with handles
 * @param endPoint - End control point with handles
 * @returns Position on the curve at the given offset
 */
export function calcPointOnBezier(
  offset: number,
  startPoint: BezierSplinePoint,
  endPoint: BezierSplinePoint,
): THREE.Vector3 {
  if (offset < 0 || offset > 1) {
    throw new Error(
      `Bezier offset out of range: ${offset} not between 0 and 1`,
    );
  }

  const t = offset;
  const oneMinusT = 1 - t;

  // Cubic Bezier formula:
  // B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
  // Where P0 = start.co, P1 = start.handleRight, P2 = end.handleLeft, P3 = end.co

  const p0 = startPoint.co;
  const p1 = startPoint.handleRight;
  const p2 = endPoint.handleLeft;
  const p3 = endPoint.co;

  const c0 = oneMinusT * oneMinusT * oneMinusT;
  const c1 = 3 * oneMinusT * oneMinusT * t;
  const c2 = 3 * oneMinusT * t * t;
  const c3 = t * t * t;

  return new THREE.Vector3(
    c0 * p0.x + c1 * p1.x + c2 * p2.x + c3 * p3.x,
    c0 * p0.y + c1 * p1.y + c2 * p2.y + c3 * p3.y,
    c0 * p0.z + c1 * p1.z + c2 * p2.z + c3 * p3.z,
  );
}

/**
 * Calculate the tangent to a cubic Bezier curve at a given parameter.
 *
 * The tangent is the first derivative of the Bezier curve, giving
 * the direction of the curve at that point.
 *
 * @param offset - Parameter value in [0, 1]
 * @param startPoint - Start control point with handles
 * @param endPoint - End control point with handles
 * @returns Tangent vector at the given offset (not normalized)
 */
export function calcTangentToBezier(
  offset: number,
  startPoint: BezierSplinePoint,
  endPoint: BezierSplinePoint,
): THREE.Vector3 {
  if (offset < 0 || offset > 1) {
    throw new Error(
      `Bezier offset out of range: ${offset} not between 0 and 1`,
    );
  }

  const t = offset;
  const oneMinusT = 1 - t;

  // First derivative of cubic Bezier:
  // B'(t) = 3(1-t)²(P1-P0) + 6(1-t)t(P2-P1) + 3t²(P3-P2)

  const p0 = startPoint.co;
  const p1 = startPoint.handleRight;
  const p2 = endPoint.handleLeft;
  const p3 = endPoint.co;

  const c0 = 3 * oneMinusT * oneMinusT;
  const c1 = 6 * oneMinusT * t;
  const c2 = 3 * t * t;

  // P1 - P0
  const d0x = p1.x - p0.x;
  const d0y = p1.y - p0.y;
  const d0z = p1.z - p0.z;

  // P2 - P1
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d1z = p2.z - p1.z;

  // P3 - P2
  const d2x = p3.x - p2.x;
  const d2y = p3.y - p2.y;
  const d2z = p3.z - p2.z;

  return new THREE.Vector3(
    c0 * d0x + c1 * d1x + c2 * d2x,
    c0 * d0y + c1 * d1y + c2 * d2y,
    c0 * d0z + c1 * d1z + c2 * d2z,
  );
}

/**
 * Optimized: Calculate point on Bezier curve, writing to existing Vector3.
 * Avoids allocation - use in hot loops.
 */
export function calcPointOnBezierInto(
  offset: number,
  startPoint: BezierSplinePoint,
  endPoint: BezierSplinePoint,
  out: THREE.Vector3,
): THREE.Vector3 {
  const t = offset;
  const oneMinusT = 1 - t;

  const p0 = startPoint.co;
  const p1 = startPoint.handleRight;
  const p2 = endPoint.handleLeft;
  const p3 = endPoint.co;

  const c0 = oneMinusT * oneMinusT * oneMinusT;
  const c1 = 3 * oneMinusT * oneMinusT * t;
  const c2 = 3 * oneMinusT * t * t;
  const c3 = t * t * t;

  out.x = c0 * p0.x + c1 * p1.x + c2 * p2.x + c3 * p3.x;
  out.y = c0 * p0.y + c1 * p1.y + c2 * p2.y + c3 * p3.y;
  out.z = c0 * p0.z + c1 * p1.z + c2 * p2.z + c3 * p3.z;

  return out;
}

/**
 * Optimized: Calculate tangent to Bezier curve, writing to existing Vector3.
 * Avoids allocation - use in hot loops.
 */
export function calcTangentToBezierInto(
  offset: number,
  startPoint: BezierSplinePoint,
  endPoint: BezierSplinePoint,
  out: THREE.Vector3,
): THREE.Vector3 {
  const t = offset;
  const oneMinusT = 1 - t;

  const p0 = startPoint.co;
  const p1 = startPoint.handleRight;
  const p2 = endPoint.handleLeft;
  const p3 = endPoint.co;

  const c0 = 3 * oneMinusT * oneMinusT;
  const c1 = 6 * oneMinusT * t;
  const c2 = 3 * t * t;

  const d0x = p1.x - p0.x;
  const d0y = p1.y - p0.y;
  const d0z = p1.z - p0.z;

  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d1z = p2.z - p1.z;

  const d2x = p3.x - p2.x;
  const d2y = p3.y - p2.y;
  const d2z = p3.z - p2.z;

  out.x = c0 * d0x + c1 * d1x + c2 * d2x;
  out.y = c0 * d0y + c1 * d1y + c2 * d2y;
  out.z = c0 * d0z + c1 * d1z + c2 * d2z;

  return out;
}

/**
 * Create a BezierSplinePoint with position and symmetric handles.
 *
 * @param position - Position of the control point
 * @param tangent - Direction for handles (will be normalized and scaled)
 * @param handleLength - Distance from position to each handle
 * @returns New BezierSplinePoint
 */
export function createBezierPoint(
  position: THREE.Vector3,
  tangent: THREE.Vector3,
  handleLength: number,
): BezierSplinePoint {
  const normalizedTangent = tangent.clone().normalize();
  return {
    co: position.clone(),
    handleLeft: position
      .clone()
      .sub(normalizedTangent.clone().multiplyScalar(handleLength)),
    handleRight: position
      .clone()
      .add(normalizedTangent.clone().multiplyScalar(handleLength)),
  };
}

/**
 * Evaluate a full Bezier spline (multiple segments) at a given parameter.
 *
 * @param points - Array of control points defining the spline
 * @param t - Global parameter in [0, 1] across entire spline
 * @returns Position on the spline
 */
export function evaluateBezierSpline(
  points: BezierSplinePoint[],
  t: number,
): THREE.Vector3 {
  if (points.length < 2) {
    throw new Error("Bezier spline requires at least 2 points");
  }

  // Clamp t to [0, 1]
  t = Math.max(0, Math.min(1, t));

  const numSegments = points.length - 1;
  const scaledT = t * numSegments;
  const segmentIndex = Math.min(Math.floor(scaledT), numSegments - 1);
  const localT = scaledT - segmentIndex;

  return calcPointOnBezier(
    localT,
    points[segmentIndex]!,
    points[segmentIndex + 1]!,
  );
}

/**
 * Get the arc length of a Bezier segment using numerical integration.
 *
 * @param startPoint - Start control point
 * @param endPoint - End control point
 * @param samples - Number of samples for integration (higher = more accurate)
 * @returns Approximate arc length
 */
export function bezierArcLength(
  startPoint: BezierSplinePoint,
  endPoint: BezierSplinePoint,
  samples = 32,
): number {
  let length = 0;
  let prevPoint = startPoint.co;

  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const point = calcPointOnBezier(t, startPoint, endPoint);
    length += point.distanceTo(prevPoint);
    prevPoint = point;
  }

  return length;
}

/**
 * Sample a Bezier curve at regular arc-length intervals.
 *
 * @param startPoint - Start control point
 * @param endPoint - End control point
 * @param numSamples - Number of samples (evenly spaced by arc length)
 * @returns Array of positions along the curve
 */
export function sampleBezierByArcLength(
  startPoint: BezierSplinePoint,
  endPoint: BezierSplinePoint,
  numSamples: number,
): THREE.Vector3[] {
  if (numSamples < 2) {
    return [startPoint.co.clone()];
  }

  // First, build a lookup table of arc length to parameter
  const lookupSamples = 256;
  const arcLengthTable: { t: number; length: number }[] = [];
  let totalLength = 0;
  let prevPoint = startPoint.co;

  arcLengthTable.push({ t: 0, length: 0 });

  for (let i = 1; i <= lookupSamples; i++) {
    const t = i / lookupSamples;
    const point = calcPointOnBezier(t, startPoint, endPoint);
    totalLength += point.distanceTo(prevPoint);
    arcLengthTable.push({ t, length: totalLength });
    prevPoint = point;
  }

  // Now sample at even arc length intervals
  const result: THREE.Vector3[] = [];

  for (let i = 0; i < numSamples; i++) {
    const targetLength = (i / (numSamples - 1)) * totalLength;

    // Binary search for the parameter
    let lo = 0;
    let hi = arcLengthTable.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >>> 1;
      if (arcLengthTable[mid]!.length < targetLength) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    // Interpolate between lo and hi
    const loEntry = arcLengthTable[lo]!;
    const hiEntry = arcLengthTable[hi]!;
    const segmentLength = hiEntry.length - loEntry.length;
    const fraction =
      segmentLength > 0 ? (targetLength - loEntry.length) / segmentLength : 0;
    const t = loEntry.t + (hiEntry.t - loEntry.t) * fraction;

    result.push(calcPointOnBezier(t, startPoint, endPoint));
  }

  return result;
}
