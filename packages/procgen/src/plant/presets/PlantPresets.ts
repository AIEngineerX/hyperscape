/**
 * PlantPresets - Predefined plant configurations
 *
 * Contains all 30+ plant species presets based on the Unity
 * Procedural-Plant-and-Foliage-Generator.
 */

import type {
  PlantPreset,
  PlantPresetName,
  LeafParamDict,
  HSLColor,
} from "../types.js";
import { LPK } from "../types.js";
import {
  createDefaultParams,
  setParamValue,
  setParamColorValue,
} from "../params/LeafParamDefaults.js";

// =============================================================================
// PRESET DEFINITIONS
// =============================================================================

/**
 * Gloriosum (Philodendron gloriosum) - heart-shaped velvety leaves
 */
const gloriosum: PlantPreset = {
  name: "gloriosum",
  displayName: "Philodendron Gloriosum",
  params: {
    [LPK.Length]: 8,
    [LPK.Width]: 5,
    [LPK.Heart]: 0.8,
    [LPK.SinusHeight]: 2,
    [LPK.SinusSheer]: 0.5,
    [LPK.TipAngle]: 30,
    [LPK.TipAmplitude]: 2,
    [LPK.VeinDensity]: 0.6,
    [LPK.MidribThickness]: 0.08,
    [LPK.SecondaryThickness]: 0.04,
    [LPK.TexBaseColor]: { h: 0.35, s: 0.6, l: 0.2 },
    [LPK.TexVeinColor]: { h: 0.38, s: 0.3, l: 0.5 },
    [LPK.MaterialShininess]: 0.3,
    [LPK.DistortCup]: 0.15,
    [LPK.DistortWaveAmp]: 0.1,
    [LPK.DistortWavePeriod]: 5,
    [LPK.LeafCount]: 5,
    [LPK.StemLength]: 4,
    [LPK.StemFlop]: 25,
  },
};

/**
 * Monstera (Monstera deliciosa) - iconic split leaves
 */
const monstera: PlantPreset = {
  name: "monstera",
  displayName: "Monstera Deliciosa",
  params: {
    [LPK.Length]: 10,
    [LPK.Width]: 7,
    [LPK.Heart]: 0.7,
    [LPK.SinusHeight]: 1.5,
    [LPK.Lobes]: 0.6,
    [LPK.LobeAmplitude]: 0.5,
    [LPK.TipAngle]: 25,
    [LPK.TipAmplitude]: 1.5,
    [LPK.VeinDensity]: 0.5,
    [LPK.VeinSplit]: 0.6,
    [LPK.TexBaseColor]: { h: 0.32, s: 0.7, l: 0.25 },
    [LPK.TexVeinColor]: { h: 0.34, s: 0.5, l: 0.35 },
    [LPK.MaterialShininess]: 0.6,
    [LPK.DistortCup]: -0.1,
    [LPK.DistortWaveAmp]: 0.05,
    [LPK.LeafCount]: 6,
    [LPK.StemLength]: 5,
    [LPK.StemFlop]: 8,
  },
};

/**
 * Pothos (Epipremnum aureum) - trailing heart leaves
 */
const pothos: PlantPreset = {
  name: "pothos",
  displayName: "Golden Pothos",
  params: {
    [LPK.Length]: 5,
    [LPK.Width]: 3.5,
    [LPK.Heart]: 0.9,
    [LPK.SinusHeight]: 1.8,
    [LPK.TipAngle]: 40,
    [LPK.TipAmplitude]: 1.8,
    [LPK.VeinDensity]: 0.4,
    [LPK.TexBaseColor]: { h: 0.28, s: 0.65, l: 0.3 },
    [LPK.TexVeinColor]: { h: 0.15, s: 0.5, l: 0.45 },
    [LPK.TexRadiance]: 0.4,
    [LPK.TexRadianceHue]: 0.1,
    [LPK.MaterialShininess]: 0.5,
    [LPK.DistortCup]: 0.1,
    [LPK.LeafCount]: 8,
    [LPK.StemLength]: 3,
    [LPK.StemFlop]: 35,
  },
};

/**
 * Philodendron - classic tropical foliage
 */
const philodendron: PlantPreset = {
  name: "philodendron",
  displayName: "Philodendron",
  params: {
    [LPK.Length]: 7,
    [LPK.Width]: 4,
    [LPK.Heart]: 0.85,
    [LPK.SinusHeight]: 1.6,
    [LPK.TipAngle]: 35,
    [LPK.TipAmplitude]: 2,
    [LPK.VeinDensity]: 0.5,
    [LPK.TexBaseColor]: { h: 0.33, s: 0.75, l: 0.2 },
    [LPK.TexVeinColor]: { h: 0.35, s: 0.4, l: 0.3 },
    [LPK.MaterialShininess]: 0.65,
    [LPK.DistortCup]: 0.08,
    [LPK.DistortFlop]: 12,
    [LPK.LeafCount]: 6,
    [LPK.StemLength]: 4,
    [LPK.StemFlop]: 20,
  },
};

/**
 * Alocasia (Elephant Ear) - dramatic arrow-shaped leaves
 */
const alocasia: PlantPreset = {
  name: "alocasia",
  displayName: "Alocasia",
  params: {
    [LPK.Length]: 12,
    [LPK.Width]: 6,
    [LPK.Sheer]: 0.3,
    [LPK.Heart]: 0.5,
    [LPK.SinusHeight]: 0.8,
    [LPK.TipAngle]: 20,
    [LPK.TipAmplitude]: 3,
    [LPK.VeinDensity]: 0.7,
    [LPK.MidribThickness]: 0.1,
    [LPK.TexBaseColor]: { h: 0.35, s: 0.55, l: 0.18 },
    [LPK.TexVeinColor]: { h: 0.38, s: 0.4, l: 0.5 },
    [LPK.TexVeinOpacity]: 0.9,
    [LPK.MaterialShininess]: 0.7,
    [LPK.DistortCup]: 0.2,
    [LPK.DistortWaveAmp]: 0.08,
    [LPK.LeafCount]: 4,
    [LPK.StemLength]: 6,
    [LPK.StemFlop]: 10,
  },
};

/**
 * Calathea - patterned prayer plant
 */
const calathea: PlantPreset = {
  name: "calathea",
  displayName: "Calathea",
  params: {
    [LPK.Length]: 6,
    [LPK.Width]: 3,
    [LPK.Sheer]: 0.2,
    [LPK.TipAngle]: 30,
    [LPK.TipAmplitude]: 1.5,
    [LPK.VeinDensity]: 0.8,
    [LPK.SecondaryThickness]: 0.03,
    [LPK.TexBaseColor]: { h: 0.34, s: 0.5, l: 0.22 },
    [LPK.TexVeinColor]: { h: 0.36, s: 0.3, l: 0.35 },
    [LPK.TexRadiance]: 0.5,
    [LPK.TexRadianceHue]: -0.05,
    [LPK.AbaxialPurpleTint]: 0.4,
    [LPK.MaterialShininess]: 0.4,
    [LPK.DistortCup]: 0.05,
    [LPK.DistortWaveAmp]: 0.12,
    [LPK.DistortWavePeriod]: 6,
    [LPK.LeafCount]: 7,
    [LPK.StemLength]: 3.5,
    [LPK.StemFlop]: 15,
  },
};

/**
 * Anthurium - waxy heart-shaped spathe
 */
const anthurium: PlantPreset = {
  name: "anthurium",
  displayName: "Anthurium",
  params: {
    [LPK.Length]: 6,
    [LPK.Width]: 5,
    [LPK.Heart]: 0.95,
    [LPK.SinusHeight]: 2.2,
    [LPK.SinusSheer]: 0.6,
    [LPK.TipAngle]: 25,
    [LPK.TipAmplitude]: 2.5,
    [LPK.VeinDensity]: 0.3,
    [LPK.TexBaseColor]: { h: 0.33, s: 0.65, l: 0.25 },
    [LPK.TexVeinColor]: { h: 0.35, s: 0.4, l: 0.35 },
    [LPK.MaterialShininess]: 0.85,
    [LPK.MaterialMetallicness]: 0.15,
    [LPK.DistortCup]: -0.05,
    [LPK.LeafCount]: 5,
    [LPK.StemLength]: 4,
    [LPK.StemFlop]: 18,
  },
};

/**
 * Aglaonema (Chinese Evergreen)
 */
const aglaonema: PlantPreset = {
  name: "aglaonema",
  displayName: "Chinese Evergreen",
  params: {
    [LPK.Length]: 7,
    [LPK.Width]: 3.5,
    [LPK.Sheer]: 0.25,
    [LPK.TipAngle]: 35,
    [LPK.TipAmplitude]: 1.8,
    [LPK.VeinDensity]: 0.5,
    [LPK.TexBaseColor]: { h: 0.32, s: 0.55, l: 0.28 },
    [LPK.TexVeinColor]: { h: 0.35, s: 0.3, l: 0.4 },
    [LPK.TexRadiance]: 0.3,
    [LPK.TexRadianceHue]: 0.08,
    [LPK.MaterialShininess]: 0.5,
    [LPK.DistortCup]: 0.1,
    [LPK.DistortWaveAmp]: 0.06,
    [LPK.LeafCount]: 8,
    [LPK.StemLength]: 2.5,
    [LPK.StemFlop]: 22,
  },
};

/**
 * Dieffenbachia (Dumb Cane)
 */
const dieffenbachia: PlantPreset = {
  name: "dieffenbachia",
  displayName: "Dumb Cane",
  params: {
    [LPK.Length]: 9,
    [LPK.Width]: 4.5,
    [LPK.Sheer]: 0.15,
    [LPK.TipAngle]: 28,
    [LPK.TipAmplitude]: 2,
    [LPK.VeinDensity]: 0.45,
    [LPK.TexBaseColor]: { h: 0.3, s: 0.6, l: 0.3 },
    [LPK.TexVeinColor]: { h: 0.32, s: 0.35, l: 0.45 },
    [LPK.TexRadiance]: 0.5,
    [LPK.TexRadianceHue]: 0.12,
    [LPK.MaterialShininess]: 0.55,
    [LPK.DistortCup]: 0.12,
    [LPK.DistortWaveAmp]: 0.04,
    [LPK.LeafCount]: 7,
    [LPK.StemLength]: 3,
    [LPK.StemFlop]: 20,
  },
};

/**
 * Spathiphyllum (Peace Lily)
 */
const spathiphyllum: PlantPreset = {
  name: "spathiphyllum",
  displayName: "Peace Lily",
  params: {
    [LPK.Length]: 8,
    [LPK.Width]: 3,
    [LPK.Sheer]: 0.4,
    [LPK.TipAngle]: 20,
    [LPK.TipAmplitude]: 2.5,
    [LPK.VeinDensity]: 0.55,
    [LPK.TexBaseColor]: { h: 0.34, s: 0.7, l: 0.22 },
    [LPK.TexVeinColor]: { h: 0.36, s: 0.45, l: 0.32 },
    [LPK.MaterialShininess]: 0.7,
    [LPK.DistortCup]: 0.08,
    [LPK.DistortFlop]: 8,
    [LPK.LeafCount]: 9,
    [LPK.StemLength]: 4.5,
    [LPK.StemFlop]: 12,
  },
};

/**
 * Syngonium (Arrowhead Plant)
 */
const syngonium: PlantPreset = {
  name: "syngonium",
  displayName: "Arrowhead Plant",
  params: {
    [LPK.Length]: 5,
    [LPK.Width]: 4,
    [LPK.Heart]: 0.6,
    [LPK.SinusHeight]: 1.2,
    [LPK.Lobes]: 0.4,
    [LPK.TipAngle]: 30,
    [LPK.TipAmplitude]: 2,
    [LPK.VeinDensity]: 0.4,
    [LPK.TexBaseColor]: { h: 0.31, s: 0.6, l: 0.28 },
    [LPK.TexVeinColor]: { h: 0.34, s: 0.35, l: 0.4 },
    [LPK.MaterialShininess]: 0.5,
    [LPK.DistortCup]: 0.1,
    [LPK.LeafCount]: 7,
    [LPK.StemLength]: 3,
    [LPK.StemFlop]: 25,
  },
};

/**
 * Caladium - colorful heart-shaped
 */
const caladium: PlantPreset = {
  name: "caladium",
  displayName: "Caladium",
  params: {
    [LPK.Length]: 6,
    [LPK.Width]: 5,
    [LPK.Heart]: 0.9,
    [LPK.SinusHeight]: 2,
    [LPK.SinusSheer]: 0.4,
    [LPK.TipAngle]: 35,
    [LPK.TipAmplitude]: 1.5,
    [LPK.VeinDensity]: 0.5,
    [LPK.TexBaseColor]: { h: 0.35, s: 0.5, l: 0.35 },
    [LPK.TexVeinColor]: { h: 0.0, s: 0.6, l: 0.4 },
    [LPK.TexRadiance]: 0.6,
    [LPK.TexRadianceHue]: -0.3,
    [LPK.MaterialShininess]: 0.35,
    [LPK.DistortCup]: 0.05,
    [LPK.DistortWaveAmp]: 0.08,
    [LPK.LeafCount]: 6,
    [LPK.StemLength]: 4,
    [LPK.StemFlop]: 28,
  },
};

/**
 * Colocasia (Taro)
 */
const colocasia: PlantPreset = {
  name: "colocasia",
  displayName: "Taro",
  params: {
    [LPK.Length]: 14,
    [LPK.Width]: 10,
    [LPK.Heart]: 0.75,
    [LPK.SinusHeight]: 1.8,
    [LPK.TipAngle]: 25,
    [LPK.TipAmplitude]: 2.5,
    [LPK.VeinDensity]: 0.6,
    [LPK.MidribThickness]: 0.12,
    [LPK.TexBaseColor]: { h: 0.33, s: 0.55, l: 0.22 },
    [LPK.TexVeinColor]: { h: 0.35, s: 0.35, l: 0.35 },
    [LPK.MaterialShininess]: 0.45,
    [LPK.DistortCup]: 0.15,
    [LPK.DistortFlop]: 15,
    [LPK.LeafCount]: 4,
    [LPK.LeafScale]: 1.3,
    [LPK.StemLength]: 8,
    [LPK.StemFlop]: 18,
  },
};

/**
 * Xanthosoma (Elephant Ear variant)
 */
const xanthosoma: PlantPreset = {
  name: "xanthosoma",
  displayName: "Xanthosoma",
  params: {
    [LPK.Length]: 11,
    [LPK.Width]: 7,
    [LPK.Heart]: 0.65,
    [LPK.SinusHeight]: 1.4,
    [LPK.TipAngle]: 22,
    [LPK.TipAmplitude]: 2.8,
    [LPK.VeinDensity]: 0.55,
    [LPK.TexBaseColor]: { h: 0.34, s: 0.6, l: 0.2 },
    [LPK.TexVeinColor]: { h: 0.36, s: 0.4, l: 0.38 },
    [LPK.MaterialShininess]: 0.5,
    [LPK.DistortCup]: 0.12,
    [LPK.DistortWaveAmp]: 0.06,
    [LPK.LeafCount]: 5,
    [LPK.StemLength]: 6,
    [LPK.StemFlop]: 20,
  },
};

/**
 * Arum (Lords and Ladies)
 */
const arum: PlantPreset = {
  name: "arum",
  displayName: "Arum",
  params: {
    [LPK.Length]: 7,
    [LPK.Width]: 4.5,
    [LPK.Heart]: 0.7,
    [LPK.SinusHeight]: 1.5,
    [LPK.TipAngle]: 28,
    [LPK.TipAmplitude]: 2,
    [LPK.VeinDensity]: 0.45,
    [LPK.TexBaseColor]: { h: 0.35, s: 0.65, l: 0.25 },
    [LPK.TexVeinColor]: { h: 0.37, s: 0.4, l: 0.35 },
    [LPK.MaterialShininess]: 0.55,
    [LPK.DistortCup]: 0.08,
    [LPK.LeafCount]: 5,
    [LPK.StemLength]: 4,
    [LPK.StemFlop]: 22,
  },
};

/**
 * Calla (Calla Lily)
 */
const calla: PlantPreset = {
  name: "calla",
  displayName: "Calla Lily",
  params: {
    [LPK.Length]: 8,
    [LPK.Width]: 4,
    [LPK.Sheer]: 0.35,
    [LPK.TipAngle]: 22,
    [LPK.TipAmplitude]: 2.2,
    [LPK.VeinDensity]: 0.5,
    [LPK.TexBaseColor]: { h: 0.34, s: 0.7, l: 0.23 },
    [LPK.TexVeinColor]: { h: 0.36, s: 0.45, l: 0.32 },
    [LPK.MaterialShininess]: 0.65,
    [LPK.DistortCup]: 0.06,
    [LPK.DistortFlop]: 10,
    [LPK.LeafCount]: 6,
    [LPK.StemLength]: 5,
    [LPK.StemFlop]: 15,
  },
};

/**
 * Zamioculcas (ZZ Plant)
 */
const zamioculcas: PlantPreset = {
  name: "zamioculcas",
  displayName: "ZZ Plant",
  params: {
    [LPK.Length]: 4,
    [LPK.Width]: 2,
    [LPK.Sheer]: 0.2,
    [LPK.TipAngle]: 30,
    [LPK.TipAmplitude]: 1.2,
    [LPK.VeinDensity]: 0.3,
    [LPK.TexBaseColor]: { h: 0.33, s: 0.8, l: 0.18 },
    [LPK.TexVeinColor]: { h: 0.35, s: 0.5, l: 0.25 },
    [LPK.MaterialShininess]: 0.85,
    [LPK.MaterialMetallicness]: 0.1,
    [LPK.DistortCup]: 0.03,
    [LPK.LeafCount]: 12,
    [LPK.LeafScale]: 0.7,
    [LPK.StemLength]: 1.5,
    [LPK.StemFlop]: 5,
  },
};

/**
 * Maranta (Prayer Plant)
 */
const maranta: PlantPreset = {
  name: "maranta",
  displayName: "Prayer Plant",
  params: {
    [LPK.Length]: 5,
    [LPK.Width]: 3,
    [LPK.Sheer]: 0.15,
    [LPK.TipAngle]: 35,
    [LPK.TipAmplitude]: 1.3,
    [LPK.VeinDensity]: 0.7,
    [LPK.TexBaseColor]: { h: 0.32, s: 0.55, l: 0.25 },
    [LPK.TexVeinColor]: { h: 0.35, s: 0.3, l: 0.4 },
    [LPK.TexRadiance]: 0.4,
    [LPK.TexRadianceHue]: 0.05,
    [LPK.AbaxialPurpleTint]: 0.5,
    [LPK.MaterialShininess]: 0.4,
    [LPK.DistortCup]: 0.04,
    [LPK.DistortWaveAmp]: 0.05,
    [LPK.LeafCount]: 8,
    [LPK.StemLength]: 2.5,
    [LPK.StemFlop]: 15,
  },
};

/**
 * Stromanthe (Triostar)
 */
const stromanthe: PlantPreset = {
  name: "stromanthe",
  displayName: "Stromanthe",
  params: {
    [LPK.Length]: 6,
    [LPK.Width]: 2.5,
    [LPK.Sheer]: 0.25,
    [LPK.TipAngle]: 32,
    [LPK.TipAmplitude]: 1.5,
    [LPK.VeinDensity]: 0.6,
    [LPK.TexBaseColor]: { h: 0.33, s: 0.5, l: 0.3 },
    [LPK.TexVeinColor]: { h: 0.35, s: 0.35, l: 0.4 },
    [LPK.TexRadiance]: 0.5,
    [LPK.TexRadianceHue]: -0.08,
    [LPK.AbaxialPurpleTint]: 0.6,
    [LPK.MaterialShininess]: 0.45,
    [LPK.DistortCup]: 0.06,
    [LPK.LeafCount]: 7,
    [LPK.StemLength]: 3,
    [LPK.StemFlop]: 25,
  },
};

/**
 * Ctenanthe (Never Never Plant)
 */
const ctenanthe: PlantPreset = {
  name: "ctenanthe",
  displayName: "Never Never Plant",
  params: {
    [LPK.Length]: 5.5,
    [LPK.Width]: 2.8,
    [LPK.Sheer]: 0.2,
    [LPK.TipAngle]: 30,
    [LPK.TipAmplitude]: 1.4,
    [LPK.VeinDensity]: 0.65,
    [LPK.TexBaseColor]: { h: 0.32, s: 0.55, l: 0.28 },
    [LPK.TexVeinColor]: { h: 0.34, s: 0.4, l: 0.38 },
    [LPK.TexRadiance]: 0.35,
    [LPK.AbaxialPurpleTint]: 0.45,
    [LPK.MaterialShininess]: 0.42,
    [LPK.DistortCup]: 0.05,
    [LPK.DistortWaveAmp]: 0.04,
    [LPK.LeafCount]: 9,
    [LPK.StemLength]: 2.8,
    [LPK.StemFlop]: 28,
  },
};

/**
 * Ficus (Rubber Tree)
 */
const ficus: PlantPreset = {
  name: "ficus",
  displayName: "Rubber Tree",
  params: {
    [LPK.Length]: 7,
    [LPK.Width]: 3.5,
    [LPK.Sheer]: 0.18,
    [LPK.TipAngle]: 25,
    [LPK.TipAmplitude]: 2,
    [LPK.VeinDensity]: 0.35,
    [LPK.MidribThickness]: 0.1,
    [LPK.TexBaseColor]: { h: 0.35, s: 0.75, l: 0.15 },
    [LPK.TexVeinColor]: { h: 0.36, s: 0.5, l: 0.3 },
    [LPK.MaterialShininess]: 0.8,
    [LPK.MaterialMetallicness]: 0.08,
    [LPK.ExtrudeSuccThicc]: 0.15,
    [LPK.DistortCup]: 0.04,
    [LPK.LeafCount]: 8,
    [LPK.StemLength]: 1.5,
    [LPK.StemFlop]: 8,
  },
};

/**
 * Schefflera (Umbrella Plant)
 */
const schefflera: PlantPreset = {
  name: "schefflera",
  displayName: "Umbrella Plant",
  params: {
    [LPK.Length]: 6,
    [LPK.Width]: 2,
    [LPK.Sheer]: 0.3,
    [LPK.TipAngle]: 28,
    [LPK.TipAmplitude]: 1.8,
    [LPK.VeinDensity]: 0.4,
    [LPK.TexBaseColor]: { h: 0.33, s: 0.7, l: 0.22 },
    [LPK.TexVeinColor]: { h: 0.35, s: 0.45, l: 0.32 },
    [LPK.MaterialShininess]: 0.6,
    [LPK.DistortCup]: 0.06,
    [LPK.DistortFlop]: 5,
    [LPK.LeafCount]: 7,
    [LPK.RotationalSymmetry]: 7,
    [LPK.StemLength]: 2,
    [LPK.StemFlop]: 45,
  },
};

/**
 * Fatsia (Japanese Aralia)
 */
const fatsia: PlantPreset = {
  name: "fatsia",
  displayName: "Japanese Aralia",
  params: {
    [LPK.Length]: 10,
    [LPK.Width]: 8,
    [LPK.Lobes]: 0.8,
    [LPK.LobeAmplitude]: 0.7,
    [LPK.LobeTilt]: 15,
    [LPK.TipAngle]: 35,
    [LPK.TipAmplitude]: 1.5,
    [LPK.VeinDensity]: 0.5,
    [LPK.TexBaseColor]: { h: 0.33, s: 0.65, l: 0.2 },
    [LPK.TexVeinColor]: { h: 0.35, s: 0.4, l: 0.35 },
    [LPK.MaterialShininess]: 0.55,
    [LPK.DistortCup]: 0.08,
    [LPK.DistortWaveAmp]: 0.06,
    [LPK.LeafCount]: 5,
    [LPK.StemLength]: 5,
    [LPK.StemFlop]: 15,
  },
};

/**
 * Polyscias (Aralia Ming)
 */
const polyscias: PlantPreset = {
  name: "polyscias",
  displayName: "Ming Aralia",
  params: {
    [LPK.Length]: 4,
    [LPK.Width]: 3,
    [LPK.Lobes]: 0.6,
    [LPK.LobeAmplitude]: 0.5,
    [LPK.TipAngle]: 38,
    [LPK.TipAmplitude]: 1,
    [LPK.VeinDensity]: 0.45,
    [LPK.TexBaseColor]: { h: 0.32, s: 0.6, l: 0.25 },
    [LPK.TexVeinColor]: { h: 0.34, s: 0.35, l: 0.38 },
    [LPK.MaterialShininess]: 0.5,
    [LPK.DistortCup]: 0.05,
    [LPK.DistortWaveAmp]: 0.08,
    [LPK.LeafCount]: 10,
    [LPK.LeafScale]: 0.8,
    [LPK.StemLength]: 2,
    [LPK.StemFlop]: 20,
  },
};

/**
 * Aralia (General)
 */
const aralia: PlantPreset = {
  name: "aralia",
  displayName: "Aralia",
  params: {
    [LPK.Length]: 5,
    [LPK.Width]: 4,
    [LPK.Lobes]: 0.5,
    [LPK.LobeAmplitude]: 0.45,
    [LPK.TipAngle]: 32,
    [LPK.TipAmplitude]: 1.2,
    [LPK.VeinDensity]: 0.5,
    [LPK.TexBaseColor]: { h: 0.33, s: 0.58, l: 0.24 },
    [LPK.TexVeinColor]: { h: 0.35, s: 0.38, l: 0.36 },
    [LPK.MaterialShininess]: 0.48,
    [LPK.DistortCup]: 0.06,
    [LPK.DistortWaveAmp]: 0.05,
    [LPK.LeafCount]: 8,
    [LPK.StemLength]: 3,
    [LPK.StemFlop]: 22,
  },
};

/**
 * Hosta - shade-loving perennial
 */
const hosta: PlantPreset = {
  name: "hosta",
  displayName: "Hosta",
  params: {
    [LPK.Length]: 8,
    [LPK.Width]: 5,
    [LPK.Sheer]: 0.22,
    [LPK.Heart]: 0.4,
    [LPK.TipAngle]: 30,
    [LPK.TipAmplitude]: 2,
    [LPK.VeinDensity]: 0.7,
    [LPK.VeinBunching]: 2.5,
    [LPK.TexBaseColor]: { h: 0.34, s: 0.5, l: 0.32 },
    [LPK.TexVeinColor]: { h: 0.36, s: 0.35, l: 0.42 },
    [LPK.MaterialShininess]: 0.35,
    [LPK.DistortCup]: 0.1,
    [LPK.DistortWaveAmp]: 0.1,
    [LPK.DistortWavePeriod]: 8,
    [LPK.LeafCount]: 10,
    [LPK.StemLength]: 3,
    [LPK.StemFlop]: 35,
  },
};

/**
 * Heuchera (Coral Bells)
 */
const heuchera: PlantPreset = {
  name: "heuchera",
  displayName: "Coral Bells",
  params: {
    [LPK.Length]: 4,
    [LPK.Width]: 5,
    [LPK.Heart]: 0.85,
    [LPK.SinusHeight]: 1.8,
    [LPK.Lobes]: 0.3,
    [LPK.TipAngle]: 40,
    [LPK.TipAmplitude]: 1,
    [LPK.VeinDensity]: 0.55,
    [LPK.TexBaseColor]: { h: 0.0, s: 0.4, l: 0.3 },
    [LPK.TexVeinColor]: { h: 0.95, s: 0.35, l: 0.4 },
    [LPK.MaterialShininess]: 0.3,
    [LPK.DistortCup]: 0.04,
    [LPK.DistortWaveAmp]: 0.06,
    [LPK.LeafCount]: 12,
    [LPK.LeafScale]: 0.75,
    [LPK.StemLength]: 3,
    [LPK.StemFlop]: 40,
  },
};

/**
 * Brunnera (Siberian Bugloss)
 */
const brunnera: PlantPreset = {
  name: "brunnera",
  displayName: "Siberian Bugloss",
  params: {
    [LPK.Length]: 5,
    [LPK.Width]: 5.5,
    [LPK.Heart]: 0.9,
    [LPK.SinusHeight]: 2.2,
    [LPK.TipAngle]: 35,
    [LPK.TipAmplitude]: 1.2,
    [LPK.VeinDensity]: 0.5,
    [LPK.TexBaseColor]: { h: 0.33, s: 0.45, l: 0.35 },
    [LPK.TexVeinColor]: { h: 0.35, s: 0.3, l: 0.45 },
    [LPK.TexRadiance]: 0.4,
    [LPK.TexRadianceHue]: 0.5,
    [LPK.MaterialShininess]: 0.32,
    [LPK.DistortCup]: 0.05,
    [LPK.LeafCount]: 8,
    [LPK.StemLength]: 4,
    [LPK.StemFlop]: 35,
  },
};

/**
 * Pulmonaria (Lungwort)
 */
const pulmonaria: PlantPreset = {
  name: "pulmonaria",
  displayName: "Lungwort",
  params: {
    [LPK.Length]: 6,
    [LPK.Width]: 3,
    [LPK.Sheer]: 0.28,
    [LPK.TipAngle]: 28,
    [LPK.TipAmplitude]: 1.6,
    [LPK.VeinDensity]: 0.45,
    [LPK.TexBaseColor]: { h: 0.35, s: 0.5, l: 0.28 },
    [LPK.TexVeinColor]: { h: 0.37, s: 0.35, l: 0.38 },
    [LPK.TexRadiance]: 0.5,
    [LPK.TexRadianceHue]: 0.55,
    [LPK.MaterialShininess]: 0.28,
    [LPK.DistortCup]: 0.06,
    [LPK.DistortWaveAmp]: 0.04,
    [LPK.LeafCount]: 10,
    [LPK.StemLength]: 2.5,
    [LPK.StemFlop]: 32,
  },
};

/**
 * Bergenia (Elephant's Ears)
 */
const bergenia: PlantPreset = {
  name: "bergenia",
  displayName: "Elephant's Ears",
  params: {
    [LPK.Length]: 7,
    [LPK.Width]: 6,
    [LPK.Heart]: 0.5,
    [LPK.Sheer]: 0.15,
    [LPK.TipAngle]: 35,
    [LPK.TipAmplitude]: 1.5,
    [LPK.VeinDensity]: 0.4,
    [LPK.TexBaseColor]: { h: 0.34, s: 0.55, l: 0.25 },
    [LPK.TexVeinColor]: { h: 0.36, s: 0.4, l: 0.35 },
    [LPK.ExtrudeSuccThicc]: 0.12,
    [LPK.MaterialShininess]: 0.6,
    [LPK.DistortCup]: 0.08,
    [LPK.DistortWaveAmp]: 0.05,
    [LPK.LeafCount]: 6,
    [LPK.StemLength]: 4,
    [LPK.StemFlop]: 25,
  },
};

// =============================================================================
// PRESET REGISTRY
// =============================================================================

/**
 * All available presets
 */
export const PRESETS: Record<PlantPresetName, PlantPreset> = {
  gloriosum,
  monstera,
  pothos,
  philodendron,
  alocasia,
  calathea,
  anthurium,
  aglaonema,
  dieffenbachia,
  spathiphyllum,
  syngonium,
  caladium,
  colocasia,
  xanthosoma,
  arum,
  calla,
  zamioculcas,
  maranta,
  stromanthe,
  ctenanthe,
  ficus,
  schefflera,
  fatsia,
  polyscias,
  aralia,
  hosta,
  heuchera,
  brunnera,
  pulmonaria,
  bergenia,
};

/**
 * Get all preset names
 */
export function getPresetNames(): PlantPresetName[] {
  return Object.keys(PRESETS) as PlantPresetName[];
}

/**
 * Get a preset by name
 */
export function getPreset(name: PlantPresetName): PlantPreset {
  return PRESETS[name];
}

/**
 * Apply a preset to a parameter dictionary
 */
export function applyPreset(params: LeafParamDict, preset: PlantPreset): void {
  for (const [key, value] of Object.entries(preset.params)) {
    const lpk = key as LPK;
    if (typeof value === "number") {
      setParamValue(params, lpk, value);
    } else {
      setParamColorValue(params, lpk, value as HSLColor);
    }
  }
}

/**
 * Create parameters from a preset
 */
export function createParamsFromPreset(
  presetName: PlantPresetName,
): LeafParamDict {
  const params = createDefaultParams();
  const preset = getPreset(presetName);
  applyPreset(params, preset);
  return params;
}
