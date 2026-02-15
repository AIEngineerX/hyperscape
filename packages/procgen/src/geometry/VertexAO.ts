/**
 * Vertex Ambient Occlusion Computation
 *
 * Computes ambient occlusion per-vertex by raycasting against the mesh geometry.
 * This gives natural darkening in crevices, under branches, and in dense foliage.
 */

import * as THREE from "three";

/**
 * Options for vertex AO computation
 */
export type VertexAOOptions = {
  /** Number of rays to cast per vertex (more = better quality, slower) */
  samples?: number;
  /** Maximum distance to check for occlusion */
  maxDistance?: number;
  /** Minimum AO value (prevents pure black) */
  minAO?: number;
  /** Bias to push ray origin away from surface (prevents self-intersection) */
  rayBias?: number;
  /** Whether to include all meshes in the group for occlusion testing */
  includeAllMeshes?: boolean;
};

const DEFAULT_OPTIONS: Required<VertexAOOptions> = {
  samples: 32,
  maxDistance: 10,
  minAO: 0.2,
  rayBias: 0.01,
  includeAllMeshes: true,
};

/**
 * Pre-computed hemisphere sample directions (Fibonacci lattice)
 */
function generateHemisphereSamples(count: number): THREE.Vector3[] {
  const samples: THREE.Vector3[] = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  for (let i = 0; i < count; i++) {
    // Fibonacci lattice on hemisphere
    const theta = (2 * Math.PI * i) / goldenRatio;
    const phi = Math.acos(1 - (i + 0.5) / count);

    // Only use upper hemisphere (phi from 0 to PI/2)
    const adjustedPhi = phi * 0.5;

    const x = Math.sin(adjustedPhi) * Math.cos(theta);
    const y = Math.cos(adjustedPhi); // Up direction in local space
    const z = Math.sin(adjustedPhi) * Math.sin(theta);

    samples.push(new THREE.Vector3(x, y, z));
  }

  return samples;
}

/**
 * Build a rotation matrix to transform from Y-up local space to normal-aligned space
 */
function buildNormalRotation(normal: THREE.Vector3): THREE.Matrix4 {
  const up = new THREE.Vector3(0, 1, 0);
  const quaternion = new THREE.Quaternion();

  if (Math.abs(normal.dot(up)) > 0.999) {
    // Normal is nearly parallel to up, use identity or flip
    if (normal.y > 0) {
      return new THREE.Matrix4(); // Identity
    } else {
      // Flip 180 degrees around X
      quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    }
  } else {
    quaternion.setFromUnitVectors(up, normal);
  }

  return new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
}

/**
 * Compute vertex ambient occlusion for a mesh or group of meshes.
 *
 * @param target - The mesh or group to compute AO for
 * @param options - AO computation options
 * @returns Map of mesh to its original geometry (for restoration)
 */
export function computeVertexAO(
  target: THREE.Object3D,
  options: VertexAOOptions = {},
): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Collect all meshes
  const meshes: THREE.Mesh[] = [];
  target.traverse((node) => {
    if (node instanceof THREE.Mesh && node.geometry) {
      meshes.push(node);
    }
  });

  if (meshes.length === 0) return;

  // Generate sample directions
  const localSamples = generateHemisphereSamples(opts.samples);

  // Create raycaster
  const raycaster = new THREE.Raycaster();
  raycaster.near = opts.rayBias;
  raycaster.far = opts.maxDistance;

  // For each mesh, compute vertex AO
  for (const mesh of meshes) {
    computeMeshVertexAO(mesh, meshes, localSamples, raycaster, opts);
  }
}

/**
 * Compute vertex AO for a single mesh
 */
function computeMeshVertexAO(
  mesh: THREE.Mesh,
  allMeshes: THREE.Mesh[],
  localSamples: THREE.Vector3[],
  raycaster: THREE.Raycaster,
  opts: Required<VertexAOOptions>,
): void {
  const geometry = mesh.geometry;
  const positionAttr = geometry.getAttribute("position");
  const normalAttr = geometry.getAttribute("normal");

  if (!positionAttr || !normalAttr) return;

  const vertexCount = positionAttr.count;

  // Create or get color attribute
  let colorAttr = geometry.getAttribute(
    "color",
  ) as THREE.BufferAttribute | null;
  if (!colorAttr) {
    colorAttr = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
    geometry.setAttribute("color", colorAttr);
  }

  // Get world matrix for transforming positions and normals
  mesh.updateMatrixWorld(true);
  const worldMatrix = mesh.matrixWorld;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);

  // Temporary vectors
  const worldPos = new THREE.Vector3();
  const worldNormal = new THREE.Vector3();
  const rayDir = new THREE.Vector3();
  const tempDir = new THREE.Vector3();

  // Target meshes for occlusion testing
  const targetMeshes = opts.includeAllMeshes ? allMeshes : [mesh];

  // Process each vertex
  for (let i = 0; i < vertexCount; i++) {
    // Get world position
    worldPos.set(
      positionAttr.getX(i),
      positionAttr.getY(i),
      positionAttr.getZ(i),
    );
    worldPos.applyMatrix4(worldMatrix);

    // Get world normal
    worldNormal.set(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
    worldNormal.applyMatrix3(normalMatrix).normalize();

    // Build rotation to align hemisphere samples with normal
    const normalRotation = buildNormalRotation(worldNormal);

    // Count occlusions
    let occluded = 0;

    for (const sample of localSamples) {
      // Transform sample direction to world space aligned with normal
      tempDir.copy(sample);
      tempDir.applyMatrix4(normalRotation);
      rayDir.copy(tempDir).normalize();

      // Set ray origin slightly above surface
      raycaster.ray.origin
        .copy(worldPos)
        .addScaledVector(worldNormal, opts.rayBias);
      raycaster.ray.direction.copy(rayDir);

      // Check for intersections
      const intersects = raycaster.intersectObjects(targetMeshes, false);
      if (intersects.length > 0) {
        occluded++;
      }
    }

    // Calculate AO value (1 = fully lit, 0 = fully occluded)
    const ao = 1 - occluded / localSamples.length;
    const clampedAO = Math.max(opts.minAO, ao);

    // Store as grayscale vertex color
    colorAttr.setXYZ(i, clampedAO, clampedAO, clampedAO);
  }

  colorAttr.needsUpdate = true;

  // Mark geometry as having vertex colors
  geometry.setAttribute("color", colorAttr);
}

/**
 * Apply vertex colors to materials in a mesh/group.
 * This modifies materials to use vertex colors for shading.
 *
 * @param target - The mesh or group
 */
export function enableVertexColorMaterials(target: THREE.Object3D): void {
  target.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const mat of materials) {
        if (
          mat instanceof THREE.MeshStandardMaterial ||
          mat instanceof THREE.MeshLambertMaterial ||
          mat instanceof THREE.MeshBasicMaterial ||
          mat instanceof THREE.MeshPhongMaterial
        ) {
          mat.vertexColors = true;
          mat.needsUpdate = true;
        }
      }
    }
  });
}

/**
 * Quick AO computation using simpler heuristics (faster but less accurate).
 * Uses vertex density and branch depth as proxies for occlusion.
 *
 * @param target - The mesh or group
 * @param options - Optional settings
 */
export function computeQuickVertexAO(
  target: THREE.Object3D,
  options: { minAO?: number; falloff?: number } = {},
): void {
  const minAO = options.minAO ?? 0.3;
  const falloff = options.falloff ?? 0.5;

  target.traverse((node) => {
    if (node instanceof THREE.Mesh && node.geometry) {
      const geometry = node.geometry;
      const positionAttr = geometry.getAttribute("position");
      const normalAttr = geometry.getAttribute("normal");

      if (!positionAttr) return;

      const vertexCount = positionAttr.count;

      // Create color attribute
      const colors = new Float32Array(vertexCount * 3);

      // Get bounding box for normalization
      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox!;
      const height = bbox.max.y - bbox.min.y;
      const minY = bbox.min.y;

      for (let i = 0; i < vertexCount; i++) {
        const y = positionAttr.getY(i);

        // Height-based AO: lower = more occluded
        const heightFactor = (y - minY) / height;

        // Normal-based AO: downward-facing = more occluded
        let normalFactor = 1;
        if (normalAttr) {
          const ny = normalAttr.getY(i);
          normalFactor = (ny + 1) * 0.5; // Map [-1,1] to [0,1]
        }

        // Combine factors
        const ao =
          minAO +
          (1 - minAO) * (heightFactor * falloff + normalFactor * (1 - falloff));
        const clampedAO = Math.min(1, Math.max(minAO, ao));

        colors[i * 3] = clampedAO;
        colors[i * 3 + 1] = clampedAO;
        colors[i * 3 + 2] = clampedAO;
      }

      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
  });
}
