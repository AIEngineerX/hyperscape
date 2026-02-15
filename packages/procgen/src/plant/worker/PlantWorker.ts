/**
 * PlantWorker - Web Worker for heavy computation
 *
 * Offloads expensive operations like mesh generation and distortion
 * to a background thread.
 */

import type {
  WorkerMeshRequest,
  WorkerDistortRequest,
  WorkerTextureRequest,
  WorkerResponse,
} from "../types.js";
import { generateLeafShape } from "../shape/LeafShape.js";
import { generateLeafVeins, getMidrib } from "../veins/LeafVeins.js";
import { triangulateLeaf } from "../mesh/Triangulation.js";
import { extrudeLeafMesh } from "../mesh/Extrusion.js";
import { applyDistortions } from "../distortion/LeafDistortion.js";

// =============================================================================
// WORKER MESSAGE HANDLER
// =============================================================================

type WorkerRequest =
  | WorkerMeshRequest
  | WorkerDistortRequest
  | WorkerTextureRequest;

/**
 * Handle incoming messages
 */
function handleMessage(event: MessageEvent<WorkerRequest>): void {
  const request = event.data;

  switch (request.type) {
    case "generateMesh":
      handleMeshGeneration(request);
      break;
    case "distort":
      handleDistortion(request);
      break;
    case "generateTexture":
      handleTextureGeneration(request);
      break;
  }
}

/**
 * Handle mesh generation request
 */
function handleMeshGeneration(request: WorkerMeshRequest): void {
  const { id, params, quality, seed } = request;

  const lineSteps = quality === "Maximum" ? 15 : quality === "Medium" ? 10 : 6;

  // Generate shape
  const shape = generateLeafShape(params);

  // Generate veins
  const veins = generateLeafVeins(shape, params, seed);
  const midrib = getMidrib(veins);

  // Triangulate
  let mesh = triangulateLeaf(shape.curves, {
    lineSteps,
    addInternalPoints: true,
  });

  // Extrude
  mesh = extrudeLeafMesh(mesh, params);

  // Apply distortions if midrib exists
  if (midrib) {
    mesh = applyDistortions(mesh, midrib, params, seed);
  }

  const response: WorkerResponse = {
    type: "result",
    id,
    data: mesh,
  };

  self.postMessage(response);
}

/**
 * Convert Float32Array of vertex positions to Point3D[]
 */
function float32ToPoint3DArray(
  vertices: Float32Array,
): { x: number; y: number; z: number }[] {
  const points: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < vertices.length; i += 3) {
    points.push({
      x: vertices[i],
      y: vertices[i + 1],
      z: vertices[i + 2],
    });
  }
  return points;
}

/**
 * Convert Point3D[] back to Float32Array
 */
function point3DArrayToFloat32(
  points: { x: number; y: number; z: number }[],
): Float32Array {
  const result = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    result[i * 3] = points[i].x;
    result[i * 3 + 1] = points[i].y;
    result[i * 3 + 2] = points[i].z;
  }
  return result;
}

/**
 * Find closest point on a bezier curve (simplified for worker)
 */
function findClosestPointOnCurve(
  curve: {
    p0: { x: number; y: number; z: number };
    h0: { x: number; y: number; z: number };
    h1: { x: number; y: number; z: number };
    p1: { x: number; y: number; z: number };
  },
  point: { x: number; y: number; z: number },
  samples: number = 10,
): { t: number; distance: number } {
  let bestT = 0;
  let bestDist = Infinity;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;

    const curvePoint = {
      x:
        mt3 * curve.p0.x +
        3 * mt2 * t * curve.h0.x +
        3 * mt * t2 * curve.h1.x +
        t3 * curve.p1.x,
      y:
        mt3 * curve.p0.y +
        3 * mt2 * t * curve.h0.y +
        3 * mt * t2 * curve.h1.y +
        t3 * curve.p1.y,
      z:
        mt3 * curve.p0.z +
        3 * mt2 * t * curve.h0.z +
        3 * mt * t2 * curve.h1.z +
        t3 * curve.p1.z,
    };

    const dx = point.x - curvePoint.x;
    const dy = point.y - curvePoint.y;
    const dz = point.z - curvePoint.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
    }
  }

  return { t: bestT, distance: bestDist };
}

/**
 * Apply a single distortion curve to vertices
 */
function applyDistortionCurveToVertices(
  vertices: { x: number; y: number; z: number }[],
  curve: {
    influenceCurves: {
      p0: { x: number; y: number; z: number };
      h0: { x: number; y: number; z: number };
      h1: { x: number; y: number; z: number };
      p1: { x: number; y: number; z: number };
    }[];
    distortionPoints: { x: number; y: number; z: number }[];
    config: {
      affectAxes: number;
      maxFadeDist: number;
      useDistFade: boolean;
      reverseFade: boolean;
      skipOutsideLowerBound: boolean;
      type: string;
    };
  },
  leafWidth: number,
  cupClamp: number,
): void {
  const { influenceCurves, distortionPoints, config } = curve;

  if (influenceCurves.length === 0 || distortionPoints.length < 2) return;

  const mainInfluence = influenceCurves[0];

  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];

    // Find position along influence curve
    const closest = findClosestPointOnCurve(mainInfluence, vertex, 10);
    const t = closest.t;

    // Skip if outside bounds
    if (config.skipOutsideLowerBound && t < 0.05) continue;

    // Calculate fade factor
    let fadeFactor = 1;
    if (config.useDistFade && config.maxFadeDist > 0) {
      const normalizedDist = closest.distance / config.maxFadeDist;
      fadeFactor = config.reverseFade
        ? normalizedDist
        : Math.max(0, 1 - normalizedDist);
    }

    // Calculate distortion based on type
    let dx = 0,
      dy = 0,
      dz = 0;

    if (config.type === "Cup" || config.type === "1") {
      // Cup distortion - parabolic profile based on X distance from center
      const distFromCenter = Math.abs(vertex.x);
      const normalizedX = leafWidth > 0 ? distFromCenter / (leafWidth / 2) : 0;
      const cupFactor = Math.pow(Math.min(normalizedX, cupClamp), 2);
      const cupHeight = distortionPoints.length > 0 ? distortionPoints[0].z : 0;
      dz = cupHeight * cupFactor * fadeFactor;
    } else if (config.type === "Curl" || config.type === "0") {
      // Curl distortion
      const arcT = Math.max(0, (t - 0.5) * 2);
      if (arcT > 0 && distortionPoints.length >= 4) {
        const mt = 1 - arcT;
        const arcPoint = {
          x:
            mt * mt * mt * distortionPoints[0].x +
            3 * mt * mt * arcT * distortionPoints[1].x +
            3 * mt * arcT * arcT * distortionPoints[2].x +
            arcT * arcT * arcT * distortionPoints[3].x,
          y:
            mt * mt * mt * distortionPoints[0].y +
            3 * mt * mt * arcT * distortionPoints[1].y +
            3 * mt * arcT * arcT * distortionPoints[2].y +
            arcT * arcT * arcT * distortionPoints[3].y,
          z:
            mt * mt * mt * distortionPoints[0].z +
            3 * mt * mt * arcT * distortionPoints[1].z +
            3 * mt * arcT * arcT * distortionPoints[2].z +
            arcT * arcT * arcT * distortionPoints[3].z,
        };
        const strength = fadeFactor * arcT;
        dx = (arcPoint.x - vertex.x) * strength;
        dy = (arcPoint.y - vertex.y) * strength;
        dz = (arcPoint.z - vertex.z) * strength;
      }
    } else if (config.type === "Wave" || config.type === "2") {
      // Wave distortion
      if (distortionPoints.length >= 3) {
        const leftHeight = distortionPoints[0].z;
        const centerHeight = distortionPoints[1].z;
        const rightHeight = distortionPoints[2].z;
        let waveHeight: number;
        if (vertex.x < 0) {
          const wt = Math.max(
            0,
            Math.min(
              1,
              (vertex.x - distortionPoints[0].x) /
                (distortionPoints[1].x - distortionPoints[0].x),
            ),
          );
          waveHeight = leftHeight + (centerHeight - leftHeight) * wt;
        } else {
          const wt = Math.max(
            0,
            Math.min(
              1,
              (vertex.x - distortionPoints[1].x) /
                (distortionPoints[2].x - distortionPoints[1].x),
            ),
          );
          waveHeight = centerHeight + (rightHeight - centerHeight) * wt;
        }
        dz = waveHeight * fadeFactor;
      }
    } else if (config.type === "Flop" || config.type === "3") {
      // Flop distortion
      if (distortionPoints.length >= 3) {
        const flopT = Math.max(0, t);
        const flopFactor = Math.pow(flopT, 2);
        const maxDroop = distortionPoints[2].z;
        dz = maxDroop * flopFactor * fadeFactor;
      }
    }

    // Apply distortion to affected axes (Axis enum: X=1, Y=2, Z=4)
    if (config.affectAxes & 1) vertex.x += dx;
    if (config.affectAxes & 2) vertex.y += dy;
    if (config.affectAxes & 4) vertex.z += dz;
  }
}

/**
 * Handle distortion request - REAL IMPLEMENTATION
 */
function handleDistortion(request: WorkerDistortRequest): void {
  const { id, vertices, distortionCurves, leafWidth, cupClamp } = request;

  // Convert Float32Array to Point3D array
  const vertexPoints = float32ToPoint3DArray(vertices);

  // Apply each distortion curve
  for (const curve of distortionCurves) {
    applyDistortionCurveToVertices(vertexPoints, curve, leafWidth, cupClamp);
  }

  // Convert back to Float32Array
  const distortedVertices = point3DArrayToFloat32(vertexPoints);

  const response: WorkerResponse = {
    type: "result",
    id,
    data: distortedVertices,
  };

  self.postMessage(response, { transfer: [distortedVertices.buffer] });
}

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
 * Handle texture generation request - REAL IMPLEMENTATION
 * Uses OffscreenCanvas which IS available in Web Workers
 */
function handleTextureGeneration(request: WorkerTextureRequest): void {
  const { id, textureType, vars, params } = request;

  // Check for OffscreenCanvas support
  if (typeof OffscreenCanvas === "undefined") {
    const response: WorkerResponse = {
      type: "error",
      id,
      error: "OffscreenCanvas not available in this environment",
    };
    self.postMessage(response);
    return;
  }

  const size = vars.imgSize / vars.downsample;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    const response: WorkerResponse = {
      type: "error",
      id,
      error: "Could not get 2D context from OffscreenCanvas",
    };
    self.postMessage(response);
    return;
  }

  // Get base color from params (fallback to green if not found)
  const baseColorParam = params["TexBaseColor"];
  const baseColor = baseColorParam?.colorValue || { h: 0.33, s: 0.6, l: 0.4 };

  // Draw based on texture type
  if (textureType === "Albedo") {
    // Fill with base color
    const [r, g, b] = hslToRgb(baseColor.h, baseColor.s, baseColor.l);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, size, size);

    // Draw leaf shape mask
    if (vars.leafPoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(
        vars.leafPoints[0].x * size,
        (1 - vars.leafPoints[0].y) * size,
      );
      for (let i = 1; i < vars.leafPoints.length; i++) {
        ctx.lineTo(
          vars.leafPoints[i].x * size,
          (1 - vars.leafPoints[i].y) * size,
        );
      }
      ctx.closePath();
      ctx.clip();

      // Refill with color inside clip
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, size, size);

      // Draw veins
      const veinColorParam = params["TexVeinColor"];
      const veinColor = veinColorParam?.colorValue || {
        h: 0.33,
        s: 0.4,
        l: 0.3,
      };
      const [vr, vg, vb] = hslToRgb(veinColor.h, veinColor.s, veinColor.l);

      for (const rv of vars.rendVeins) {
        if (rv.basePoints.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(rv.basePoints[0].x * size, (1 - rv.basePoints[0].y) * size);
        for (let i = 1; i < rv.basePoints.length; i++) {
          ctx.lineTo(
            rv.basePoints[i].x * size,
            (1 - rv.basePoints[i].y) * size,
          );
        }
        ctx.strokeStyle = `rgba(${vr}, ${vg}, ${vb}, 0.7)`;
        ctx.lineWidth = size * 0.01;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
  } else if (textureType === "Normal") {
    // Fill with neutral normal (128, 128, 255)
    ctx.fillStyle = "rgb(128, 128, 255)";
    ctx.fillRect(0, 0, size, size);

    // Draw vein grooves (darker normal)
    if (vars.leafPoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(
        vars.leafPoints[0].x * size,
        (1 - vars.leafPoints[0].y) * size,
      );
      for (let i = 1; i < vars.leafPoints.length; i++) {
        ctx.lineTo(
          vars.leafPoints[i].x * size,
          (1 - vars.leafPoints[i].y) * size,
        );
      }
      ctx.closePath();
      ctx.clip();

      for (const rv of vars.rendVeins) {
        if (rv.basePoints.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(rv.basePoints[0].x * size, (1 - rv.basePoints[0].y) * size);
        for (let i = 1; i < rv.basePoints.length; i++) {
          ctx.lineTo(
            rv.basePoints[i].x * size,
            (1 - rv.basePoints[i].y) * size,
          );
        }
        ctx.strokeStyle = "rgb(128, 128, 200)";
        ctx.lineWidth = size * 0.015;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
  } else if (textureType === "Height") {
    // Fill with mid-gray height
    ctx.fillStyle = "rgb(128, 128, 128)";
    ctx.fillRect(0, 0, size, size);

    // Draw vein depressions
    if (vars.leafPoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(
        vars.leafPoints[0].x * size,
        (1 - vars.leafPoints[0].y) * size,
      );
      for (let i = 1; i < vars.leafPoints.length; i++) {
        ctx.lineTo(
          vars.leafPoints[i].x * size,
          (1 - vars.leafPoints[i].y) * size,
        );
      }
      ctx.closePath();
      ctx.clip();

      for (const rv of vars.rendVeins) {
        if (rv.basePoints.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(rv.basePoints[0].x * size, (1 - rv.basePoints[0].y) * size);
        for (let i = 1; i < rv.basePoints.length; i++) {
          ctx.lineTo(
            rv.basePoints[i].x * size,
            (1 - rv.basePoints[i].y) * size,
          );
        }
        ctx.strokeStyle = "rgb(110, 110, 110)";
        ctx.lineWidth = size * 0.02;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
  } else {
    // VeinMask or Clipping - just draw the outline
    ctx.fillStyle = "rgb(0, 0, 0)";
    ctx.fillRect(0, 0, size, size);

    if (vars.leafPoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(
        vars.leafPoints[0].x * size,
        (1 - vars.leafPoints[0].y) * size,
      );
      for (let i = 1; i < vars.leafPoints.length; i++) {
        ctx.lineTo(
          vars.leafPoints[i].x * size,
          (1 - vars.leafPoints[i].y) * size,
        );
      }
      ctx.closePath();
      ctx.fillStyle = "rgb(255, 255, 255)";
      ctx.fill();
    }
  }

  const imageData = ctx.getImageData(0, 0, size, size);

  const response: WorkerResponse = {
    type: "result",
    id,
    data: imageData,
  };

  self.postMessage(response);
}

// Register handler
self.onmessage = handleMessage;

// Export for module bundlers
export {};
