/**
 * TreeGLBVisualStrategy — GLBTreeInstancer integration for woodcutting trees.
 *
 * Thin wrapper: the instancer owns InstancedMeshes and LOD switching.
 * This strategy just calls addInstance / removeInstance / setDepleted.
 */

import THREE from "../../../extras/three/three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  addInstance as addGLBTreeInstance,
  removeInstance as removeGLBTreeInstance,
  setDepleted as setGLBTreeDepleted,
  updateGLBTreeInstancer,
} from "../../../systems/shared/world/GLBTreeInstancer";
import type {
  ResourceVisualContext,
  ResourceVisualStrategy,
} from "./ResourceVisualStrategy";

function createCollisionProxy(ctx: ResourceVisualContext, scale: number): void {
  const height = 8 * scale;
  const radius = 1 * scale;
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 6);
  const material = new MeshBasicNodeMaterial();
  material.visible = false;

  const proxy = new THREE.Mesh(geometry, material);
  proxy.position.y = height / 2;
  proxy.name = `TreeProxy_${ctx.id}`;
  proxy.userData = {
    type: "resource",
    entityId: ctx.id,
    name: ctx.config.name,
    interactable: true,
    resourceType: ctx.config.resourceType,
  };
  proxy.layers.set(1);

  ctx.node.add(proxy);
  ctx.setMesh(proxy);
}

export class TreeGLBVisualStrategy implements ResourceVisualStrategy {
  async createVisual(ctx: ResourceVisualContext): Promise<void> {
    const { config, id, position } = ctx;
    if (!config.model) return;

    const baseScale = config.modelScale ?? 3.0;
    const worldPos = new THREE.Vector3();
    ctx.node.getWorldPosition(worldPos);

    const rotHash = ctx.hashString(
      `${id}_${position.x.toFixed(1)}_${position.z.toFixed(1)}`,
    );
    const rotation = ((rotHash % 1000) / 1000) * Math.PI * 2;

    const success = await addGLBTreeInstance(
      config.model,
      id,
      worldPos,
      rotation,
      baseScale,
    );

    if (success) {
      createCollisionProxy(ctx, baseScale);
    }
    // If instancing fails ResourceEntity factory falls back to StandardModelVisualStrategy
  }

  async onDepleted(ctx: ResourceVisualContext): Promise<void> {
    setGLBTreeDepleted(ctx.id, true);
  }

  async onRespawn(ctx: ResourceVisualContext): Promise<void> {
    setGLBTreeDepleted(ctx.id, false);
    // Remove stump mesh, recreate proxy
    const mesh = ctx.getMesh();
    if (mesh) {
      ctx.node.remove(mesh);
      ctx.setMesh(null);
    }
    const baseScale = ctx.config.modelScale ?? 3.0;
    createCollisionProxy(ctx, baseScale);
  }

  update(): void {
    updateGLBTreeInstancer();
  }

  destroy(ctx: ResourceVisualContext): void {
    removeGLBTreeInstance(ctx.id);
  }
}
