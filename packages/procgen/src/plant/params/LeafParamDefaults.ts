/**
 * LeafParamDefaults - Default parameter definitions for plant generation
 *
 * Defines all 100+ parameters with their ranges, defaults, and metadata.
 * Based on the Unity Procedural-Plant-and-Foliage-Generator.
 */

import type {
  LeafParam,
  LeafParamDict,
  FloatRange,
  HSLRange,
  HSLColor,
} from "../types.js";
import {
  LPK,
  LPType,
  LPCategory,
  LPRandomValCurve,
  LPRandomValCenterBias,
  LPImportance,
} from "../types.js";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a float parameter
 */
function floatParam(
  key: LPK,
  range: FloatRange,
  group: string,
  type: LPType,
  category: LPCategory,
  randomCurve: LPRandomValCurve = LPRandomValCurve.CenterBell,
  randomBias: LPRandomValCenterBias = LPRandomValCenterBias.Default,
  importance: LPImportance = LPImportance.Medium,
  visible: boolean = true,
): LeafParam {
  return {
    key,
    value: range.default,
    hasColorValue: false,
    enabled: true,
    range,
    group,
    type,
    category,
    randomCurve,
    randomBias,
    importance,
    visible,
  };
}

/**
 * Create a toggle parameter (boolean as 0/1)
 */
function toggleParam(
  key: LPK,
  defaultValue: boolean,
  group: string,
  type: LPType,
  category: LPCategory,
): LeafParam {
  return {
    key,
    value: defaultValue ? 1 : 0,
    hasColorValue: false,
    enabled: defaultValue,
    range: { min: 0, max: 1, default: defaultValue ? 1 : 0 },
    group,
    type,
    category,
    randomCurve: LPRandomValCurve.CenterBell,
    randomBias: LPRandomValCenterBias.Default,
    importance: LPImportance.Disable,
    visible: true,
  };
}

/**
 * Create a toggle range parameter (enabled based on value > threshold)
 */
function toggleRangeParam(
  key: LPK,
  max: number,
  min: number,
  defaultVal: number,
  group: string,
  type: LPType,
  category: LPCategory,
  randomCurve: LPRandomValCurve = LPRandomValCurve.CenterBell,
  randomBias: LPRandomValCenterBias = LPRandomValCenterBias.Default,
  importance: LPImportance = LPImportance.Medium,
): LeafParam {
  return {
    key,
    value: defaultVal,
    hasColorValue: false,
    enabled: defaultVal > min,
    range: { min, max, default: defaultVal },
    group,
    type,
    category,
    randomCurve,
    randomBias,
    importance,
    visible: true,
  };
}

/**
 * Create an HSL color parameter
 */
function hslColorParam(
  key: LPK,
  hslRange: HSLRange,
  group: string,
  type: LPType,
  category: LPCategory,
  importance: LPImportance = LPImportance.High,
): LeafParam {
  return {
    key,
    value: 0,
    colorValue: {
      h: hslRange.h.default,
      s: hslRange.s.default,
      l: hslRange.l.default,
    },
    hasColorValue: true,
    enabled: true,
    range: { min: 0, max: 1, default: 0 },
    hslRange,
    group,
    type,
    category,
    randomCurve: LPRandomValCurve.CenterBell,
    randomBias: LPRandomValCenterBias.Default,
    importance,
    visible: true,
  };
}

// =============================================================================
// DEFAULT PARAMETERS
// =============================================================================

/**
 * Create default parameter dictionary
 */
export function createDefaultParams(): LeafParamDict {
  const params: Partial<LeafParamDict> = {};

  // =========================================================================
  // GEN 0 - BASIC SHAPE
  // =========================================================================

  params[LPK.Pudge] = floatParam(
    LPK.Pudge,
    { min: 0, max: 3, default: 1 },
    "Gen 0",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Disable,
    false,
  );

  params[LPK.Sheer] = floatParam(
    LPK.Sheer,
    { min: 0, max: 1, default: 0.4 },
    "Gen 0",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.Length] = floatParam(
    LPK.Length,
    { min: 1, max: 18, default: 6 },
    "Gen 0",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.High,
  );

  params[LPK.Width] = floatParam(
    LPK.Width,
    { min: 0.2, max: 6, default: 2.5 },
    "Gen 0",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.High,
  );

  params[LPK.TipAngle] = floatParam(
    LPK.TipAngle,
    { min: 0, max: 90, default: 45 },
    "Gen 0",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.TipAmplitude] = floatParam(
    LPK.TipAmplitude,
    { min: 0, max: 3, default: 1.5 },
    "Gen 0",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  // =========================================================================
  // GEN 1 - HEART SHAPE
  // =========================================================================

  params[LPK.Heart] = toggleRangeParam(
    LPK.Heart,
    1,
    -0.1,
    0,
    "Gen 1",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread3,
    LPImportance.Medium,
  );

  params[LPK.SinusSheer] = floatParam(
    LPK.SinusSheer,
    { min: -0.5, max: 4, default: 0.7 },
    "Gen 1",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.SinusHeight] = floatParam(
    LPK.SinusHeight,
    { min: 0, max: 4, default: 1.75 },
    "Gen 1",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.WaistAmp] = floatParam(
    LPK.WaistAmp,
    { min: 0.1, max: 2, default: 1 },
    "Gen 1",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.WaistAmpOffset] = floatParam(
    LPK.WaistAmpOffset,
    { min: -0.5, max: 0.5, default: 0 },
    "Gen 1",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  // =========================================================================
  // GEN 2 - LOBES
  // =========================================================================

  params[LPK.Lobes] = toggleRangeParam(
    LPK.Lobes,
    1,
    0,
    0.5,
    "Gen 2",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread3,
    LPImportance.Low,
  );

  params[LPK.LobeTilt] = floatParam(
    LPK.LobeTilt,
    { min: -45, max: 90, default: 0 },
    "Gen 2",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.LobeAmplitude] = floatParam(
    LPK.LobeAmplitude,
    { min: 0, max: 1.5, default: 0.75 },
    "Gen 2",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.LobeAmpOffset] = floatParam(
    LPK.LobeAmpOffset,
    { min: -0.5, max: 0.5, default: 0 },
    "Gen 2",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  // =========================================================================
  // GEN 3 - SCOOP
  // =========================================================================

  params[LPK.ScoopDepth] = floatParam(
    LPK.ScoopDepth,
    { min: 0, max: 0.9, default: 0.1 },
    "Gen 3",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.ScoopHeight] = floatParam(
    LPK.ScoopHeight,
    { min: 0, max: 1, default: 0.1 },
    "Gen 3",
    LPType.Leaf,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  // =========================================================================
  // VEINS
  // =========================================================================

  params[LPK.VeinDensity] = floatParam(
    LPK.VeinDensity,
    { min: 0.1, max: 1.5, default: 0.5 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.High,
  );

  params[LPK.VeinBunching] = floatParam(
    LPK.VeinBunching,
    { min: 1, max: 3, default: 2 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Spread1,
    LPImportance.Medium,
  );

  params[LPK.VeinLobeBunching] = floatParam(
    LPK.VeinLobeBunching,
    { min: 1, max: 5, default: 3 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.VeinOriginRand] = floatParam(
    LPK.VeinOriginRand,
    { min: 0, max: 1, default: 0.5 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.GravVeinUpperBias] = floatParam(
    LPK.GravVeinUpperBias,
    { min: 0, max: 0.75, default: 0.5 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.GravVeinLowerBias] = floatParam(
    LPK.GravVeinLowerBias,
    { min: 0, max: 1, default: 0.5 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.VeinEndOffset] = floatParam(
    LPK.VeinEndOffset,
    { min: 0, max: 2, default: 1 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.VeinEndLerp] = floatParam(
    LPK.VeinEndLerp,
    { min: 0, max: 1, default: 0.5 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.VeinDistFromMargin] = floatParam(
    LPK.VeinDistFromMargin,
    { min: 0, max: 1, default: 0.1 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread1,
    LPImportance.Medium,
  );

  params[LPK.MidribDistFromMargin] = floatParam(
    LPK.MidribDistFromMargin,
    { min: 0, max: 2, default: 0.5 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.SpannerLerp] = floatParam(
    LPK.SpannerLerp,
    { min: -0.5, max: 1, default: 0.2 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.SpannerSqueeze] = floatParam(
    LPK.SpannerSqueeze,
    { min: 0, max: 0.5, default: 0.16 },
    "Gen 0",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  // Vein Thickness
  params[LPK.MidribThickness] = floatParam(
    LPK.MidribThickness,
    { min: 0, max: 0.15, default: 0.06 },
    "Thickness",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.SecondaryThickness] = floatParam(
    LPK.SecondaryThickness,
    { min: 0, max: 0.12, default: 0.04 },
    "Thickness",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.SpannerThickness] = floatParam(
    LPK.SpannerThickness,
    { min: 0, max: 1, default: 0 },
    "Thickness",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread2,
    LPImportance.Medium,
  );

  params[LPK.MidribTaper] = floatParam(
    LPK.MidribTaper,
    { min: 0, max: 4, default: 1 },
    "Thickness",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze1,
    LPImportance.Medium,
  );

  params[LPK.SecondaryTaper] = floatParam(
    LPK.SecondaryTaper,
    { min: 0, max: 4, default: 0.5 },
    "Thickness",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze1,
    LPImportance.Medium,
  );

  params[LPK.SpannerTaper] = floatParam(
    LPK.SpannerTaper,
    { min: 0, max: 2, default: 1 },
    "Thickness",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze1,
    LPImportance.Low,
  );

  params[LPK.TaperRNG] = floatParam(
    LPK.TaperRNG,
    { min: 0, max: 2, default: 0.5 },
    "Thickness",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  // Vein Split
  params[LPK.VeinSplit] = toggleRangeParam(
    LPK.VeinSplit,
    1,
    -0.3,
    0,
    "Split",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread3,
    LPImportance.Medium,
  );

  params[LPK.VeinSplitDepth] = floatParam(
    LPK.VeinSplitDepth,
    { min: 0.1, max: 0.9, default: 0.4 },
    "Split",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.VeinSplitAmp] = floatParam(
    LPK.VeinSplitAmp,
    { min: 0.1, max: 0.9, default: 0.5 },
    "Split",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.VeinSplitAmpOffset] = floatParam(
    LPK.VeinSplitAmpOffset,
    { min: 0, max: 1, default: 0.5 },
    "Split",
    LPType.Vein,
    LPCategory.Veins,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
    false,
  );

  // =========================================================================
  // TEXTURE
  // =========================================================================

  params[LPK.TexBaseColor] = hslColorParam(
    LPK.TexBaseColor,
    {
      h: { min: 0, max: 1, default: 0.33 },
      s: { min: 0.05, max: 0.95, default: 0.8 },
      l: { min: 0.05, max: 0.95, default: 0.15 },
    },
    "Base",
    LPType.Texture,
    LPCategory.Color,
    LPImportance.High,
  );

  params[LPK.TexShadowStrength] = floatParam(
    LPK.TexShadowStrength,
    { min: 0, max: 1, default: 0.75 },
    "Base",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.TexMaskingStrength] = floatParam(
    LPK.TexMaskingStrength,
    { min: 0, max: 2, default: 1.1 },
    "Base",
    LPType.Texture,
    LPCategory.Texture,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.TexVeinColor] = hslColorParam(
    LPK.TexVeinColor,
    {
      h: { min: 0, max: 1, default: 0.33 },
      s: { min: 0.2, max: 0.95, default: 0.8 },
      l: { min: 0.05, max: 0.99, default: 0.2 },
    },
    "Veins",
    LPType.Texture,
    LPCategory.Color,
    LPImportance.High,
  );

  params[LPK.TexVeinOpacity] = floatParam(
    LPK.TexVeinOpacity,
    { min: 0, max: 1, default: 0.8 },
    "Veins",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.TexVeinSecondaryOpacity] = floatParam(
    LPK.TexVeinSecondaryOpacity,
    { min: 0, max: 1, default: 0.8 },
    "Veins",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.TexVeinDepth] = floatParam(
    LPK.TexVeinDepth,
    { min: 0, max: 1, default: 0.5 },
    "Veins",
    LPType.Texture,
    LPCategory.Veins,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread2,
    LPImportance.Low,
  );

  params[LPK.TexVeinBlur] = floatParam(
    LPK.TexVeinBlur,
    { min: 0, max: 1, default: 0.5 },
    "Veins",
    LPType.Texture,
    LPCategory.Veins,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Disable,
    false,
  );

  // Radiance
  params[LPK.TexRadianceHue] = floatParam(
    LPK.TexRadianceHue,
    { min: -1, max: 1, default: 0 },
    "Radiance",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread2,
    LPImportance.High,
  );

  params[LPK.TexRadianceLitPower] = floatParam(
    LPK.TexRadianceLitPower,
    { min: 0, max: 1, default: 0.1 },
    "Radiance",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.TexRadianceInversion] = toggleRangeParam(
    LPK.TexRadianceInversion,
    1,
    -0.5,
    0,
    "Radiance",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread3,
    LPImportance.Medium,
  );

  params[LPK.TexRadiance] = floatParam(
    LPK.TexRadiance,
    { min: 0, max: 1, default: 0.5 },
    "Radiance",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.TexRadianceMargin] = floatParam(
    LPK.TexRadianceMargin,
    { min: 0, max: 1, default: 0.5 },
    "Radiance",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.TexRadianceDensity] = floatParam(
    LPK.TexRadianceDensity,
    { min: 0.25, max: 2, default: 1 },
    "Radiance",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.TexRadianceWidthMult] = floatParam(
    LPK.TexRadianceWidthMult,
    { min: 1, max: 5, default: 2 },
    "Radiance",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  // Margin
  params[LPK.TexMarginColor] = hslColorParam(
    LPK.TexMarginColor,
    {
      h: { min: 0, max: 1, default: 0.33 },
      s: { min: 0.2, max: 0.95, default: 0.85 },
      l: { min: 0.05, max: 0.99, default: 0.2 },
    },
    "Margin",
    LPType.Texture,
    LPCategory.Color,
    LPImportance.High,
  );

  params[LPK.TexMarginProminance] = floatParam(
    LPK.TexMarginProminance,
    { min: 0, max: 1, default: 0.5 },
    "Margin",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread2,
    LPImportance.Medium,
  );

  params[LPK.TexMarginAlpha] = floatParam(
    LPK.TexMarginAlpha,
    { min: 0, max: 1, default: 0.5 },
    "Margin",
    LPType.Texture,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread2,
    LPImportance.Medium,
  );

  // =========================================================================
  // NORMALS
  // =========================================================================

  params[LPK.NormalMidribWidth] = floatParam(
    LPK.NormalMidribWidth,
    { min: 0, max: 3, default: 1 },
    "Normals",
    LPType.Normal,
    LPCategory.Texture,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze2,
    LPImportance.Low,
  );

  params[LPK.NormalMidribDepth] = floatParam(
    LPK.NormalMidribDepth,
    { min: -1, max: 1, default: 0.1 },
    "Normals",
    LPType.Normal,
    LPCategory.Texture,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.NormalSecondaryWidth] = floatParam(
    LPK.NormalSecondaryWidth,
    { min: 0, max: 3, default: 1 },
    "Normals",
    LPType.Normal,
    LPCategory.Texture,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze2,
    LPImportance.Low,
  );

  params[LPK.NormalSecondaryDepth] = floatParam(
    LPK.NormalSecondaryDepth,
    { min: -1, max: 1, default: 0.1 },
    "Normals",
    LPType.Normal,
    LPCategory.Texture,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.NormalVeinSmooth] = floatParam(
    LPK.NormalVeinSmooth,
    { min: 0, max: 1, default: 0 },
    "Normals",
    LPType.Normal,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Low,
  );

  params[LPK.NormalPuffySmooth] = floatParam(
    LPK.NormalPuffySmooth,
    { min: 0, max: 1, default: 0 },
    "Normals",
    LPType.Normal,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Low,
  );

  params[LPK.NormalPuffyPlateauClamp] = floatParam(
    LPK.NormalPuffyPlateauClamp,
    { min: 0, max: 1, default: 0.2 },
    "Normals",
    LPType.Normal,
    LPCategory.Texture,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.NormalPuffyStrength] = floatParam(
    LPK.NormalPuffyStrength,
    { min: 0, max: 1, default: 0.1 },
    "Normals",
    LPType.Normal,
    LPCategory.Texture,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread1,
    LPImportance.High,
  );

  // =========================================================================
  // MATERIAL
  // =========================================================================

  params[LPK.MaterialShininess] = floatParam(
    LPK.MaterialShininess,
    { min: 0, max: 1, default: 0.75 },
    "Material",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Spread1,
    LPImportance.High,
  );

  params[LPK.MaterialMetallicness] = floatParam(
    LPK.MaterialMetallicness,
    { min: 0, max: 1, default: 0.1 },
    "Material",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze2,
    LPImportance.Medium,
  );

  params[LPK.MaterialAOStrength] = floatParam(
    LPK.MaterialAOStrength,
    { min: 0, max: 1, default: 0.5 },
    "Material",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread3,
    LPImportance.Low,
  );

  params[LPK.MaterialRimPower] = floatParam(
    LPK.MaterialRimPower,
    { min: 0, max: 1, default: 0 },
    "Material",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze2,
    LPImportance.High,
  );

  params[LPK.MaterialMicrotexAmp] = floatParam(
    LPK.MaterialMicrotexAmp,
    { min: 0, max: 1, default: 0.9 },
    "Material",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze2,
    LPImportance.Medium,
  );

  params[LPK.MaterialRimColor] = hslColorParam(
    LPK.MaterialRimColor,
    {
      h: { min: 0, max: 1, default: 0.33 },
      s: { min: 0.2, max: 0.95, default: 0.6 },
      l: { min: 0.05, max: 0.7, default: 0.5 },
    },
    "Material",
    LPType.Material,
    LPCategory.Texture,
    LPImportance.High,
  );

  // Abaxial (underside)
  params[LPK.AbaxialDarkening] = floatParam(
    LPK.AbaxialDarkening,
    { min: -0.95, max: 0.95, default: 0 },
    "Abaxial",
    LPType.Material,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.AbaxialPurpleTint] = floatParam(
    LPK.AbaxialPurpleTint,
    { min: 0, max: 1, default: 0.1 },
    "Abaxial",
    LPType.Material,
    LPCategory.Color,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.AbaxialHue] = floatParam(
    LPK.AbaxialHue,
    { min: -0.5, max: 0.5, default: 0 },
    "Abaxial",
    LPType.Material,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread1,
    LPImportance.Medium,
  );

  // Height bumps
  params[LPK.VertBumpsPower] = floatParam(
    LPK.VertBumpsPower,
    { min: 0, max: 1, default: 0.3 },
    "Height",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.VertBumpsScale] = floatParam(
    LPK.VertBumpsScale,
    { min: 0, max: 100, default: 30 },
    "Height",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.VertBumpsStretch] = floatParam(
    LPK.VertBumpsStretch,
    { min: 1, max: 5, default: 3 },
    "Height",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze2,
    LPImportance.Medium,
  );

  params[LPK.VertBumpsPower2] = floatParam(
    LPK.VertBumpsPower2,
    { min: 0, max: 1, default: 0.3 },
    "Height",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.VertBumpsScale2] = floatParam(
    LPK.VertBumpsScale2,
    { min: 0, max: 100, default: 30 },
    "Height",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.VertBumpsStretch2] = floatParam(
    LPK.VertBumpsStretch2,
    { min: 1, max: 5, default: 3 },
    "Height",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze2,
    LPImportance.Medium,
  );

  params[LPK.RadialBumpsPower] = floatParam(
    LPK.RadialBumpsPower,
    { min: 0, max: 0.7, default: 0.15 },
    "Height",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.RadialBumpsScale] = floatParam(
    LPK.RadialBumpsScale,
    { min: 0, max: 2, default: 0.5 },
    "Height",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.RadialBumpsLenScale] = floatParam(
    LPK.RadialBumpsLenScale,
    { min: 6, max: 15, default: 10 },
    "Height",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Medium,
  );

  params[LPK.RadialBumpsWidth] = floatParam(
    LPK.RadialBumpsWidth,
    { min: 1, max: 15, default: 3 },
    "Height",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.MaterialHeightAmp] = floatParam(
    LPK.MaterialHeightAmp,
    { min: -1, max: 1, default: 0.25 },
    "Height",
    LPType.Material,
    LPCategory.Texture,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  // Trunk
  params[LPK.TrunkBrowning] = floatParam(
    LPK.TrunkBrowning,
    { min: 0, max: 1, default: 0.2 },
    "Trunk",
    LPType.Material,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.TrunkLightness] = floatParam(
    LPK.TrunkLightness,
    { min: 0, max: 1, default: 0.2 },
    "Trunk",
    LPType.Material,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  // =========================================================================
  // DISTORTION
  // =========================================================================

  params[LPK.DistortionEnabled] = toggleParam(
    LPK.DistortionEnabled,
    true,
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
  );

  params[LPK.DistortCurl] = floatParam(
    LPK.DistortCurl,
    { min: -179, max: 179, default: 0 },
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
    false,
  );

  params[LPK.DistortCurlPoint] = floatParam(
    LPK.DistortCurlPoint,
    { min: 0, max: 1, default: 0.8 },
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
    false,
  );

  params[LPK.DistortCup] = floatParam(
    LPK.DistortCup,
    { min: -1, max: 1, default: 0.2 },
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.DistortCupClamp] = floatParam(
    LPK.DistortCupClamp,
    { min: 0.05, max: 1, default: 0.8 },
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.DistortFlop] = floatParam(
    LPK.DistortFlop,
    { min: 0, max: 90, default: 10 },
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Medium,
  );

  params[LPK.DistortFlopStart] = floatParam(
    LPK.DistortFlopStart,
    { min: 0, max: 0.9, default: 0.5 },
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread2,
    LPImportance.Low,
  );

  params[LPK.DistortWaveAmp] = floatParam(
    LPK.DistortWaveAmp,
    { min: 0, max: 1, default: 0.15 },
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.High,
  );

  params[LPK.DistortWavePeriod] = floatParam(
    LPK.DistortWavePeriod,
    { min: 0, max: 20, default: 4 },
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze1,
    LPImportance.High,
  );

  params[LPK.DistortWaveDepth] = floatParam(
    LPK.DistortWaveDepth,
    { min: 0.1, max: 1, default: 0.55 },
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.DistortWaveDivergance] = floatParam(
    LPK.DistortWaveDivergance,
    { min: 0, max: 1, default: 0.5 },
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.DistortWaveDivergancePeriod] = floatParam(
    LPK.DistortWaveDivergancePeriod,
    { min: 0.25, max: 2, default: 1 },
    "Distort",
    LPType.Distort,
    LPCategory.Distortion,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  // Extrude
  params[LPK.ExtrudeEnabled] = toggleParam(
    LPK.ExtrudeEnabled,
    true,
    "Extrude",
    LPType.Distort,
    LPCategory.LeafShape,
  );

  params[LPK.ExtrudeEdgeDepth] = floatParam(
    LPK.ExtrudeEdgeDepth,
    { min: 0, max: 1, default: 0.2 },
    "Extrude",
    LPType.Distort,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze1,
    LPImportance.Low,
  );

  params[LPK.ExtrudeSuccThicc] = floatParam(
    LPK.ExtrudeSuccThicc,
    { min: 0, max: 1, default: 0.1 },
    "Extrude",
    LPType.Distort,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  // =========================================================================
  // STEM
  // =========================================================================

  params[LPK.StemLength] = floatParam(
    LPK.StemLength,
    { min: 0.3, max: 10, default: 3.5 },
    "Stem",
    LPType.Stem,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze2,
    LPImportance.Medium,
  );

  params[LPK.StemWidth] = floatParam(
    LPK.StemWidth,
    { min: 0.1, max: 1, default: 0.4 },
    "Stem",
    LPType.Stem,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.StemFlop] = floatParam(
    LPK.StemFlop,
    { min: 0, max: 90, default: 20 },
    "Stem",
    LPType.Stem,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze1,
    LPImportance.High,
  );

  params[LPK.StemNeck] = floatParam(
    LPK.StemNeck,
    { min: 0, max: 30, default: 10 },
    "Stem",
    LPType.Stem,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Disable,
  );

  params[LPK.StemAttachmentAngle] = floatParam(
    LPK.StemAttachmentAngle,
    { min: -20, max: 85, default: 15 },
    "Stem",
    LPType.Stem,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  // Stem color
  params[LPK.StemBaseColor] = hslColorParam(
    LPK.StemBaseColor,
    {
      h: { min: 0, max: 1, default: 0.33 },
      s: { min: 0.05, max: 0.95, default: 0.8 },
      l: { min: 0.05, max: 0.75, default: 0.1 },
    },
    "StemColor",
    LPType.Stem,
    LPCategory.Color,
    LPImportance.Medium,
  );

  params[LPK.StemTopColorHue] = floatParam(
    LPK.StemTopColorHue,
    { min: -1, max: 1, default: 0 },
    "StemColor",
    LPType.Stem,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.StemTopColorLit] = floatParam(
    LPK.StemTopColorLit,
    { min: -1, max: 0.75, default: -0.2 },
    "StemColor",
    LPType.Stem,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Low,
  );

  params[LPK.StemTopColorSat] = floatParam(
    LPK.StemTopColorSat,
    { min: -1, max: 1, default: 0 },
    "StemColor",
    LPType.Stem,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread2,
    LPImportance.Low,
  );

  params[LPK.StemColorBias] = floatParam(
    LPK.StemColorBias,
    { min: -1, max: 1, default: 0 },
    "StemColor",
    LPType.Stem,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.StemShine] = floatParam(
    LPK.StemShine,
    { min: 0, max: 1, default: 0.2 },
    "StemColor",
    LPType.Stem,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  params[LPK.StemBaseTexType] = floatParam(
    LPK.StemBaseTexType,
    { min: -1.5, max: 1.5, default: -0.4 },
    "StemColor",
    LPType.Stem,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread2,
    LPImportance.Low,
  );

  params[LPK.StemTopTexType] = floatParam(
    LPK.StemTopTexType,
    { min: -1.5, max: 1.5, default: 0.4 },
    "StemColor",
    LPType.Stem,
    LPCategory.Color,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread2,
    LPImportance.Low,
  );

  // =========================================================================
  // ARRANGEMENT
  // =========================================================================

  params[LPK.LeafCount] = floatParam(
    LPK.LeafCount,
    { min: 1, max: 30, default: 5 },
    "Leaf",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.High,
  );

  params[LPK.LeafScale] = floatParam(
    LPK.LeafScale,
    { min: 0.25, max: 3, default: 1 },
    "Leaf",
    LPType.Arrangement,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Spread2,
    LPImportance.Medium,
  );

  params[LPK.ScaleMin] = floatParam(
    LPK.ScaleMin,
    { min: 0.1, max: 1, default: 0.7 },
    "Leaf",
    LPType.Arrangement,
    LPCategory.LeafShape,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze1,
    LPImportance.Low,
  );

  params[LPK.ScaleRand] = floatParam(
    LPK.ScaleRand,
    { min: 0, max: 1, default: 0.5 },
    "Leaf",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread3,
    LPImportance.Low,
  );

  params[LPK.LeafSkewMax] = floatParam(
    LPK.LeafSkewMax,
    { min: 0, max: 90, default: 30 },
    "Leaf",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread3,
    LPImportance.Low,
  );

  params[LPK.PhysicsAmplification] = floatParam(
    LPK.PhysicsAmplification,
    { min: -1, max: 2, default: 1 },
    "Leaf",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread3,
    LPImportance.Low,
  );

  params[LPK.RotationalSymmetry] = floatParam(
    LPK.RotationalSymmetry,
    { min: 0, max: 7, default: 3.5 },
    "Stem",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Spread3,
    LPImportance.Medium,
  );

  params[LPK.RotationClustering] = floatParam(
    LPK.RotationClustering,
    { min: 0, max: 1, default: 0.4 },
    "Stem",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze1,
    LPImportance.Medium,
  );

  params[LPK.RotationRand] = floatParam(
    LPK.RotationRand,
    { min: 0, max: 1, default: 0.5 },
    "Stem",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Default,
    LPImportance.Medium,
  );

  params[LPK.NodeDistance] = floatParam(
    LPK.NodeDistance,
    { min: 0, max: 3, default: 0.75 },
    "Node",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Medium,
  );

  params[LPK.NodeInitialY] = floatParam(
    LPK.NodeInitialY,
    { min: -2, max: 3, default: 0 },
    "Node",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Low,
  );

  params[LPK.StemLengthIncrease] = floatParam(
    LPK.StemLengthIncrease,
    { min: 0, max: 1, default: 0.5 },
    "StemMod",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Low,
  );

  params[LPK.StemLengthRand] = floatParam(
    LPK.StemLengthRand,
    { min: 0, max: 0.5, default: 0.1 },
    "StemMod",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Low,
  );

  params[LPK.StemFlopLower] = floatParam(
    LPK.StemFlopLower,
    { min: 0, max: 1, default: 25 / 45 },
    "StemMod",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBellLRSplit,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Medium,
  );

  params[LPK.StemFlopRand] = floatParam(
    LPK.StemFlopRand,
    { min: 0, max: 1, default: 0.3 },
    "StemMod",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Low,
  );

  // Trunk
  params[LPK.TrunkWidth] = floatParam(
    LPK.TrunkWidth,
    { min: 0.1, max: 2, default: 0.4 },
    "Trunk",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Spread3,
    LPImportance.Low,
  );

  params[LPK.TrunkLean] = floatParam(
    LPK.TrunkLean,
    { min: 0, max: 45, default: 5 },
    "Trunk",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Low,
  );

  params[LPK.TrunkWobble] = floatParam(
    LPK.TrunkWobble,
    { min: 0, max: 1, default: 0.2 },
    "Trunk",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Squeeze3,
    LPImportance.Low,
  );

  params[LPK.PotScale] = floatParam(
    LPK.PotScale,
    { min: 0.5, max: 3, default: 1 },
    "Pot",
    LPType.Arrangement,
    LPCategory.Arrangement,
    LPRandomValCurve.CenterBell,
    LPRandomValCenterBias.Default,
    LPImportance.Low,
  );

  return params as LeafParamDict;
}

// =============================================================================
// PARAM UTILITIES
// =============================================================================

/**
 * Get the value of a parameter
 */
export function getParamValue(params: LeafParamDict, key: LPK): number {
  const param = params[key];
  return param.enabled ? param.value : param.range.default;
}

/**
 * Get the color value of a parameter
 */
export function getParamColorValue(params: LeafParamDict, key: LPK): HSLColor {
  const param = params[key];
  if (param.hasColorValue && param.colorValue) {
    return param.colorValue;
  }
  return { h: 0.33, s: 0.8, l: 0.2 }; // Default green
}

/**
 * Set a parameter value
 */
export function setParamValue(
  params: LeafParamDict,
  key: LPK,
  value: number,
): void {
  const param = params[key];
  param.value = Math.max(param.range.min, Math.min(param.range.max, value));
  param.enabled = true;
}

/**
 * Set a color parameter value
 */
export function setParamColorValue(
  params: LeafParamDict,
  key: LPK,
  color: HSLColor,
): void {
  const param = params[key];
  if (param.hasColorValue) {
    param.colorValue = { ...color };
    param.enabled = true;
  }
}

/**
 * Copy parameter values from one dict to another
 */
export function copyParamValues(
  source: LeafParamDict,
  target: LeafParamDict,
): void {
  for (const key of Object.values(LPK)) {
    const sourceParam = source[key];
    const targetParam = target[key];

    targetParam.value = sourceParam.value;
    targetParam.enabled = sourceParam.enabled;
    if (sourceParam.hasColorValue && sourceParam.colorValue) {
      targetParam.colorValue = { ...sourceParam.colorValue };
    }
  }
}

/**
 * Clone a parameter dictionary
 */
export function cloneParams(params: LeafParamDict): LeafParamDict {
  const clone = createDefaultParams();
  copyParamValues(params, clone);
  return clone;
}
