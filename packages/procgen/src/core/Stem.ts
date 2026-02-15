/**
 * Stem Class
 *
 * Represents a single stem (trunk or branch) in the tree.
 * Stores the Bezier curve points, radius, and relationships to parent/children.
 *
 * During tree generation, stems are created recursively as the turtle
 * traverses the tree structure. Each stem maintains its curve data
 * which is later converted to mesh geometry.
 */

import * as THREE from "three";
import type { BezierSplinePoint } from "../math/Bezier.js";
import type { StemData, StemPoint } from "../types.js";

/**
 * A stem (branch or trunk) in the tree.
 *
 * Contains the Bezier curve definition and metadata needed for
 * geometry generation and child branch placement.
 */
export class Stem {
  /** Branching depth (0 = trunk) */
  depth: number;

  /** Bezier curve control points */
  curvePoints: BezierSplinePoint[];

  /** Parent stem (null for trunk) */
  parent: Stem | null;

  /** Position along parent where this stem originates (0-1) */
  offset: number;

  /** Maximum radius allowed (constrained by parent) */
  radiusLimit: number;

  /** Child stems */
  children: Stem[];

  /** Total length of this stem */
  length: number;

  /** Base radius of this stem */
  radius: number;

  /** Maximum child branch length (calculated once) */
  lengthChildMax: number;

  /** Index in the tree's stem array (set during finalization) */
  index: number;

  /**
   * Create a new stem.
   *
   * @param depth - Branching depth (0 = trunk)
   * @param parent - Parent stem (null for trunk)
   * @param offset - Position along parent (0-1)
   * @param radiusLimit - Maximum radius allowed
   */
  constructor(
    depth: number,
    parent: Stem | null = null,
    offset = 0,
    radiusLimit = -1,
  ) {
    this.depth = depth;
    this.curvePoints = [];
    this.parent = parent;
    this.offset = offset;
    this.radiusLimit = radiusLimit;
    this.children = [];
    this.length = 0;
    this.radius = 0;
    this.lengthChildMax = 0;
    this.index = -1;
  }

  /**
   * Add a new point to the Bezier curve.
   *
   * @param position - Point position
   * @param handleLeft - Left handle position
   * @param handleRight - Right handle position
   * @param radius - Stem radius at this point
   */
  addPoint(
    position: THREE.Vector3,
    handleLeft: THREE.Vector3,
    handleRight: THREE.Vector3,
    _radius: number,
  ): void {
    this.curvePoints.push({
      co: position.clone(),
      handleLeft: handleLeft.clone(),
      handleRight: handleRight.clone(),
    });
    // Note: radius is tracked separately in stemRadii Map, not in the BezierSplinePoint
  }

  /**
   * Get the last point on the curve.
   */
  getLastPoint(): BezierSplinePoint | null {
    if (this.curvePoints.length === 0) {
      return null;
    }
    return this.curvePoints[this.curvePoints.length - 1]!;
  }

  /**
   * Get the second-to-last point on the curve.
   */
  getSecondLastPoint(): BezierSplinePoint | null {
    if (this.curvePoints.length < 2) {
      return null;
    }
    return this.curvePoints[this.curvePoints.length - 2]!;
  }

  /**
   * Get the number of points in the curve.
   */
  get pointCount(): number {
    return this.curvePoints.length;
  }

  /**
   * Add a child stem.
   */
  addChild(child: Stem): void {
    this.children.push(child);
  }

  /**
   * Create a shallow copy of this stem (same parent reference).
   * Used for clone branches (splits).
   */
  copy(): Stem {
    const newStem = new Stem(
      this.depth,
      this.parent,
      this.offset,
      this.radiusLimit,
    );
    newStem.length = this.length;
    newStem.radius = this.radius;
    newStem.lengthChildMax = this.lengthChildMax;
    return newStem;
  }

  /**
   * Convert to serializable data format.
   *
   * @param radiusArray - Array of radii at each point
   * @returns StemData for serialization
   */
  toData(radiusArray: number[]): StemData {
    if (radiusArray.length < this.curvePoints.length) {
      throw new Error(
        `[Stem.toData] radiusArray length (${radiusArray.length}) must match curvePoints length (${this.curvePoints.length})`,
      );
    }
    const points: StemPoint[] = this.curvePoints.map((cp, i) => ({
      position: cp.co.clone(),
      handleLeft: cp.handleLeft.clone(),
      handleRight: cp.handleRight.clone(),
      radius: radiusArray[i],
    }));

    return {
      depth: this.depth,
      points,
      parentIndex: this.parent?.index ?? null,
      offset: this.offset,
      radiusLimit: this.radiusLimit,
      childIndices: this.children.map((c) => c.index),
      length: this.length,
      radius: this.radius,
      lengthChildMax: this.lengthChildMax,
    };
  }
}

/**
 * Extended stem point with radius information.
 * Used during generation when we need to track radius at each point.
 */
export type StemPointWithRadius = {
  /** Bezier point */
  point: BezierSplinePoint;
  /** Radius at this point */
  radius: number;
};

/**
 * Create a stem point with radius.
 */
export function createStemPoint(
  position: THREE.Vector3,
  direction: THREE.Vector3,
  handleLength: number,
  radius: number,
): StemPointWithRadius {
  return {
    point: {
      co: position.clone(),
      handleLeft: position
        .clone()
        .sub(direction.clone().multiplyScalar(handleLength)),
      handleRight: position
        .clone()
        .add(direction.clone().multiplyScalar(handleLength)),
    },
    radius,
  };
}

/**
 * Scale down Bezier handles for flared sections.
 * This adjusts handle lengths when point density increases (for trunk flare).
 *
 * @param stem - Stem to modify
 * @param maxPointsPerSeg - Maximum points per segment
 */
export function scaleBezierHandlesForFlare(
  stem: Stem,
  maxPointsPerSeg: number,
): void {
  for (const point of stem.curvePoints) {
    // Scale handles toward the control point
    const handleLeftOffset = point.handleLeft.clone().sub(point.co);
    const handleRightOffset = point.handleRight.clone().sub(point.co);

    handleLeftOffset.divideScalar(maxPointsPerSeg);
    handleRightOffset.divideScalar(maxPointsPerSeg);

    point.handleLeft.copy(point.co).add(handleLeftOffset);
    point.handleRight.copy(point.co).add(handleRightOffset);
  }
}
