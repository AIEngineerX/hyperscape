import * as THREE from "../../extras/three/three";
import { World } from "../../core/World";
import { SystemBase } from "../shared/infrastructure/SystemBase";
import { EventType } from "../../types/events/event-types";

interface TeleportEffect {
  group: THREE.Group;
  beam: THREE.Mesh;
  baseGlow: THREE.Mesh;
  particles: { mesh: THREE.Mesh; velocity: THREE.Vector3 }[];
  life: number;
  maxLife: number;
}

export class ClientTeleportEffectsSystem extends SystemBase {
  private activeEffects: TeleportEffect[] = [];
  private particleGeometry: THREE.CircleGeometry | null = null;
  private cyGeometry: THREE.CylinderGeometry | null = null;

  // A glowing radial gradient texture
  // Used for both the base glow and the particles
  private glowTexture: THREE.Texture | null = null;

  constructor(world: World) {
    super(world, {
      name: "teleportEffects",
      dependencies: { required: [], optional: [] },
      autoCleanup: true,
    });
  }

  async init(): Promise<void> {
    this.world.on(EventType.PLAYER_TELEPORTED, this.onPlayerTeleported);

    // Create shared geometries
    this.particleGeometry = new THREE.CircleGeometry(0.5, 16);
    this.cyGeometry = new THREE.CylinderGeometry(0.8, 0.8, 4, 16, 1, true); // open ended, 4 units tall

    // Generate a simple radial gradient texture for soft glow
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
      gradient.addColorStop(0.3, "rgba(255, 255, 255, 0.8)");
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    }

    this.glowTexture = new THREE.CanvasTexture(canvas);
  }

  private onPlayerTeleported = (data: unknown): void => {
    // Determine position from event
    const payload = data as { playerId: string; position: THREE.Vector3 };
    if (!payload?.position) return;

    this.spawnTeleportEffect(payload.position);
  };

  private spawnTeleportEffect(position: THREE.Vector3): void {
    if (!this.world.stage?.scene) return;
    if (!this.particleGeometry || !this.cyGeometry || !this.glowTexture) return;

    const group = new THREE.Group();
    // Offset slightly above ground
    group.position.copy(position);
    group.position.y += 0.1;

    // 1. Base glow
    const baseMat = new THREE.MeshBasicMaterial({
      map: this.glowTexture,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      color: 0x88bbff, // Cyan-blue magic
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const baseGlow = new THREE.Mesh(this.particleGeometry, baseMat);
    baseGlow.rotation.x = -Math.PI / 2; // Flat on the ground
    baseGlow.scale.set(4, 4, 4); // 2 meter radius
    group.add(baseGlow);

    // 2. Beam (Cylinder)
    const beamMat = new THREE.MeshBasicMaterial({
      map: this.glowTexture, // Will look a bit striped/soft
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      color: 0x88bbff,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(this.cyGeometry, beamMat);
    beam.position.y = 2; // Move up half height so base is at 0
    // Scale XZ slightly smaller than base glow
    beam.scale.set(1.5, 1, 1.5);
    group.add(beam);

    // 3. Floating particles
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3 }[] = [];
    for (let i = 0; i < 12; i++) {
      const pMat = new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        color: 0xffffff,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const pMesh = new THREE.Mesh(this.particleGeometry, pMat);

      // Random position around the base
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 1.5;
      pMesh.position.set(
        Math.cos(angle) * radius,
        Math.random() * 0.5,
        Math.sin(angle) * radius,
      );

      const size = 0.2 + Math.random() * 0.3;
      pMesh.scale.setScalar(size);

      // Float upwards
      const velocity = new THREE.Vector3(0, 1.5 + Math.random() * 3, 0);

      group.add(pMesh);
      particles.push({ mesh: pMesh, velocity });
    }

    this.world.stage.scene.add(group);

    this.activeEffects.push({
      group,
      beam,
      baseGlow,
      particles,
      life: 0,
      maxLife: 1.5, // 1.5 seconds duration
    });
  }

  update(dt: number): void {
    if (!this.world.isClient || !this.world.stage?.scene) return;

    const camQuat = this.world.camera?.quaternion;

    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      effect.life += dt;
      const t = effect.life / effect.maxLife;

      if (t >= 1) {
        // Remove and cleanup
        this.world.stage.scene.remove(effect.group);
        (effect.baseGlow.material as THREE.Material).dispose();
        (effect.beam.material as THREE.Material).dispose();
        effect.particles.forEach((p) =>
          (p.mesh.material as THREE.Material).dispose(),
        );
        this.activeEffects.splice(i, 1);
        continue;
      }

      // Animate beam: fade out, expand slightly, move up
      const beamMat = effect.beam.material as THREE.Material;
      beamMat.opacity = (1 - t) * 0.6;
      effect.beam.scale.set(1.5 + t * 0.5, 1 + t * 0.5, 1.5 + t * 0.5);
      effect.beam.position.y = 2 * (1 + t * 0.5);

      // Animate base glow: scale down, fade out
      const baseMat = effect.baseGlow.material as THREE.Material;
      baseMat.opacity = (1 - t) * 0.8;
      effect.baseGlow.scale.setScalar(4 - t * 2);

      // Animate particles
      for (const p of effect.particles) {
        p.mesh.position.addScaledVector(p.velocity, dt);
        // Gently fade out
        const pMat = p.mesh.material as THREE.Material;
        pMat.opacity = (1 - t) * 0.8;

        // Billboard toward camera
        if (camQuat) {
          p.mesh.quaternion.copy(camQuat);
        }
      }
    }
  }

  destroy(): void {
    this.world.off(EventType.PLAYER_TELEPORTED, this.onPlayerTeleported);

    for (const effect of this.activeEffects) {
      if (this.world.stage?.scene) {
        this.world.stage.scene.remove(effect.group);
      }
      (effect.baseGlow.material as THREE.Material).dispose();
      (effect.beam.material as THREE.Material).dispose();
      effect.particles.forEach((p) =>
        (p.mesh.material as THREE.Material).dispose(),
      );
    }
    this.activeEffects = [];

    if (this.particleGeometry) {
      this.particleGeometry.dispose();
      this.particleGeometry = null;
    }
    if (this.cyGeometry) {
      this.cyGeometry.dispose();
      this.cyGeometry = null;
    }
    if (this.glowTexture) {
      this.glowTexture.dispose();
      this.glowTexture = null;
    }

    super.destroy();
  }
}
