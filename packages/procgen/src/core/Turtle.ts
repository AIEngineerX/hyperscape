/**
 * 3D Turtle Graphics Implementation
 *
 * A 3D turtle for tree generation, based on the L-System turtle concept.
 * The turtle maintains position, direction, and a "right" vector that together
 * form an orthonormal basis for local coordinate transformations.
 *
 * The turtle moves through 3D space, laying down branch geometry as it goes.
 * Branch curves are created by moving the turtle and recording its positions.
 *
 * Coordinate system:
 * - dir: Forward direction (normalized)
 * - right: Right direction (normalized, perpendicular to dir)
 * - up: Computed as dir × right (normalized)
 */

import * as THREE from "three";
import { radians } from "../math/Vector3.js";

/**
 * 3D Turtle for tree branch generation.
 *
 * The turtle maintains an orthonormal basis (dir, right, up) and a position.
 * Movement commands modify these vectors using quaternion rotations.
 */
export class Turtle {
  /** Current position */
  pos: THREE.Vector3;

  /** Forward direction (normalized) */
  dir: THREE.Vector3;

  /** Right direction (normalized, perpendicular to dir) */
  right: THREE.Vector3;

  /** Current width/radius */
  width: number;

  /**
   * Create a new turtle.
   *
   * @param other - Optional turtle to copy from
   */
  constructor(other?: Turtle) {
    if (other) {
      // Copy constructor
      this.pos = other.pos.clone();
      this.dir = other.dir.clone();
      this.right = other.right.clone();
      this.width = other.width;
    } else {
      // Default: at origin, facing up (+Z), right along +X
      this.pos = new THREE.Vector3(0, 0, 0);
      this.dir = new THREE.Vector3(0, 0, 1);
      this.right = new THREE.Vector3(1, 0, 0);
      this.width = 0;
    }
  }

  /**
   * Get the up vector (perpendicular to both dir and right).
   */
  get up(): THREE.Vector3 {
    return new THREE.Vector3().crossVectors(this.dir, this.right).normalize();
  }

  /**
   * Turn right about the axis perpendicular to the direction.
   * Rotates both dir and right around the up axis.
   *
   * @param angle - Angle in degrees
   */
  turnRight(angle: number): void {
    // Axis is perpendicular to both dir and right (the "up" vector)
    const axis = new THREE.Vector3()
      .crossVectors(this.dir, this.right)
      .normalize();
    const rotQuat = new THREE.Quaternion().setFromAxisAngle(
      axis,
      radians(angle),
    );

    this.dir.applyQuaternion(rotQuat).normalize();
    this.right.applyQuaternion(rotQuat).normalize();
  }

  /**
   * Turn left about the axis perpendicular to the direction.
   *
   * @param angle - Angle in degrees
   */
  turnLeft(angle: number): void {
    this.turnRight(-angle);
  }

  /**
   * Pitch up about the right axis.
   * Rotates dir around the right vector.
   *
   * @param angle - Angle in degrees
   */
  pitchUp(angle: number): void {
    const rotQuat = new THREE.Quaternion().setFromAxisAngle(
      this.right,
      radians(angle),
    );
    this.dir.applyQuaternion(rotQuat).normalize();
  }

  /**
   * Pitch down about the right axis.
   *
   * @param angle - Angle in degrees
   */
  pitchDown(angle: number): void {
    this.pitchUp(-angle);
  }

  /**
   * Roll right about the direction axis.
   * Rotates right around the dir vector.
   *
   * @param angle - Angle in degrees
   */
  rollRight(angle: number): void {
    const rotQuat = new THREE.Quaternion().setFromAxisAngle(
      this.dir,
      radians(angle),
    );
    this.right.applyQuaternion(rotQuat).normalize();
  }

  /**
   * Roll left about the direction axis.
   *
   * @param angle - Angle in degrees
   */
  rollLeft(angle: number): void {
    this.rollRight(-angle);
  }

  /**
   * Move forward in the direction the turtle is facing.
   *
   * @param distance - Distance to move
   */
  move(distance: number): void {
    this.pos.addScaledVector(this.dir, distance);
  }

  /**
   * Set the turtle's width/radius.
   *
   * @param width - New width value
   */
  setWidth(width: number): void {
    this.width = width;
  }

  /**
   * Create a copy of this turtle.
   */
  clone(): Turtle {
    return new Turtle(this);
  }

  /**
   * Set position, direction, and right from another turtle.
   */
  copyFrom(other: Turtle): void {
    this.pos.copy(other.pos);
    this.dir.copy(other.dir);
    this.right.copy(other.right);
    this.width = other.width;
  }

  /**
   * Reset the turtle to default state.
   */
  reset(): void {
    this.pos.set(0, 0, 0);
    this.dir.set(0, 0, 1);
    this.right.set(1, 0, 0);
    this.width = 0;
  }

  /**
   * Apply a rotation quaternion to both direction and right vectors.
   *
   * @param quat - Quaternion to apply
   */
  applyQuaternion(quat: THREE.Quaternion): void {
    this.dir.applyQuaternion(quat).normalize();
    this.right.applyQuaternion(quat).normalize();
  }

  /**
   * Rotate the turtle to face a target direction.
   * Tries to preserve the "up" sense of the right vector.
   *
   * @param targetDir - Direction to face (will be normalized)
   */
  lookAt(targetDir: THREE.Vector3): void {
    const newDir = targetDir.clone().normalize();

    // Calculate the rotation from current dir to target dir
    const quat = new THREE.Quaternion().setFromUnitVectors(this.dir, newDir);

    this.dir.copy(newDir);
    this.right.applyQuaternion(quat).normalize();

    // Ensure orthogonality
    this.right.crossVectors(this.dir, this.up).normalize();
    if (this.right.lengthSq() < 0.001) {
      // dir is parallel to up, choose arbitrary right
      this.right.set(1, 0, 0);
      if (Math.abs(this.dir.x) > 0.9) {
        this.right.set(0, 1, 0);
      }
    }
  }

  /**
   * Get a string representation for debugging.
   */
  toString(): string {
    const p = this.pos;
    const d = this.dir;
    const r = this.right;
    return (
      `Turtle at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}), ` +
      `dir (${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)}), ` +
      `right (${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.z.toFixed(2)})`
    );
  }
}

/**
 * Apply tropism (directional growth influence) to a turtle.
 *
 * Tropism simulates environmental effects like gravity, light, or wind
 * that cause branches to grow in particular directions.
 *
 * @param turtle - Turtle to modify
 * @param tropismVector - Direction and strength of tropism [x, y, z]
 */
export function applyTropism(
  turtle: Turtle,
  tropismVector: THREE.Vector3,
): void {
  // Calculate rotation axis (perpendicular to both dir and tropism)
  const hCrossT = new THREE.Vector3().crossVectors(turtle.dir, tropismVector);

  // Calculate rotation angle (from Algorithmic Beauty of Plants)
  // The magnitude of the cross product determines how much effect tropism has
  const alpha = 10 * hCrossT.length();

  if (alpha < 0.0001) {
    return; // No rotation needed
  }

  hCrossT.normalize();

  // Apply rotation
  const rotQuat = new THREE.Quaternion().setFromAxisAngle(
    hCrossT,
    radians(alpha),
  );
  turtle.dir.applyQuaternion(rotQuat).normalize();
  turtle.right.applyQuaternion(rotQuat).normalize();
}

/**
 * Create a turtle positioned on the circumference of a branch.
 *
 * Used for positioning child branches - they should emerge from the
 * surface of the parent branch, not its center.
 *
 * @param dirTurtle - Turtle with the branch direction
 * @param radius - Radius of the parent branch
 * @returns New turtle positioned on the branch surface
 */
export function makeBranchPosTurtle(dirTurtle: Turtle, radius: number): Turtle {
  const posTurtle = new Turtle(dirTurtle);
  posTurtle.pitchDown(90);
  posTurtle.move(radius);
  return posTurtle;
}

/**
 * Create a turtle for a new branch direction.
 *
 * Sets up the turtle's direction based on the tangent to the parent
 * branch's Bezier curve at the branch point.
 *
 * @param parentTurtle - Parent branch turtle
 * @param tangent - Tangent direction at branch point (normalized)
 * @param isHelix - Whether parent branch is a helix
 * @returns New turtle with branch direction set
 */
export function makeBranchDirTurtle(
  parentTurtle: Turtle,
  tangent: THREE.Vector3,
  isHelix: boolean,
): Turtle {
  const branchTurtle = new Turtle();
  branchTurtle.dir.copy(tangent).normalize();

  if (isHelix) {
    // For helix branches, approximate the normal
    // by taking tangent at slightly different point
    const tangentD = tangent.clone().normalize();
    branchTurtle.right.crossVectors(branchTurtle.dir, tangentD);
  } else {
    // For normal curves, the right vector should be in the plane
    // of the parent's direction
    const parentUp = new THREE.Vector3().crossVectors(
      parentTurtle.dir,
      parentTurtle.right,
    );
    branchTurtle.right.crossVectors(parentUp, branchTurtle.dir);
  }

  // Ensure right is normalized and valid
  if (branchTurtle.right.lengthSq() < 0.001) {
    // Fallback if vectors are parallel
    branchTurtle.right.set(1, 0, 0);
    if (Math.abs(branchTurtle.dir.x) > 0.9) {
      branchTurtle.right.set(0, 1, 0);
    }
    branchTurtle.right.crossVectors(branchTurtle.right, branchTurtle.dir);
  }
  branchTurtle.right.normalize();

  return branchTurtle;
}
