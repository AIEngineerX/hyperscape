import * as THREE from "../../extras/three/three";
import { World } from "../../core/World";
import { SystemBase } from "../shared/infrastructure/SystemBase";
import { EventType } from "../../types/events/event-types";

interface TeleportEffect {
  group: THREE.Group;
  beam: THREE.Mesh;
  baseGlow: THREE.Mesh;
  ring: THREE.Mesh;
  particles: { mesh: THREE.Mesh; velocity: THREE.Vector3 }[];
  life: number;
  maxLife: number;
}

/**
 * ClientTeleportEffectsSystem
 *
 * Renders high-visibility teleportation visual effects whenever a player
 * is teleported (e.g., into/out of the duel arena). Spawns a bright beam
 * of light, a ground glow ring, and rising spark particles.
 */
export class ClientTeleportEffectsSystem extends SystemBase {
  private activeEffects: TeleportEffect[] = [];
  private particleGeometry: THREE.CircleGeometry | null = null;
  private cyGeometry: THREE.CylinderGeometry | null = null;
  private ringGeometry: THREE.RingGeometry | null = null;

  // Cached glow texture shared by all effects
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

    // Shared geometries — allocated once, reused for every effect
    this.particleGeometry = new THREE.CircleGeometry(0.5, 16);
    this.cyGeometry = new THREE.CylinderGeometry(0.5, 0.5, 12, 24, 1, true);
    this.ringGeometry = new THREE.RingGeometry(0.5, 1.0, 32);

    // Generate a bright radial gradient texture
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
      gradient.addColorStop(0.2, "rgba(200, 230, 255, 0.95)");
      gradient.addColorStop(0.5, "rgba(100, 180, 255, 0.5)");
      gradient.addColorStop(1, "rgba(50, 120, 255, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }

    this.glowTexture = new THREE.CanvasTexture(canvas);
    console.log(
      "[TeleportEffects] System initialized and listening for PLAYER_TELEPORTED events",
    );
  }

  private onPlayerTeleported = (data: unknown): void => {
    const payload = data as {
      playerId: string;
      position: THREE.Vector3 | { x: number; y: number; z: number };
      suppressEffect?: boolean;
    };
    if (!payload?.position) {
      console.warn(
        "[TeleportEffects] Received PLAYER_TELEPORTED but no position in payload",
      );
      return;
    }

    // Skip visual effect for duel-internal teleports (proximity corrections
    // during FIGHTING phase) that set suppressEffect.
    if (payload.suppressEffect) {
      return;
    }

    // Normalize position — may be a THREE.Vector3 or plain {x,y,z} object
    const pos = payload.position;
    const vec =
      pos instanceof THREE.Vector3
        ? pos
        : new THREE.Vector3(pos.x, pos.y, pos.z);

    console.log(
      `[TeleportEffects] Spawning teleport effect for player ${payload.playerId} at`,
      vec.x.toFixed(1),
      vec.y.toFixed(1),
      vec.z.toFixed(1),
    );
    this.spawnTeleportEffect(vec);
  };

  private spawnTeleportEffect(position: THREE.Vector3): void {
    if (!this.world.stage?.scene) {
      console.warn(
        "[TeleportEffects] Cannot spawn effect — no scene available",
      );
      return;
    }
    if (
      !this.particleGeometry ||
      !this.cyGeometry ||
      !this.ringGeometry ||
      !this.glowTexture
    )
      return;

    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y += 0.05; // Slight ground offset

    // ---------------------------------------------------------------
    // 1. BASE GLOW — bright flat disc on the ground
    // ---------------------------------------------------------------
    const baseMat = new THREE.MeshBasicMaterial({
      map: this.glowTexture,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      color: 0x66ccff,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    const baseGlow = new THREE.Mesh(this.particleGeometry, baseMat);
    baseGlow.rotation.x = -Math.PI / 2;
    baseGlow.scale.set(2, 2, 2); // ~1m radius disc, wraps around avatar
    baseGlow.renderOrder = 1000;
    baseGlow.frustumCulled = false;
    group.add(baseGlow);

    // ---------------------------------------------------------------
    // 2. RING — glowing ring around the base
    // ---------------------------------------------------------------
    const ringMat = new THREE.MeshBasicMaterial({
      map: this.glowTexture,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      color: 0xaaddff,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    const ring = new THREE.Mesh(this.ringGeometry, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 1001;
    ring.frustumCulled = false;
    group.add(ring);

    // ---------------------------------------------------------------
    // 3. BEAM — tall glowing cylinder shooting upward
    // ---------------------------------------------------------------
    const beamMat = new THREE.MeshBasicMaterial({
      map: this.glowTexture,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      color: 0x88ccff,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    const beam = new THREE.Mesh(this.cyGeometry, beamMat);
    beam.position.y = 6; // Center the 12-unit tall cylinder
    beam.scale.set(1, 1, 1);
    beam.renderOrder = 999;
    beam.frustumCulled = false;
    group.add(beam);

    // ---------------------------------------------------------------
    // 4. PARTICLES — 20 rising sparks billboarded toward the camera
    // ---------------------------------------------------------------
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3 }[] = [];
    const particleCount = 20;
    for (let i = 0; i < particleCount; i++) {
      const isCore = i < 6;
      const pColor = isCore ? 0xffffff : 0x88ddff;
      const pMat = new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        color: pColor,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
      });
      const pMesh = new THREE.Mesh(this.particleGeometry, pMat);

      // Spawn around the base in a ring pattern
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.1 + Math.random() * 0.6;
      pMesh.position.set(
        Math.cos(angle) * radius,
        Math.random() * 1.0,
        Math.sin(angle) * radius,
      );

      const size = isCore
        ? 0.5 + Math.random() * 0.4
        : 0.3 + Math.random() * 0.3;
      pMesh.scale.setScalar(size);
      pMesh.renderOrder = 1002;
      pMesh.frustumCulled = false;

      // Rise upward with slight XZ drift
      const speed = 2.0 + Math.random() * 4.0;
      const drift = 0.15 + Math.random() * 0.25;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * drift,
        speed,
        Math.sin(angle) * drift,
      );

      group.add(pMesh);
      particles.push({ mesh: pMesh, velocity });
    }

    this.world.stage.scene.add(group);

    this.activeEffects.push({
      group,
      beam,
      baseGlow,
      ring,
      particles,
      life: 0,
      maxLife: 2.0, // 2 seconds — more time to be noticed
    });
  }

  update(dt: number): void {
    if (!this.world.isClient || !this.world.stage?.scene) return;

    const camQuat = this.world.camera?.quaternion;

    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      effect.life += dt;
      const t = effect.life / effect.maxLife; // 0..1 progress

      if (t >= 1) {
        // Cleanup
        this.world.stage.scene.remove(effect.group);
        (effect.baseGlow.material as THREE.Material).dispose();
        (effect.beam.material as THREE.Material).dispose();
        (effect.ring.material as THREE.Material).dispose();
        effect.particles.forEach((p) =>
          (p.mesh.material as THREE.Material).dispose(),
        );
        this.activeEffects.splice(i, 1);
        continue;
      }

      // Ease-out factor: stays bright early, fades at the end
      const fade = t < 0.3 ? 1.0 : 1.0 - (t - 0.3) / 0.7;

      // --- Beam animation ---
      const beamMat = effect.beam.material as THREE.MeshBasicMaterial;
      beamMat.opacity = fade * 0.7;
      // Beam rises and expands slightly
      effect.beam.scale.set(1 + t * 0.2, 1 + t * 0.3, 1 + t * 0.2);
      effect.beam.position.y = 6 + t * 3;

      // --- Base glow animation ---
      const baseMat = effect.baseGlow.material as THREE.MeshBasicMaterial;
      baseMat.opacity = fade * 1.0;
      const baseScale = 2 + Math.sin(t * Math.PI * 2) * 0.15;
      effect.baseGlow.scale.setScalar(baseScale);

      // --- Ring animation: expand outward and fade ---
      const ringMat = effect.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = fade * 0.9;
      const ringScale = 1 + t * 0.5;
      effect.ring.scale.setScalar(ringScale);

      // --- Particle animation ---
      for (const p of effect.particles) {
        p.mesh.position.addScaledVector(p.velocity, dt);
        const pMat = p.mesh.material as THREE.MeshBasicMaterial;
        pMat.opacity = fade * 0.9;

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
      (effect.ring.material as THREE.Material).dispose();
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
    if (this.ringGeometry) {
      this.ringGeometry.dispose();
      this.ringGeometry = null;
    }
    if (this.glowTexture) {
      this.glowTexture.dispose();
      this.glowTexture = null;
    }

    super.destroy();
  }
}
