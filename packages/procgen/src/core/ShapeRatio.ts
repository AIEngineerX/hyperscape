/**
 * Shape Ratio Functions
 *
 * These functions control the overall tree silhouette by modifying
 * branch lengths based on their height on the tree.
 *
 * Based on the Weber & Penn paper "Creation and Rendering of Realistic Trees".
 */

import { TreeShape, type TreeShapeType, type TreeParams } from "../types.js";

/**
 * Calculate the shape ratio for a given tree shape and position.
 *
 * The shape ratio determines how branch length varies with height:
 * - ratio = 0: bottom of tree
 * - ratio = 1: top of tree
 *
 * @param shape - Tree shape type (0-8)
 * @param ratio - Position along tree height (0-1)
 * @param params - Optional parameters for envelope shape
 * @returns Shape factor (multiplier for branch length)
 */
export function shapeRatio(
  shape: TreeShapeType,
  ratio: number,
  params?: TreeParams,
): number {
  switch (shape) {
    case TreeShape.Conical:
      // Conical: branches longest at bottom, shortest at top
      return 0.2 + 0.8 * ratio;

    case TreeShape.Spherical:
      // Spherical: branches longest in middle
      return 0.2 + 0.8 * Math.sin(Math.PI * ratio);

    case TreeShape.Hemispherical:
      // Hemispherical: half-sphere shape
      return 0.2 + 0.8 * Math.sin(0.5 * Math.PI * ratio);

    case TreeShape.Cylindrical:
      // Cylindrical: uniform branch length
      return 1.0;

    case TreeShape.TaperedCylindrical:
      // Tapered cylindrical: slight decrease toward top
      return 0.5 + 0.5 * ratio;

    case TreeShape.Flame:
      // Flame: branches longest near 70% height
      if (ratio <= 0.7) {
        return ratio / 0.7;
      } else {
        return (1.0 - ratio) / 0.3;
      }

    case TreeShape.InverseConical:
      // Inverse conical: branches longest at top
      return 1.0 - 0.8 * ratio;

    case TreeShape.TendFlame:
      // Tend flame: modified flame shape
      if (ratio <= 0.7) {
        return 0.5 + (0.5 * ratio) / 0.7;
      } else {
        return 0.5 + (0.5 * (1.0 - ratio)) / 0.3;
      }

    case TreeShape.Envelope:
      // Envelope/Custom: uses pruning parameters directly
      return envelopeShapeRatio(ratio, params);

    default:
      // Default to conical
      return 0.2 + 0.8 * ratio;
  }
}

/**
 * Calculate shape ratio using the pruning envelope.
 *
 * The envelope shape is defined by:
 * - pruneWidthPeak: height fraction where maximum width occurs
 * - prunePowerLow: curvature of lower section (<1 = convex, >1 = concave)
 * - prunePowerHigh: curvature of upper section (<1 = convex, >1 = concave)
 *
 * @param ratio - Position along tree height (0-1)
 * @param params - Tree parameters (must include pruning params)
 * @returns Shape factor
 */
function envelopeShapeRatio(ratio: number, params?: TreeParams): number {
  if (!params) {
    // No params, fall back to conical
    return 0.2 + 0.8 * ratio;
  }

  // Validate ratio
  if (ratio < 0 || ratio > 1) {
    return 0.0;
  }

  const { pruneWidthPeak, prunePowerLow, prunePowerHigh } = params;

  if (ratio < 1 - pruneWidthPeak) {
    // Lower section
    return Math.pow(ratio / (1 - pruneWidthPeak), prunePowerHigh);
  } else {
    // Upper section
    return Math.pow((1 - ratio) / (1 - pruneWidthPeak), prunePowerLow);
  }
}

/**
 * Check if a point is inside the pruning envelope.
 *
 * Used for testing whether a branch endpoint should be pruned.
 * The envelope is a radial distance from the tree axis that varies with height.
 *
 * @param point - Point to test [x, y, z] where z is height
 * @param treeScale - Overall tree scale
 * @param baseSize - Base size fraction (portion of trunk with no branches)
 * @param pruneWidth - Width of pruning envelope (fraction of height)
 * @param params - Full tree parameters for envelope shape
 * @returns True if point is inside the envelope
 */
export function pointInsideEnvelope(
  point: { x: number; y: number; z: number },
  treeScale: number,
  baseSize: number,
  pruneWidth: number,
  params: TreeParams,
): boolean {
  // Calculate horizontal distance from tree axis
  const dist = Math.sqrt(point.x * point.x + point.y * point.y);

  // Calculate ratio (height position normalized by non-base portion)
  const ratio = (treeScale - point.z) / (treeScale * (1 - baseSize));

  // Calculate envelope radius at this height
  const envelopeRadius =
    treeScale * pruneWidth * shapeRatio(TreeShape.Envelope, ratio, params);

  // Point is inside if distance from axis is less than envelope radius
  return dist / treeScale < envelopeRadius / treeScale;
}

/**
 * Calculate the effective branch length modifier based on shape.
 *
 * This combines the shape ratio with additional factors for
 * a specific branch position.
 *
 * @param shape - Tree shape type
 * @param stemOffset - Position along parent stem where branch emerges
 * @param parentLength - Length of parent stem
 * @param baseLength - Base length (portion with no branches)
 * @param params - Tree parameters
 * @returns Length modifier (0-1)
 */
export function calcBranchLengthModifier(
  shape: TreeShapeType,
  stemOffset: number,
  parentLength: number,
  baseLength: number,
  params?: TreeParams,
): number {
  // Calculate how far along the "branchable" portion this branch is
  const effectiveLength = parentLength - baseLength;
  if (effectiveLength <= 0) {
    return 0;
  }

  const ratio = (parentLength - stemOffset) / effectiveLength;
  return shapeRatio(shape, ratio, params);
}
