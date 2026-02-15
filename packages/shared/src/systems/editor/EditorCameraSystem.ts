/**
 * Editor camera with orbit/pan/fly modes. Requires graphics renderer.
 * Check isReady before using controls.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  System,
  type SystemDependencies,
} from "../shared/infrastructure/System";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types";

export type EditorCameraMode = "orbit" | "pan" | "fly";

export interface CameraBookmark {
  name: string;
  position: THREE.Vector3;
  target: THREE.Vector3;
  zoom: number;
}

export interface EditorCameraConfig {
  initialMode: EditorCameraMode;
  enableDamping: boolean;
  dampingFactor: number;
  minDistance: number;
  maxDistance: number;
  enableZoom: boolean;
  enablePan: boolean;
  enableRotate: boolean;
  panSpeed: number;
  rotateSpeed: number;
  zoomSpeed: number;
  flySpeed: number;
  flyFastMultiplier: number;
}

/** Defaults tuned for world-scale editing (terrain ~2048 units, buildings ~10-50 units) */
const DEFAULT_CONFIG: EditorCameraConfig = {
  initialMode: "orbit",
  enableDamping: true,
  dampingFactor: 0.1, // Lower = smoother, 0.05-0.25 typical range
  minDistance: 1, // Allow close inspection of small objects
  maxDistance: 2000, // Covers full terrain diagonal (~2900 for 2048x2048)
  enableZoom: true,
  enablePan: true,
  enableRotate: true,
  panSpeed: 1.0,
  rotateSpeed: 1.0,
  zoomSpeed: 1.0,
  flySpeed: 50, // Units/sec, covers terrain in ~40s at normal speed
  flyFastMultiplier: 3, // 150 units/sec with shift held
};

export class EditorCameraSystem extends System {
  private config: EditorCameraConfig;
  private controls: OrbitControls | null = null;
  private mode: EditorCameraMode = "orbit";
  private bookmarks: Map<string, CameraBookmark> = new Map();
  private domElement: HTMLElement | null = null;
  public isReady = false;

  private flyKeys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
    fast: false,
  };
  private flyDirection = new THREE.Vector3();

  private _tempVec3 = new THREE.Vector3();
  private _tempEuler = new THREE.Euler(0, 0, 0, "YXZ");

  constructor(world: World, config: Partial<EditorCameraConfig> = {}) {
    super(world);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mode = this.config.initialMode;
  }

  override getDependencies(): SystemDependencies {
    return {
      required: ["stage", "graphics"],
      optional: [],
    };
  }

  override async init(options: WorldOptions): Promise<void> {
    await super.init(options);

    const graphics = this.world.graphics;
    if (!graphics?.renderer?.domElement) {
      console.warn("[EditorCameraSystem] No renderer - controls disabled");
      this.emit("init-failed", {
        reason: "no-renderer",
        system: "editor-camera",
      });
      return;
    }

    this.domElement = graphics.renderer.domElement;
    this.setupOrbitControls();
    this.setupKeyboardListeners();
    this.isReady = true;
    this.emit("ready", { system: "editor-camera" });
  }

  private setupOrbitControls(): void {
    if (!this.domElement) return;

    this.controls = new OrbitControls(this.world.camera, this.domElement);
    this.controls.enableDamping = this.config.enableDamping;
    this.controls.dampingFactor = this.config.dampingFactor;
    this.controls.minDistance = this.config.minDistance;
    this.controls.maxDistance = this.config.maxDistance;
    this.controls.enableZoom = this.config.enableZoom;
    this.controls.enablePan = this.config.enablePan;
    this.controls.enableRotate = this.config.enableRotate;
    this.controls.panSpeed = this.config.panSpeed;
    this.controls.rotateSpeed = this.config.rotateSpeed;
    this.controls.zoomSpeed = this.config.zoomSpeed;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.target.set(0, 0, 0);
    this.world.camera.position.set(50, 50, 50);
    this.controls.update();
  }

  private setupKeyboardListeners(): void {
    if (!this.domElement) return;
    this.domElement.tabIndex = 0;
    this.domElement.addEventListener("keydown", this.onKeyDown);
    this.domElement.addEventListener("keyup", this.onKeyUp);
    this.domElement.addEventListener("blur", this.onBlur);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;

    switch (event.code) {
      case "KeyW":
        this.flyKeys.forward = true;
        break;
      case "KeyS":
        this.flyKeys.backward = true;
        break;
      case "KeyA":
        this.flyKeys.left = true;
        break;
      case "KeyD":
        this.flyKeys.right = true;
        break;
      case "KeyQ":
      case "Space":
        this.flyKeys.up = true;
        break;
      case "KeyE":
      case "ControlLeft":
      case "ControlRight":
        this.flyKeys.down = true;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.flyKeys.fast = true;
        break;
      case "Digit1":
        this.setMode("orbit");
        break;
      case "Digit2":
        this.setMode("pan");
        break;
      case "Digit3":
        this.setMode("fly");
        break;
      case "KeyF":
        if (event.shiftKey) this.focusOn(new THREE.Vector3(0, 0, 0));
        break;
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    switch (event.code) {
      case "KeyW":
        this.flyKeys.forward = false;
        break;
      case "KeyS":
        this.flyKeys.backward = false;
        break;
      case "KeyA":
        this.flyKeys.left = false;
        break;
      case "KeyD":
        this.flyKeys.right = false;
        break;
      case "KeyQ":
      case "Space":
        this.flyKeys.up = false;
        break;
      case "KeyE":
      case "ControlLeft":
      case "ControlRight":
        this.flyKeys.down = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.flyKeys.fast = false;
        break;
    }
  };

  private onBlur = (): void => {
    const k = this.flyKeys;
    k.forward = k.backward = k.left = k.right = k.up = k.down = k.fast = false;
  };

  setMode(mode: EditorCameraMode): void {
    this.mode = mode;
    if (!this.controls) {
      this.emit("mode-changed", { mode });
      return;
    }

    switch (mode) {
      case "orbit":
        this.controls.enableRotate = true;
        this.controls.enablePan = true;
        this.controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        };
        break;
      case "pan":
        this.controls.enableRotate = false;
        this.controls.enablePan = true;
        this.controls.mouseButtons = {
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        };
        break;
      case "fly":
        this.controls.enableRotate = true;
        this.controls.enablePan = false;
        this.controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: undefined as unknown as THREE.MOUSE,
          RIGHT: undefined as unknown as THREE.MOUSE,
        };
        break;
    }
    this.emit("mode-changed", { mode });
  }

  getMode(): EditorCameraMode {
    return this.mode;
  }

  focusOn(target: THREE.Vector3, distance?: number): void {
    if (!this.controls) return;
    const d = THREE.MathUtils.clamp(
      distance ?? this.world.camera.position.distanceTo(target),
      this.config.minDistance,
      this.config.maxDistance,
    );
    this.controls.target.copy(target);
    const dir = this._tempVec3
      .copy(this.world.camera.position)
      .sub(target)
      .normalize();
    this.world.camera.position.copy(target).addScaledVector(dir, d);
    this.controls.update();
    this.emit("focus-changed", { target: target.clone(), distance: d });
  }

  focusOnBounds(box: THREE.Box3, padding = 1.2): void {
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const fov = this.world.camera.fov * (Math.PI / 180);
    this.focusOn(
      center,
      (Math.max(size.x, size.y, size.z) * padding) / (2 * Math.tan(fov / 2)),
    );
  }

  saveBookmark(name: string): void {
    const bookmark: CameraBookmark = {
      name,
      position: this.world.camera.position.clone(),
      target: this.controls?.target.clone() ?? new THREE.Vector3(),
      zoom: this.world.camera.zoom,
    };
    this.bookmarks.set(name, bookmark);
    this.emit("bookmark-saved", { bookmark });
  }

  loadBookmark(name: string): boolean {
    const bookmark = this.bookmarks.get(name);
    if (!bookmark) return false;
    this.world.camera.position.copy(bookmark.position);
    this.world.camera.zoom = bookmark.zoom;
    this.world.camera.updateProjectionMatrix();
    if (this.controls) {
      this.controls.target.copy(bookmark.target);
      this.controls.update();
    }
    this.emit("bookmark-loaded", { bookmark });
    return true;
  }

  getBookmarks(): CameraBookmark[] {
    return Array.from(this.bookmarks.values());
  }

  deleteBookmark(name: string): boolean {
    const deleted = this.bookmarks.delete(name);
    if (deleted) this.emit("bookmark-deleted", { name });
    return deleted;
  }

  getControls(): OrbitControls | null {
    return this.controls;
  }
  getTarget(): THREE.Vector3 {
    return this.controls?.target.clone() ?? new THREE.Vector3();
  }

  setTarget(target: THREE.Vector3): void {
    if (!this.controls) return;
    this.controls.target.copy(target);
    this.controls.update();
  }

  override update(delta: number): void {
    if (!this.controls) return;
    if (this.mode === "fly") this.updateFlyMode(delta);
    this.controls.update();
  }

  private updateFlyMode(delta: number): void {
    const speed = this.flyKeys.fast
      ? this.config.flySpeed * this.config.flyFastMultiplier
      : this.config.flySpeed;
    const dir = this.flyDirection.set(0, 0, 0);

    if (this.flyKeys.forward) dir.z -= 1;
    if (this.flyKeys.backward) dir.z += 1;
    if (this.flyKeys.left) dir.x -= 1;
    if (this.flyKeys.right) dir.x += 1;
    if (this.flyKeys.up) dir.y += 1;
    if (this.flyKeys.down) dir.y -= 1;

    if (dir.lengthSq() === 0) return;
    dir.normalize();

    this._tempEuler.setFromQuaternion(this.world.camera.quaternion, "YXZ");
    const cos = Math.cos(this._tempEuler.y),
      sin = Math.sin(this._tempEuler.y);
    const mx = (dir.x * cos - dir.z * sin) * speed * delta;
    const my = dir.y * speed * delta;
    const mz = (dir.x * sin + dir.z * cos) * speed * delta;

    this.world.camera.position.x += mx;
    this.world.camera.position.y += my;
    this.world.camera.position.z += mz;
    if (this.controls) {
      this.controls.target.x += mx;
      this.controls.target.y += my;
      this.controls.target.z += mz;
    }
  }

  override destroy(): void {
    if (this.domElement) {
      this.domElement.removeEventListener("keydown", this.onKeyDown);
      this.domElement.removeEventListener("keyup", this.onKeyUp);
      this.domElement.removeEventListener("blur", this.onBlur);
    }

    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    this.bookmarks.clear();
    super.destroy();
  }
}
