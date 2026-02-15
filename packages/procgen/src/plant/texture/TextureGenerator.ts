/**
 * TextureGenerator - Procedural texture generation for leaves
 *
 * Generates albedo, normal, and height textures for leaves using
 * canvas-based drawing operations.
 *
 * Based on the Unity Procedural-Plant-and-Foliage-Generator.
 */

import type {
  Point2D,
  LeafVein,
  LeafVeinsData,
  LeafShapeData,
  LeafParamDict,
  HSLColor,
  RenderableVein,
} from "../types.js";
import { LeafVeinType, LPK } from "../types.js";
import { evaluateCurve2D, evaluateCurve3D } from "../math/Bezier.js";
import {
  distance2D,
  lerp2D,
  getExtents2D,
  clamp,
  clamp01,
} from "../math/Vector.js";
import {
  getParamValue,
  getParamColorValue,
} from "../params/LeafParamDefaults.js";
import { getAllVeins } from "../veins/LeafVeins.js";

// =============================================================================
// COLOR UTILITIES
// =============================================================================

/**
 * Convert HSL to RGB
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Adjust HSL color
 */
function adjustHsl(
  base: HSLColor,
  hueOffset: number,
  satOffset: number,
  litOffset: number,
): HSLColor {
  return {
    h: (base.h + hueOffset + 1) % 1,
    s: clamp01(base.s + satOffset),
    l: clamp01(base.l + litOffset),
  };
}

// =============================================================================
// COORDINATE TRANSFORMATION
// =============================================================================

/**
 * Transform leaf coordinates to texture coordinates
 */
function leafToTexture(
  point: Point2D,
  extents: { min: Point2D; max: Point2D },
  size: number,
  margin: number = 0.05,
): Point2D {
  const width = extents.max.x - extents.min.x;
  const height = extents.max.y - extents.min.y;
  const scale = Math.max(width, height);

  const effectiveSize = size * (1 - margin * 2);
  const offsetX = (size - effectiveSize) / 2;
  const offsetY = (size - effectiveSize) / 2;

  return {
    x: offsetX + ((point.x - extents.min.x) / scale) * effectiveSize,
    y: offsetY + ((extents.max.y - point.y) / scale) * effectiveSize, // Flip Y
  };
}

// =============================================================================
// VEIN PREPARATION
// =============================================================================

/**
 * Prepare veins for rendering with proper points
 */
function prepareVeinsForRendering(
  veins: LeafVein[],
  extents: { min: Point2D; max: Point2D },
  size: number,
  lineSteps: number,
): RenderableVein[] {
  const renderableVeins: RenderableVein[] = [];

  for (const vein of veins) {
    const basePoints: Point2D[] = [];
    const radiancePoints: Point2D[] = [];
    const shadowPoints: Point2D[] = [];
    const normalPoints: Point2D[] = [];
    const centerPoints: Point2D[] = [];

    for (let i = 0; i <= lineSteps; i++) {
      const t = i / lineSteps;
      const point3d = evaluateCurve3D(vein, t);
      const point2d: Point2D = { x: point3d.x, y: point3d.y };
      const texPoint = leafToTexture(point2d, extents, size);

      basePoints.push(texPoint);
      centerPoints.push(point2d);

      // Calculate thickness at this point
      const thickness =
        vein.startThickness + (vein.endThickness - vein.startThickness) * t;
      const thicknessInTex = thickness * size * 0.1;

      // Offset points for effects
      radiancePoints.push({
        x: texPoint.x - thicknessInTex * 0.5,
        y: texPoint.y,
      });
      shadowPoints.push({
        x: texPoint.x + thicknessInTex * 0.3,
        y: texPoint.y,
      });
      normalPoints.push({
        x: texPoint.x,
        y: texPoint.y - thicknessInTex * 0.2,
      });
    }

    renderableVeins.push({
      vein,
      basePoints,
      radiancePoints,
      shadowPoints,
      normalPoints,
      centerPoints,
    });
  }

  return renderableVeins;
}

// =============================================================================
// ALBEDO TEXTURE GENERATION
// =============================================================================

/**
 * Simple seeded random for texture variation
 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Generate albedo (color) texture
 * Seed is used for color variation and noise patterns
 */
export function generateAlbedoTexture(
  shape: LeafShapeData,
  veins: LeafVeinsData,
  params: LeafParamDict,
  size: number,
  seed: number,
): ImageData {
  // Create canvas
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;

  // Seeded random for consistent variation
  const rand = seededRandom(seed);

  // Get parameters with seed-based micro-variation
  const baseColor = getParamColorValue(params, LPK.TexBaseColor);
  // Add tiny seed-based hue shift (±0.02)
  const hueVariation = (rand() - 0.5) * 0.04;
  baseColor.h = (baseColor.h + hueVariation + 1) % 1;
  const veinColor = getParamColorValue(params, LPK.TexVeinColor);
  const marginColor = getParamColorValue(params, LPK.TexMarginColor);
  const veinOpacity = getParamValue(params, LPK.TexVeinOpacity);
  const veinSecondaryOpacity = getParamValue(
    params,
    LPK.TexVeinSecondaryOpacity,
  );
  const shadowStrength = getParamValue(params, LPK.TexShadowStrength);
  const radianceHue = getParamValue(params, LPK.TexRadianceHue);
  const radiance = getParamValue(params, LPK.TexRadiance);
  const marginProminance = getParamValue(params, LPK.TexMarginProminance);
  const marginAlpha = getParamValue(params, LPK.TexMarginAlpha);

  // Calculate extents
  const leafPoints = shape.curves.flatMap((c) => {
    const points: Point2D[] = [];
    for (let t = 0; t <= 1; t += 0.1) {
      points.push(evaluateCurve2D(c, t));
    }
    return points;
  });
  const extents = getExtents2D(leafPoints);

  // Clear with transparent
  ctx.clearRect(0, 0, size, size);

  // Draw leaf shape as clip path
  ctx.beginPath();
  const firstPoint = leafToTexture(
    evaluateCurve2D(shape.curves[0], 0),
    extents,
    size,
  );
  ctx.moveTo(firstPoint.x, firstPoint.y);

  for (const curve of shape.curves) {
    for (let t = 0.1; t <= 1; t += 0.1) {
      const point = leafToTexture(evaluateCurve2D(curve, t), extents, size);
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.closePath();

  // Fill with base color
  const [r, g, b] = hslToRgb(baseColor.h, baseColor.s, baseColor.l);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fill();

  // Apply radiance gradient
  if (radiance > 0.01) {
    const radianceColor = adjustHsl(baseColor, radianceHue * 0.2, 0, 0.1);
    const [rr, rg, rb] = hslToRgb(
      radianceColor.h,
      radianceColor.s,
      radianceColor.l,
    );

    const gradient = ctx.createRadialGradient(
      size / 2,
      size * 0.6,
      0,
      size / 2,
      size * 0.6,
      size * 0.5,
    );
    gradient.addColorStop(0, `rgba(${rr}, ${rg}, ${rb}, ${radiance * 0.5})`);
    gradient.addColorStop(1, `rgba(${rr}, ${rg}, ${rb}, 0)`);

    ctx.save();
    ctx.clip();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  // Draw margin color
  if (marginProminance > 0.01 && marginAlpha > 0.01) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(firstPoint.x, firstPoint.y);
    for (const curve of shape.curves) {
      for (let t = 0.1; t <= 1; t += 0.1) {
        const point = leafToTexture(evaluateCurve2D(curve, t), extents, size);
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.closePath();

    const [mr, mg, mb] = hslToRgb(marginColor.h, marginColor.s, marginColor.l);
    ctx.strokeStyle = `rgba(${mr}, ${mg}, ${mb}, ${marginAlpha})`;
    ctx.lineWidth = marginProminance * size * 0.02;
    ctx.stroke();
    ctx.restore();
  }

  // Prepare veins for rendering
  const allVeins = getAllVeins(veins);
  const renderableVeins = prepareVeinsForRendering(allVeins, extents, size, 10);

  // Draw veins
  const [vr, vg, vb] = hslToRgb(veinColor.h, veinColor.s, veinColor.l);

  for (const rv of renderableVeins) {
    const { vein, basePoints } = rv;
    if (basePoints.length < 2) continue;

    const isMidrib = vein.type === LeafVeinType.Midrib;
    const opacity = isMidrib ? veinOpacity : veinSecondaryOpacity;

    ctx.beginPath();
    ctx.moveTo(basePoints[0].x, basePoints[0].y);
    for (let i = 1; i < basePoints.length; i++) {
      ctx.lineTo(basePoints[i].x, basePoints[i].y);
    }

    ctx.strokeStyle = `rgba(${vr}, ${vg}, ${vb}, ${opacity})`;
    ctx.lineWidth = isMidrib ? size * 0.015 : size * 0.008;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // Apply shadow around veins
  if (shadowStrength > 0.01) {
    const shadowColor = adjustHsl(baseColor, 0, 0, -0.2);
    const [sr, sg, sb] = hslToRgb(shadowColor.h, shadowColor.s, shadowColor.l);

    ctx.save();
    ctx.globalCompositeOperation = "multiply";

    for (const rv of renderableVeins) {
      const { shadowPoints } = rv;
      if (shadowPoints.length < 2) continue;

      ctx.beginPath();
      ctx.moveTo(shadowPoints[0].x, shadowPoints[0].y);
      for (let i = 1; i < shadowPoints.length; i++) {
        ctx.lineTo(shadowPoints[i].x, shadowPoints[i].y);
      }

      ctx.strokeStyle = `rgba(${sr}, ${sg}, ${sb}, ${shadowStrength * 0.3})`;
      ctx.lineWidth = size * 0.02;
      ctx.filter = `blur(${size * 0.005}px)`;
      ctx.stroke();
    }

    ctx.restore();
  }

  return ctx.getImageData(0, 0, size, size);
}

// =============================================================================
// NORMAL MAP GENERATION
// =============================================================================

/**
 * Generate normal map texture
 * Seed is used for subtle surface variation
 */
export function generateNormalTexture(
  shape: LeafShapeData,
  veins: LeafVeinsData,
  params: LeafParamDict,
  size: number,
  seed: number,
): ImageData {
  // Seeded random for consistent variation
  const rand = seededRandom(seed + 1000); // Different seed offset than albedo
  // Create canvas
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;

  // Get parameters
  const midribWidth = getParamValue(params, LPK.NormalMidribWidth);
  const midribDepth = getParamValue(params, LPK.NormalMidribDepth);
  const secondaryWidth = getParamValue(params, LPK.NormalSecondaryWidth);
  const secondaryDepth = getParamValue(params, LPK.NormalSecondaryDepth);
  const puffyStrength = getParamValue(params, LPK.NormalPuffyStrength);
  const veinSmooth = getParamValue(params, LPK.NormalVeinSmooth);

  // Calculate extents
  const leafPoints = shape.curves.flatMap((c) => {
    const points: Point2D[] = [];
    for (let t = 0; t <= 1; t += 0.1) {
      points.push(evaluateCurve2D(c, t));
    }
    return points;
  });
  const extents = getExtents2D(leafPoints);

  // Fill with neutral normal (pointing up: 128, 128, 255)
  ctx.fillStyle = "rgb(128, 128, 255)";
  ctx.fillRect(0, 0, size, size);

  // Create clip path for leaf
  ctx.save();
  ctx.beginPath();
  const firstPoint = leafToTexture(
    evaluateCurve2D(shape.curves[0], 0),
    extents,
    size,
  );
  ctx.moveTo(firstPoint.x, firstPoint.y);
  for (const curve of shape.curves) {
    for (let t = 0.1; t <= 1; t += 0.1) {
      const point = leafToTexture(evaluateCurve2D(curve, t), extents, size);
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.closePath();
  ctx.clip();

  // Draw puffy regions between veins
  if (puffyStrength > 0.01) {
    // Create subtle bumps using gradients
    const allVeins = getAllVeins(veins);
    const renderableVeins = prepareVeinsForRendering(
      allVeins,
      extents,
      size,
      10,
    );

    for (let i = 0; i < renderableVeins.length - 1; i++) {
      const rv1 = renderableVeins[i];
      const rv2 = renderableVeins[i + 1];

      if (rv1.basePoints.length < 2 || rv2.basePoints.length < 2) continue;

      // Find center between veins
      const center1 = rv1.basePoints[Math.floor(rv1.basePoints.length / 2)];
      const center2 = rv2.basePoints[Math.floor(rv2.basePoints.length / 2)];
      const midpoint = lerp2D(center1, center2, 0.5);

      const radius = distance2D(center1, center2) * 0.4;

      // Draw puffy highlight
      const gradient = ctx.createRadialGradient(
        midpoint.x,
        midpoint.y,
        0,
        midpoint.x,
        midpoint.y,
        radius,
      );

      // Normal pointing slightly up/out with seed-based variation
      const puffyVariation = (rand() - 0.5) * 10; // ±5 value variation
      const puffyNormal = Math.round(128 + puffyStrength * 30 + puffyVariation);
      gradient.addColorStop(0, `rgb(128, ${puffyNormal}, 255)`);
      gradient.addColorStop(1, "rgb(128, 128, 255)");

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
  }

  // Draw vein grooves
  const allVeins = getAllVeins(veins);
  const renderableVeins = prepareVeinsForRendering(allVeins, extents, size, 10);

  for (const rv of renderableVeins) {
    const { vein, basePoints } = rv;
    if (basePoints.length < 2) continue;

    const isMidrib = vein.type === LeafVeinType.Midrib;
    const width = isMidrib ? midribWidth : secondaryWidth;
    const depth = isMidrib ? midribDepth : secondaryDepth;

    if (Math.abs(depth) < 0.01) continue;

    // Draw groove (darker normal = pointing into surface)
    ctx.beginPath();
    ctx.moveTo(basePoints[0].x, basePoints[0].y);
    for (let i = 1; i < basePoints.length; i++) {
      ctx.lineTo(basePoints[i].x, basePoints[i].y);
    }

    // Normal map: Z component (blue channel) indicates depth
    // Lower blue = indented, higher blue = raised
    const normalZ = Math.round(128 - depth * 60);
    ctx.strokeStyle = `rgb(128, 128, ${normalZ})`;
    ctx.lineWidth = width * size * 0.01 * (1 - veinSmooth);
    ctx.lineCap = "round";
    ctx.stroke();

    // Add blur for smoothness
    if (veinSmooth > 0.1) {
      ctx.filter = `blur(${veinSmooth * size * 0.005}px)`;
      ctx.stroke();
      ctx.filter = "none";
    }
  }

  ctx.restore();

  return ctx.getImageData(0, 0, size, size);
}

// =============================================================================
// HEIGHT MAP GENERATION
// =============================================================================

/**
 * Generate height map texture
 * Seed is used for noise pattern variation
 */
export function generateHeightTexture(
  shape: LeafShapeData,
  veins: LeafVeinsData,
  params: LeafParamDict,
  size: number,
  seed: number,
): ImageData {
  // Seeded random for noise variation
  const rand = seededRandom(seed + 2000); // Different seed offset
  // Create canvas
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;

  // Get parameters
  const heightAmp = getParamValue(params, LPK.MaterialHeightAmp);
  const vertBumpsPower = getParamValue(params, LPK.VertBumpsPower);
  const vertBumpsScale = getParamValue(params, LPK.VertBumpsScale);

  // Calculate extents
  const leafPoints = shape.curves.flatMap((c) => {
    const points: Point2D[] = [];
    for (let t = 0; t <= 1; t += 0.1) {
      points.push(evaluateCurve2D(c, t));
    }
    return points;
  });
  const extents = getExtents2D(leafPoints);

  // Fill with base height (mid-gray)
  ctx.fillStyle = "rgb(128, 128, 128)";
  ctx.fillRect(0, 0, size, size);

  // Create clip path for leaf
  ctx.save();
  ctx.beginPath();
  const firstPoint = leafToTexture(
    evaluateCurve2D(shape.curves[0], 0),
    extents,
    size,
  );
  ctx.moveTo(firstPoint.x, firstPoint.y);
  for (const curve of shape.curves) {
    for (let t = 0.1; t <= 1; t += 0.1) {
      const point = leafToTexture(evaluateCurve2D(curve, t), extents, size);
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.closePath();
  ctx.clip();

  // Draw base height variation (thicker in middle)
  if (heightAmp > 0.01) {
    const centerX = size / 2;
    const centerY = size / 2;

    const gradient = ctx.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      size * 0.5,
    );

    const centerHeight = Math.round(128 + heightAmp * 40);
    gradient.addColorStop(
      0,
      `rgb(${centerHeight}, ${centerHeight}, ${centerHeight})`,
    );
    gradient.addColorStop(1, "rgb(128, 128, 128)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }

  // Draw vein depressions
  const allVeins = getAllVeins(veins);
  const renderableVeins = prepareVeinsForRendering(allVeins, extents, size, 10);

  for (const rv of renderableVeins) {
    const { vein, basePoints } = rv;
    if (basePoints.length < 2) continue;

    const isMidrib = vein.type === LeafVeinType.Midrib;
    const depth = isMidrib ? 0.15 : 0.08;

    ctx.beginPath();
    ctx.moveTo(basePoints[0].x, basePoints[0].y);
    for (let i = 1; i < basePoints.length; i++) {
      ctx.lineTo(basePoints[i].x, basePoints[i].y);
    }

    const heightValue = Math.round(128 - depth * 50);
    ctx.strokeStyle = `rgb(${heightValue}, ${heightValue}, ${heightValue})`;
    ctx.lineWidth = isMidrib ? size * 0.02 : size * 0.01;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // Add noise bumps with seed-based phase offset
  if (vertBumpsPower > 0.01) {
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;

    // Seed-based phase offsets for unique noise patterns
    const phaseX = rand() * Math.PI * 2;
    const phaseY = rand() * Math.PI * 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;

        // Seed-modified noise function
        const noise =
          Math.sin(x * vertBumpsScale * 0.1 + phaseX) *
            Math.cos(y * vertBumpsScale * 0.1 + phaseY) *
            0.5 +
          Math.sin(
            x * vertBumpsScale * 0.05 + y * vertBumpsScale * 0.05 + phaseX,
          ) *
            0.3;

        const bumpValue = Math.round(noise * vertBumpsPower * 30);

        // Only modify if inside leaf (alpha > 0 or we're clipped)
        data[i] = clamp(data[i] + bumpValue, 0, 255);
        data[i + 1] = clamp(data[i + 1] + bumpValue, 0, 255);
        data[i + 2] = clamp(data[i + 2] + bumpValue, 0, 255);
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  ctx.restore();

  return ctx.getImageData(0, 0, size, size);
}

// =============================================================================
// MAIN TEXTURE GENERATION
// =============================================================================

export interface GeneratedTextures {
  albedo: ImageData;
  normal: ImageData;
  height: ImageData;
}

/**
 * Generate all textures for a leaf
 */
export function generateAllTextures(
  shape: LeafShapeData,
  veins: LeafVeinsData,
  params: LeafParamDict,
  size: number,
  seed: number,
): GeneratedTextures {
  return {
    albedo: generateAlbedoTexture(shape, veins, params, size, seed),
    normal: generateNormalTexture(shape, veins, params, size, seed),
    height: generateHeightTexture(shape, veins, params, size, seed),
  };
}
