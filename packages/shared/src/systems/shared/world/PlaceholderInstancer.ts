/**
 * PlaceholderInstancer — InstancedMesh pools for placeholder resource geometry.
 *
 * Resources without a real model (e.g. oak/willow trees with null modelPath)
 * render via simple placeholder shapes (cylinder for trees, box for others).
 * This module batches all placeholders of the same resource type into a single
 * InstancedMesh draw call.
 *
 * API mirrors GLBTreeInstancer: addInstance / removeInstance / setVisible.
 * PlaceholderVisualStrategy delegates all rendering to this module.
 *
 * @module PlaceholderInstancer
 */

import THREE from "../../../extras/three/three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  createDissolveMaterial,
  GPU_VEG_CONFIG,
  type DissolveMaterial,
} from "./GPUVegetation";

const INITIAL_CAPACITY = 64;

const _mat4 = new THREE.Matrix4();
const _zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);

interface InstanceSlot {
  entityId: string;
  matrix: THREE.Matrix4;
  visible: boolean;
}

interface Pool {
  mesh: THREE.InstancedMesh;
  material: DissolveMaterial;
  slots: Map<string, number>;
  instances: InstanceSlot[];
  activeCount: number;
  capacity: number;
}

// ---- Module state ----
let _scene: THREE.Scene | null = null;
const _pools = new Map<string, Pool>();
const _entityToType = new Map<string, string>();

// ---- Geometry / material factories (one per resource type) ----

function createGeometry(resourceType: string): THREE.BufferGeometry {
  if (resourceType === "tree") {
    return new THREE.CylinderGeometry(0.3, 0.5, 2, 6);
  }
  return new THREE.BoxGeometry(0.8, 0.8, 0.8);
}

function createBaseMaterial(resourceType: string): MeshStandardNodeMaterial {
  const color = resourceType === "tree" ? 0x8b4513 : 0x808080;
  return new MeshStandardNodeMaterial({ color });
}

// ---- Pool lifecycle ----

function createPool(resourceType: string): Pool {
  const geometry = createGeometry(resourceType);
  const baseMat = createBaseMaterial(resourceType);
  const material = createDissolveMaterial(baseMat, {
    fadeStart: GPU_VEG_CONFIG.FADE_START,
    fadeEnd: GPU_VEG_CONFIG.FADE_END,
    enableNearFade: true,
    enableWaterCulling: true,
    enableOcclusionDissolve: true,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, INITIAL_CAPACITY);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.layers.set(1);
  mesh.name = `PlaceholderPool_${resourceType}`;
  _scene!.add(mesh);

  return {
    mesh,
    material,
    slots: new Map(),
    instances: [],
    activeCount: 0,
    capacity: INITIAL_CAPACITY,
  };
}

function growPool(pool: Pool): void {
  const newCapacity = pool.capacity * 2;
  const { mesh } = pool;

  const newMesh = new THREE.InstancedMesh(
    mesh.geometry,
    mesh.material,
    newCapacity,
  );
  for (let i = 0; i < pool.activeCount; i++) {
    newMesh.setMatrixAt(
      i,
      pool.instances[i].visible ? pool.instances[i].matrix : _zeroScale,
    );
  }
  newMesh.count = pool.activeCount;
  newMesh.instanceMatrix.needsUpdate = true;
  newMesh.frustumCulled = false;
  newMesh.castShadow = true;
  newMesh.receiveShadow = true;
  newMesh.layers.set(1);
  newMesh.name = mesh.name;

  _scene!.remove(mesh);
  mesh.dispose();
  _scene!.add(newMesh);

  pool.mesh = newMesh;
  pool.capacity = newCapacity;
}

function ensurePool(resourceType: string): Pool {
  let pool = _pools.get(resourceType);
  if (!pool) {
    pool = createPool(resourceType);
    _pools.set(resourceType, pool);
  }
  return pool;
}

// ---- Public API ----

export function initPlaceholderInstancer(scene: THREE.Scene): void {
  _scene = scene;
}

export function destroyPlaceholderInstancer(): void {
  for (const pool of _pools.values()) {
    _scene?.remove(pool.mesh);
    pool.mesh.geometry.dispose();
    if (pool.mesh.material instanceof THREE.Material) {
      pool.mesh.material.dispose();
    }
  }
  _pools.clear();
  _entityToType.clear();
  _scene = null;
}

export function addPlaceholderInstance(
  resourceType: string,
  entityId: string,
  worldPos: THREE.Vector3,
  scale: number,
): boolean {
  if (!_scene) return false;
  if (_entityToType.has(entityId)) return true;

  const pool = ensurePool(resourceType);

  if (pool.activeCount >= pool.capacity) {
    growPool(pool);
  }

  const matrix = new THREE.Matrix4();
  matrix.makeTranslation(worldPos.x, worldPos.y, worldPos.z);
  if (scale !== 1) {
    matrix.scale(new THREE.Vector3(scale, scale, scale));
  }

  const slotIndex = pool.activeCount;
  pool.mesh.setMatrixAt(slotIndex, matrix);
  pool.activeCount++;
  pool.mesh.count = pool.activeCount;
  pool.mesh.instanceMatrix.needsUpdate = true;

  pool.slots.set(entityId, slotIndex);
  pool.instances[slotIndex] = { entityId, matrix, visible: true };
  _entityToType.set(entityId, resourceType);

  return true;
}

export function removePlaceholderInstance(entityId: string): void {
  const resourceType = _entityToType.get(entityId);
  if (!resourceType) return;

  const pool = _pools.get(resourceType);
  if (!pool) return;

  const index = pool.slots.get(entityId);
  if (index === undefined) return;

  const lastIndex = pool.activeCount - 1;

  if (index !== lastIndex) {
    const lastSlot = pool.instances[lastIndex];
    pool.mesh.setMatrixAt(
      index,
      lastSlot.visible ? lastSlot.matrix : _zeroScale,
    );
    pool.instances[index] = lastSlot;
    pool.slots.set(lastSlot.entityId, index);
  }

  pool.activeCount--;
  pool.mesh.count = pool.activeCount;
  pool.mesh.instanceMatrix.needsUpdate = true;

  pool.slots.delete(entityId);
  _entityToType.delete(entityId);
}

export function setPlaceholderVisible(
  entityId: string,
  visible: boolean,
): void {
  const resourceType = _entityToType.get(entityId);
  if (!resourceType) return;

  const pool = _pools.get(resourceType);
  if (!pool) return;

  const index = pool.slots.get(entityId);
  if (index === undefined) return;

  const slot = pool.instances[index];
  if (slot.visible === visible) return;

  slot.visible = visible;
  pool.mesh.setMatrixAt(index, visible ? slot.matrix : _zeroScale);
  pool.mesh.instanceMatrix.needsUpdate = true;
}
