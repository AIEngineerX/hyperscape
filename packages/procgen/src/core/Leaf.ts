/**
 * Leaf Class
 *
 * Represents a single leaf or blossom attached to a branch.
 * Stores position, direction, and orientation data needed for
 * generating leaf geometry.
 */

import * as THREE from "three";
import type { LeafData } from "../types.js";

/**
 * A leaf or blossom in the tree.
 */
export class Leaf {
  /** Position in world space */
  position: THREE.Vector3;

  /** Direction the leaf faces (normal) */
  direction: THREE.Vector3;

  /** Right vector for orientation */
  right: THREE.Vector3;

  /** Whether this is a blossom instead of a leaf */
  isBlossom: boolean;

  /**
   * Create a new leaf.
   *
   * @param position - Position in world space
   * @param direction - Direction the leaf faces
   * @param right - Right vector for orientation
   * @param isBlossom - Whether this is a blossom
   */
  constructor(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    right: THREE.Vector3,
    isBlossom = false,
  ) {
    this.position = position.clone();
    this.direction = direction.clone().normalize();
    this.right = right.clone().normalize();
    this.isBlossom = isBlossom;
  }

  /**
   * Calculate the bend transformation for leaves.
   *
   * Leaves bend outward and upward based on their position relative
   * to the tree center and the bend parameter.
   *
   * @param bend - Bend amount (0-1)
   * @returns Two quaternions for the bend transformation
   */
  calcBendTransform(bend: number): {
    bendTrf1: THREE.Quaternion;
    bendTrf2: THREE.Quaternion;
  } {
    // Calculate the normal to the leaf (perpendicular to direction and right)
    const normal = new THREE.Vector3().crossVectors(this.direction, this.right);

    // Calculate angle from leaf position
    const thetaPos = Math.atan2(this.position.y, this.position.x);
    const thetaBend = thetaPos - Math.atan2(normal.y, normal.x);

    // First bend rotation around Z axis
    const bendTrf1 = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      thetaBend * bend,
    );

    // Apply first rotation to direction and right
    const newDir = this.direction.clone().applyQuaternion(bendTrf1);
    const newRight = this.right.clone().applyQuaternion(bendTrf1);
    const newNormal = new THREE.Vector3().crossVectors(newDir, newRight);

    // Calculate declination of new normal
    const phiBend = Math.atan2(
      Math.sqrt(newNormal.x * newNormal.x + newNormal.y * newNormal.y),
      newNormal.z,
    );

    // Adjust if angle is greater than 90 degrees
    const adjustedPhi = phiBend > Math.PI / 2 ? phiBend - Math.PI : phiBend;

    // Second bend rotation around the right axis
    const bendTrf2 = new THREE.Quaternion().setFromAxisAngle(
      newRight,
      adjustedPhi * bend,
    );

    return { bendTrf1, bendTrf2 };
  }

  /**
   * Get the transformation matrix for this leaf.
   *
   * @param scale - Leaf scale
   * @param scaleX - Leaf width scale
   * @param bend - Bend amount
   * @returns Transformation matrix
   */
  getTransformMatrix(
    scale: number,
    scaleX: number,
    bend: number,
  ): THREE.Matrix4 {
    // Create rotation to align Z axis with direction
    const trackQuat = new THREE.Quaternion();

    // Build rotation matrix from direction and right
    const forward = this.direction.clone().normalize();
    const actualRight = this.right.clone().normalize();
    const actualUp = new THREE.Vector3()
      .crossVectors(forward, actualRight)
      .normalize();

    const rotMatrix = new THREE.Matrix4();
    rotMatrix.makeBasis(actualRight, actualUp, forward);
    trackQuat.setFromRotationMatrix(rotMatrix);

    // Calculate spin angle to align right vector
    const rightTransformed = this.right
      .clone()
      .applyQuaternion(trackQuat.clone().invert());
    const spinAngle =
      Math.PI - rightTransformed.angleTo(new THREE.Vector3(1, 0, 0));
    const spinQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      spinAngle,
    );

    // Combine rotations
    let finalQuat = spinQuat.multiply(trackQuat);

    // Apply bend if needed
    if (bend > 0) {
      const { bendTrf1 } = this.calcBendTransform(bend);
      finalQuat = bendTrf1.multiply(finalQuat);
    }

    // Build final transform matrix
    const matrix = new THREE.Matrix4();
    matrix.compose(
      this.position,
      finalQuat,
      new THREE.Vector3(scale * scaleX, scale, scale),
    );

    return matrix;
  }

  /**
   * Convert to serializable data format.
   */
  toData(): LeafData {
    return {
      position: this.position.clone(),
      direction: this.direction.clone(),
      right: this.right.clone(),
      isBlossom: this.isBlossom,
    };
  }

  /**
   * Create from data format.
   */
  static fromData(data: LeafData): Leaf {
    return new Leaf(data.position, data.direction, data.right, data.isBlossom);
  }
}
