/**
 * Standalone Module
 *
 * Provides isolation layer for running procgen systems outside of
 * the full game engine. Used by Asset Forge for previewing grass,
 * flowers, terrain, and other procedural content.
 *
 * @module Standalone
 */

export {
  StandaloneContext,
  createGraphicsStub,
  createTerrainStub,
  type StandaloneContextConfig,
  type StandaloneSystem,
  type StandaloneCamera,
  type StandaloneStage,
} from "./StandaloneContext.js";
