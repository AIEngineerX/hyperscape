/**
 * LeafVeins - Procedural vein network generation
 *
 * Generates the complete vein network for a leaf including:
 * - Midrib (central vein)
 * - Secondary veins (from midrib to margin)
 * - Lobe veins (in lobed leaves)
 * - Margin-spanning veins
 * - Split veins
 *
 * Based on the Unity Procedural-Plant-and-Foliage-Generator.
 */

import type {
  Point3D,
  LeafCurve,
  LeafVein,
  LeafVeinGroup,
  LeafVeinsData,
  LeafVeinCalcs,
  LeafParamDict,
  LeafShapeData,
} from "../types.js";
import { LeafVeinType, LPK } from "../types.js";
import {
  evaluateCurve2D,
  evaluateCurve3D,
  getCurveTangent2D,
  getCurveLength3D,
  findClosestPointOnCurve2D,
} from "../math/Bezier.js";
import {
  to3D,
  add3D,
  sub3D,
  mul3D,
  lerp3D,
  normalize3D,
  length3D,
  clone3D,
} from "../math/Vector.js";
import { PI } from "../math/Polar.js";
import { SeededRandom, genTypedSeed } from "../math/Random.js";
import { leafCurveToCurve2D } from "../shape/LeafCurve.js";
import { getParamValue } from "../params/LeafParamDefaults.js";

// =============================================================================
// VEIN CALCULATION DATA
// =============================================================================

/**
 * Calculate key points on the leaf for vein generation
 */
function calculateVeinCalcs(
  shape: LeafShapeData,
  _params: LeafParamDict,
): LeafVeinCalcs {
  const curves = shape.curves;

  // Find the tip (top of leaf)
  let tipY = -Infinity;
  let tip: Point3D = { x: 0, y: 0, z: 0 };

  for (const curve of curves) {
    if (curve.p1.y > tipY) {
      tipY = curve.p1.y;
      tip = to3D(curve.p1);
    }
    if (curve.p0.y > tipY) {
      tipY = curve.p0.y;
      tip = to3D(curve.p0);
    }
  }

  // Origin is at 0,0
  const origin: Point3D = { x: 0, y: 0, z: 0 };

  // Apex is the highest point on the margin
  const apexPos = 0.5; // Default position
  const apex = lerp3D(origin, tip, apexPos);

  return { origin, tip, apex, apexPos };
}

// =============================================================================
// MIDRIB GENERATION
// =============================================================================

/**
 * Generate the midrib (central vein)
 */
function generateMidrib(calcs: LeafVeinCalcs, params: LeafParamDict): LeafVein {
  const { origin, tip } = calcs;

  const thickness = getParamValue(params, LPK.MidribThickness);
  const taper = getParamValue(params, LPK.MidribTaper);

  // Create midrib as straight line from origin to tip
  // Slightly recessed (z < 0) to create depth
  const midrib: LeafVein = {
    p0: { ...origin, z: -0.02 },
    h0: lerp3D(origin, tip, 0.33),
    h1: lerp3D(origin, tip, 0.66),
    p1: { ...tip, z: -0.02 },
    type: LeafVeinType.Midrib,
    lefty: false,
    thickness,
    taper,
    taperRNG: 0,
    startThickness: thickness,
    endThickness: thickness * (1 - taper * 0.5),
    pointAlongMargin: 0,
    posAlongMidrib: 0,
  };

  return midrib;
}

// =============================================================================
// SECONDARY VEIN GENERATION
// =============================================================================

/**
 * Calculate gravity-influenced curve points for natural vein flow
 */
function getGravityCurvePoints(
  start: Point3D,
  end: Point3D,
  gravityBias: number,
  random: SeededRandom,
): { h0: Point3D; h1: Point3D } {
  const dir = sub3D(end, start);
  const len = length3D(dir);

  // Apply gravity (downward Y bias)
  const gravityOffset = gravityBias * len * 0.3;
  const randomOffset = random.rangeAdd(0.1) * len;

  // Handle 0: slightly outward from start
  const h0: Point3D = {
    x: start.x + dir.x * 0.33 + randomOffset * 0.5,
    y: start.y + dir.y * 0.33 - gravityOffset * 0.5,
    z: start.z + dir.z * 0.33,
  };

  // Handle 1: approaching end with gravity
  const h1: Point3D = {
    x: end.x - dir.x * 0.33 + randomOffset * 0.3,
    y: end.y - dir.y * 0.33 - gravityOffset,
    z: end.z - dir.z * 0.33,
  };

  return { h0, h1 };
}

/**
 * Generate secondary veins from midrib to margin
 */
function generateSecondaryVeins(
  shape: LeafShapeData,
  _calcs: LeafVeinCalcs,
  midrib: LeafVein,
  params: LeafParamDict,
  random: SeededRandom,
): LeafVein[] {
  const curves = shape.curves;
  const veins: LeafVein[] = [];

  const density = getParamValue(params, LPK.VeinDensity);
  const bunching = getParamValue(params, LPK.VeinBunching);
  const originRand = getParamValue(params, LPK.VeinOriginRand);
  const upperBias = getParamValue(params, LPK.GravVeinUpperBias);
  const lowerBias = getParamValue(params, LPK.GravVeinLowerBias);
  const endOffset = getParamValue(params, LPK.VeinEndOffset);
  const endLerp = getParamValue(params, LPK.VeinEndLerp);
  const distFromMargin = getParamValue(params, LPK.VeinDistFromMargin);
  const thickness = getParamValue(params, LPK.SecondaryThickness);
  const taper = getParamValue(params, LPK.SecondaryTaper);
  const taperRNG = getParamValue(params, LPK.TaperRNG);

  // Calculate number of veins based on density
  const midribLength = getCurveLength3D(midrib);
  const veinCount = Math.max(2, Math.floor(midribLength * density * 4));

  // Find margin curves
  const rightCurves = curves.filter((c) => !c.lefty);
  const leftCurves = curves.filter((c) => c.lefty);

  // Generate veins along both sides
  for (let i = 0; i < veinCount; i++) {
    // Position along midrib (bunching toward base)
    const rawT = (i + 0.5) / veinCount;
    const bunchedT = Math.pow(rawT, bunching);
    const t = Math.max(0.05, Math.min(0.95, bunchedT));

    // Add randomness to origin
    const originT = t + random.rangeAdd(originRand * 0.05);
    const originPoint = evaluateCurve3D(
      midrib,
      Math.max(0.05, Math.min(0.95, originT)),
    );

    // Gravity bias interpolates between upper and lower
    const gravityBias = t < 0.5 ? lowerBias : upperBias;

    // Generate vein to right margin
    const rightVein = createSecondaryVein(
      originPoint,
      rightCurves,
      t,
      false,
      distFromMargin,
      endOffset,
      endLerp,
      thickness,
      taper,
      taperRNG,
      gravityBias,
      random,
    );
    if (rightVein) veins.push(rightVein);

    // Generate vein to left margin
    const leftVein = createSecondaryVein(
      originPoint,
      leftCurves,
      t,
      true,
      distFromMargin,
      endOffset,
      endLerp,
      thickness,
      taper,
      taperRNG,
      gravityBias,
      random,
    );
    if (leftVein) veins.push(leftVein);
  }

  return veins;
}

/**
 * Create a single secondary vein
 */
function createSecondaryVein(
  origin: Point3D,
  marginCurves: LeafCurve[],
  posAlongMidrib: number,
  lefty: boolean,
  distFromMargin: number,
  _endOffset: number,
  endLerp: number,
  thickness: number,
  taper: number,
  taperRNG: number,
  gravityBias: number,
  random: SeededRandom,
): LeafVein | null {
  if (marginCurves.length === 0) return null;

  // Find the margin point at similar Y position
  let closestCurve: LeafCurve | null = null;
  let closestDist = Infinity;

  for (const curve of marginCurves) {
    // Sample the curve to find closest Y
    for (let t = 0; t <= 1; t += 0.1) {
      const point = evaluateCurve2D(curve, t);
      const yDiff = Math.abs(point.y - origin.y);
      const xSign = lefty ? -1 : 1;

      // Prefer points in the right direction (left or right)
      if (point.x * xSign >= 0) {
        if (yDiff < closestDist) {
          closestDist = yDiff;
          closestCurve = curve;
        }
      }
    }
  }

  if (!closestCurve) return null;

  // Refine the closest point
  const result = findClosestPointOnCurve2D(
    leafCurveToCurve2D(closestCurve),
    { x: origin.x, y: origin.y },
    3,
    10,
  );

  // Get margin point
  const marginPoint2D = result.point;

  // Apply distance from margin (inset)
  const tangent = getCurveTangent2D(closestCurve, result.t);
  const normal = { x: -tangent.y, y: tangent.x };
  const normalLen = Math.sqrt(normal.x * normal.x + normal.y * normal.y);
  const normX = normalLen > 0 ? normal.x / normalLen : 0;
  const normY = normalLen > 0 ? normal.y / normalLen : 0;

  // Inset from margin
  const insetAmount = distFromMargin * 0.1;
  const endPoint: Point3D = {
    x: marginPoint2D.x - normX * insetAmount * (lefty ? -1 : 1),
    y: marginPoint2D.y - normY * insetAmount,
    z: -0.01,
  };

  // Apply end lerp (pull toward midrib)
  const lerpedEnd = lerp3D(endPoint, origin, endLerp * 0.3);

  // Calculate gravity curve handles
  const { h0, h1 } = getGravityCurvePoints(
    origin,
    lerpedEnd,
    gravityBias,
    random,
  );

  // Calculate tapering
  const taperRandom = 1 + random.rangeAdd(taperRNG * 0.3);
  const endThickness = thickness * (1 - taper * 0.8) * taperRandom;

  const vein: LeafVein = {
    p0: clone3D(origin),
    h0,
    h1,
    p1: lerpedEnd,
    type: LeafVeinType.MidToMargin,
    lefty,
    thickness,
    taper,
    taperRNG,
    startThickness: thickness,
    endThickness: Math.max(0.001, endThickness),
    pointAlongMargin: result.t,
    posAlongMidrib,
  };

  return vein;
}

// =============================================================================
// MARGIN-SPANNING VEINS
// =============================================================================

/**
 * Generate margin-spanning veins that connect secondary veins
 */
function generateSpanningVeins(
  secondaryVeins: LeafVein[],
  params: LeafParamDict,
  random: SeededRandom,
): LeafVein[] {
  const spannerLerp = getParamValue(params, LPK.SpannerLerp);
  const spannerSqueeze = getParamValue(params, LPK.SpannerSqueeze);
  const spannerThickness = getParamValue(params, LPK.SpannerThickness);
  const spannerTaper = getParamValue(params, LPK.SpannerTaper);

  if (spannerThickness < 0.001) return [];

  const spanners: LeafVein[] = [];

  // Separate right and left veins
  const rightVeins = secondaryVeins.filter((v) => !v.lefty);
  const leftVeins = secondaryVeins.filter((v) => v.lefty);

  // Sort by position along midrib
  rightVeins.sort((a, b) => a.posAlongMidrib - b.posAlongMidrib);
  leftVeins.sort((a, b) => a.posAlongMidrib - b.posAlongMidrib);

  // Generate spanners between adjacent veins
  for (let i = 0; i < rightVeins.length - 1; i++) {
    const v1 = rightVeins[i];
    const v2 = rightVeins[i + 1];

    const spannerCount = Math.floor(3 * (1 - spannerSqueeze) + 1);
    for (let j = 0; j < spannerCount; j++) {
      const t = (j + 1) / (spannerCount + 1);
      const spanner = createSpannerVein(
        v1,
        v2,
        t,
        spannerLerp,
        spannerThickness,
        spannerTaper,
        false,
        random,
      );
      if (spanner) spanners.push(spanner);
    }
  }

  for (let i = 0; i < leftVeins.length - 1; i++) {
    const v1 = leftVeins[i];
    const v2 = leftVeins[i + 1];

    const spannerCount = Math.floor(3 * (1 - spannerSqueeze) + 1);
    for (let j = 0; j < spannerCount; j++) {
      const t = (j + 1) / (spannerCount + 1);
      const spanner = createSpannerVein(
        v1,
        v2,
        t,
        spannerLerp,
        spannerThickness,
        spannerTaper,
        true,
        random,
      );
      if (spanner) spanners.push(spanner);
    }
  }

  return spanners;
}

/**
 * Create a single spanning vein between two secondary veins
 */
function createSpannerVein(
  vein1: LeafVein,
  vein2: LeafVein,
  t: number,
  lerp: number,
  thickness: number,
  taper: number,
  lefty: boolean,
  _random: SeededRandom,
): LeafVein | null {
  // Get points along each parent vein
  const t1 = 0.3 + t * 0.4; // Position on first vein
  const t2 = 0.3 + (1 - t) * 0.4; // Position on second vein

  const p1 = evaluateCurve3D(vein1, t1);
  const p2 = evaluateCurve3D(vein2, t2);

  // Apply lerp toward midrib
  const midpoint = lerp3D(p1, p2, 0.5);
  const lerpedMid: Point3D = {
    x: midpoint.x * (1 - lerp * 0.5),
    y: midpoint.y,
    z: midpoint.z,
  };

  // Create curved spanner
  const h0 = lerp3D(p1, lerpedMid, 0.4);
  const h1 = lerp3D(lerpedMid, p2, 0.6);

  const spanner: LeafVein = {
    p0: clone3D(p1),
    h0,
    h1,
    p1: clone3D(p2),
    type: LeafVeinType.MarginSpanning,
    lefty,
    thickness: thickness * 0.5,
    taper,
    taperRNG: 0,
    startThickness: thickness * 0.5,
    endThickness: thickness * 0.3,
    pointAlongMargin: (vein1.pointAlongMargin + vein2.pointAlongMargin) / 2,
    posAlongMidrib: (vein1.posAlongMidrib + vein2.posAlongMidrib) / 2,
  };

  return spanner;
}

// =============================================================================
// VEIN SPLITTING
// =============================================================================

/**
 * Generate split veins (branching)
 */
function generateSplitVeins(
  secondaryVeins: LeafVein[],
  params: LeafParamDict,
  random: SeededRandom,
): LeafVein[] {
  const splitEnabled = getParamValue(params, LPK.VeinSplit) > 0;
  if (!splitEnabled) return [];

  const splitDepth = getParamValue(params, LPK.VeinSplitDepth);
  const splitAmp = getParamValue(params, LPK.VeinSplitAmp);

  const splitVeins: LeafVein[] = [];

  for (const vein of secondaryVeins) {
    // Skip margin-spanning veins
    if (vein.type === LeafVeinType.MarginSpanning) continue;

    // Decide if this vein splits
    if (random.random() > 0.5) continue;

    // Split point along the vein
    const splitT = splitDepth + random.rangeAdd(0.1);

    // Get split point
    const splitPoint = evaluateCurve3D(vein, splitT);

    // Get tangent at split point
    const tangent = normalize3D(sub3D(vein.p1, splitPoint));

    // Calculate split directions
    const splitAngle = splitAmp * PI * 0.25;

    // Primary branch (continues toward margin)
    const primaryEnd = add3D(splitPoint, mul3D(tangent, 0.3));

    // Secondary branch (diverges)
    const secondaryDir: Point3D = {
      x: tangent.x * Math.cos(splitAngle) - tangent.y * Math.sin(splitAngle),
      y: tangent.x * Math.sin(splitAngle) + tangent.y * Math.cos(splitAngle),
      z: tangent.z,
    };
    const secondaryEnd = add3D(splitPoint, mul3D(secondaryDir, 0.25));

    // Create primary split branch
    const primaryBranch: LeafVein = {
      p0: clone3D(splitPoint),
      h0: lerp3D(splitPoint, primaryEnd, 0.33),
      h1: lerp3D(splitPoint, primaryEnd, 0.66),
      p1: primaryEnd,
      type: LeafVeinType.SplitEndPrimary,
      lefty: vein.lefty,
      thickness: vein.thickness * 0.6,
      taper: vein.taper,
      taperRNG: vein.taperRNG,
      startThickness: vein.thickness * 0.6,
      endThickness: vein.thickness * 0.3,
      pointAlongMargin: vein.pointAlongMargin,
      posAlongMidrib: vein.posAlongMidrib,
    };

    // Create secondary split branch
    const secondaryBranch: LeafVein = {
      p0: clone3D(splitPoint),
      h0: lerp3D(splitPoint, secondaryEnd, 0.33),
      h1: lerp3D(splitPoint, secondaryEnd, 0.66),
      p1: secondaryEnd,
      type: LeafVeinType.SplitEndSecondary,
      lefty: vein.lefty,
      thickness: vein.thickness * 0.5,
      taper: vein.taper,
      taperRNG: vein.taperRNG,
      startThickness: vein.thickness * 0.5,
      endThickness: vein.thickness * 0.2,
      pointAlongMargin: vein.pointAlongMargin,
      posAlongMidrib: vein.posAlongMidrib,
    };

    splitVeins.push(primaryBranch, secondaryBranch);
  }

  return splitVeins;
}

// =============================================================================
// MAIN GENERATION FUNCTION
// =============================================================================

/**
 * Generate the complete vein network for a leaf
 */
export function generateLeafVeins(
  shape: LeafShapeData,
  params: LeafParamDict,
  seed: number,
): LeafVeinsData {
  const random = new SeededRandom(genTypedSeed(seed, "veins"));

  // Calculate key points
  const calcs = calculateVeinCalcs(shape, params);

  // Generate midrib
  const midrib = generateMidrib(calcs, params);

  // Generate secondary veins
  const secondaryVeins = generateSecondaryVeins(
    shape,
    calcs,
    midrib,
    params,
    random,
  );

  // Generate margin-spanning veins
  const spanningVeins = generateSpanningVeins(secondaryVeins, params, random);

  // Generate split veins
  const splitVeins = generateSplitVeins(secondaryVeins, params, random);

  // Combine all veins
  const allVeins = [midrib, ...secondaryVeins, ...spanningVeins, ...splitVeins];

  // Organize into groups
  const rightVeins = allVeins.filter((v) => !v.lefty);
  const leftVeins = allVeins.filter((v) => v.lefty);

  const veinGroups: LeafVeinGroup[] = [
    {
      veins: allVeins,
      rightVeins,
      leftVeins,
    },
  ];

  // Extract linear points (for texture generation)
  const linearPoints: Point3D[] = [];
  const gravityPoints: Point3D[] = [];

  for (const vein of allVeins) {
    // Sample points along each vein
    for (let t = 0; t <= 1; t += 0.1) {
      linearPoints.push(evaluateCurve3D(vein, t));
    }
    gravityPoints.push(vein.p0, vein.p1);
  }

  return {
    veinGroups,
    linearPoints,
    gravityPoints,
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get all veins from vein data
 */
export function getAllVeins(data: LeafVeinsData): LeafVein[] {
  const veins: LeafVein[] = [];
  for (const group of data.veinGroups) {
    veins.push(...group.veins);
  }
  return veins;
}

/**
 * Get veins by type
 */
export function getVeinsByType(
  data: LeafVeinsData,
  type: LeafVeinType,
): LeafVein[] {
  return getAllVeins(data).filter((v) => v.type === type);
}

/**
 * Get the midrib vein
 */
export function getMidrib(data: LeafVeinsData): LeafVein | null {
  const midribs = getVeinsByType(data, LeafVeinType.Midrib);
  return midribs.length > 0 ? midribs[0] : null;
}

/**
 * Calculate total vein length
 */
export function getTotalVeinLength(data: LeafVeinsData): number {
  let total = 0;
  for (const vein of getAllVeins(data)) {
    total += getCurveLength3D(vein);
  }
  return total;
}
