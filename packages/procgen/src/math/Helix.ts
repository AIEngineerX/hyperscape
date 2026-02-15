/**
 * Helix Calculation Utilities
 *
 * Used for generating helix-shaped branches (when curve_v is negative).
 * This creates spiral/helical branch patterns as seen in some tree species.
 */

import * as THREE from "three";
import type { SeededRandom } from "./Random.js";
import { randInRange } from "./Random.js";

/**
 * Result of helix point calculation.
 * Contains the Bezier control points needed to render a helix segment.
 */
export type HelixPoints = {
  /** Offset from start to first handle (P1 - P0) */
  p0: THREE.Vector3;
  /** Offset from start to second handle (P2 - P0) */
  p1: THREE.Vector3;
  /** Offset from start to end point (P3 - P0) */
  p2: THREE.Vector3;
  /** Axis of the helix (direction of progression) */
  axis: THREE.Vector3;
};

/**
 * Calculate control points for a helix Bezier curve.
 *
 * This produces a half-turn of a helix, suitable for use as a branch segment.
 * The helix is aligned to the turtle's direction and randomly rotated around it.
 *
 * @param turtleDir - Current turtle direction (helix axis)
 * @param radius - Radius of the helix
 * @param pitch - Vertical distance per half-turn
 * @param rng - Random number generator for spin angle
 * @returns Helix control points
 */
export function calcHelixPoints(
  turtleDir: THREE.Vector3,
  radius: number,
  pitch: number,
  rng: SeededRandom,
): HelixPoints {
  // For a 90-degree helix segment (quarter turn), simplified formulas:
  // The original Python code uses inc_angle = 90 degrees
  const points: THREE.Vector3[] = [
    new THREE.Vector3(0, -radius, -pitch / 4),
    new THREE.Vector3((4 * radius) / 3, -radius, 0),
    new THREE.Vector3((4 * radius) / 3, radius, 0),
    new THREE.Vector3(0, radius, pitch / 4),
  ];

  // Create transformation to align helix with turtle direction
  // The helix progresses along the Z axis in local space
  const trf = createTrackQuaternion(turtleDir);

  // Random spin around the axis
  const spinAngle = randInRange(rng, 0, 2 * Math.PI);
  const rotQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    spinAngle,
  );

  // Apply rotations to all points
  for (const p of points) {
    p.applyQuaternion(rotQuat);
    p.applyQuaternion(trf);
  }

  // Return relative offsets from the first point
  return {
    p0: points[1]!.clone().sub(points[0]!),
    p1: points[2]!.clone().sub(points[0]!),
    p2: points[3]!.clone().sub(points[0]!),
    axis: turtleDir.clone(),
  };
}

/**
 * Create a quaternion that rotates the Z axis to align with a target direction.
 * This is similar to Blender's to_track_quat('Z', 'Y').
 *
 * @param direction - Target direction
 * @returns Quaternion for alignment
 */
function createTrackQuaternion(direction: THREE.Vector3): THREE.Quaternion {
  const forward = direction.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);

  // Handle case where forward is parallel to up
  if (Math.abs(forward.dot(up)) > 0.99) {
    up.set(1, 0, 0);
  }

  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  const actualUp = new THREE.Vector3().crossVectors(forward, right).normalize();

  const matrix = new THREE.Matrix4();
  matrix.makeBasis(right, actualUp, forward);

  const quat = new THREE.Quaternion();
  quat.setFromRotationMatrix(matrix);
  return quat;
}

/**
 * Calculate the helix pitch from the stem parameters.
 *
 * @param stemLength - Total length of the stem
 * @param curveRes - Number of curve segments
 * @param rng - Random number generator
 * @returns Helix pitch value
 */
export function calcHelixPitch(
  stemLength: number,
  curveRes: number,
  rng: SeededRandom,
): number {
  return ((2 * stemLength) / curveRes) * randInRange(rng, 0.8, 1.2);
}

/**
 * Calculate the helix radius from the pitch and curve angle.
 *
 * @param pitch - Helix pitch
 * @param curveV - Curve variation parameter (negative for helix)
 * @param rng - Random number generator
 * @returns Helix radius
 */
export function calcHelixRadius(
  pitch: number,
  curveV: number,
  rng: SeededRandom,
): number {
  const tanAngle = Math.tan(((90 - Math.abs(curveV)) * Math.PI) / 180);
  return ((3 * pitch) / (16 * tanAngle)) * randInRange(rng, 0.8, 1.2);
}
